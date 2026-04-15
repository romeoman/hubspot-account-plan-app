import type { Snapshot } from "@hap/config";
import { eligibilityStateSchema, stateFlagsSchema } from "@hap/validators";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

/**
 * Wire-shape schema for `Snapshot` responses.
 *
 * The canonical `snapshotSchema` in `@hap/validators` validates
 * `createdAt`/`timestamp` as `z.date()` because the in-process domain shape
 * uses `Date`. Over HTTP (JSON) these fields travel as ISO strings, so we
 * use `z.coerce.date()` at the transport boundary. The resulting parsed
 * object matches the domain `Snapshot` type exactly.
 */
const wireEvidenceSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  source: z.string().min(1),
  timestamp: z.coerce.date(),
  confidence: z.number().min(0).max(1),
  content: z.string(),
  isRestricted: z.boolean(),
});

const wirePersonSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  title: z.string().optional(),
  reasonToTalk: z.string(),
  evidenceRefs: z.array(z.string()),
});

const wireSnapshotSchema = z.object({
  tenantId: z.string().min(1),
  companyId: z.string().min(1),
  eligibilityState: eligibilityStateSchema,
  reasonToContact: z.string().optional(),
  people: z.array(wirePersonSchema),
  evidence: z.array(wireEvidenceSchema),
  stateFlags: stateFlagsSchema,
  trustScore: z.number().min(0).max(1).optional(),
  createdAt: z.coerce.date(),
}) satisfies z.ZodType<Snapshot, unknown>;

/**
 * Fetcher contract used by `useSnapshot`.
 *
 * Step 11 (and any live integration) is expected to inject a production
 * fetcher that:
 *   - calls `POST /api/snapshot/:companyId` against the configured API base
 *   - attaches the tenant/portal bearer token + any required HubSpot headers
 *   - returns the raw parsed JSON body
 *
 * Validation of the body and Date coercion is performed by this hook, so
 * the fetcher's only responsibility is transport + auth. Fetchers MUST
 * throw (reject) on non-2xx responses rather than returning malformed data.
 */
export type SnapshotFetcher = (companyId: string) => Promise<unknown>;

export type UseSnapshotArgs = {
  companyId: string;
  /**
   * Transport. REQUIRED — there is no working default in V1 because the
   * production transport needs a HubSpot-aware fetcher with bearer token
   * and base URL resolution that is not yet wired (see Slice 2).
   *
   * Tests pass a stub; the extension entry point must pass an explicit
   * fetcher (or one that throws with a clear "not yet wired" message)
   * so a missing transport surfaces as a loud UI error rather than a
   * silent 401 against the real API.
   *
   * @todo Slice 2: provide a `createHubSpotFetcher()` factory that reads
   *   base URL + bearer token from tenant config and sets `x-portal-id`,
   *   then thread it through the extension entry point.
   */
  fetcher: SnapshotFetcher;
};

export type UseSnapshotState = {
  snapshot: Snapshot | null;
  loading: boolean;
  error?: Error;
  /**
   * Re-enters the loading state and re-invokes the fetcher. Useful after a
   * CRM property update or manual user refresh.
   */
  refetch: () => void;
};

/**
 * Explicit "not wired yet" fetcher. The extension entry point passes this
 * in V1 so a dev preview surfaces a loud, identifiable error rather than
 * silently 401'ing against the real API. Slice 2 swaps it for the
 * HubSpot-aware fetcher.
 */
export const SLICE2_TRANSPORT_NOT_WIRED = "snapshot-fetcher-not-wired";

export function v1UnwiredFetcher(): Promise<never> {
  return Promise.reject(
    new Error(
      `${SLICE2_TRANSPORT_NOT_WIRED}: useSnapshot was called without a real fetcher. Slice 2 will provide createHubSpotFetcher().`,
    ),
  );
}

/**
 * Load and validate a `Snapshot` for a given HubSpot company.
 *
 * Lifecycle:
 *   mount / companyId change → loading=true
 *   fetcher resolves valid   → snapshot set, loading=false
 *   fetcher rejects          → error set, loading=false
 *   schema validation fails  → error set (never renders malformed data),
 *                              loading=false
 *   refetch()                → returns to loading=true and re-invokes fetcher
 */
export function useSnapshot({ companyId, fetcher }: UseSnapshotArgs): UseSnapshotState {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [refetchTick, setRefetchTick] = useState<number>(0);

  // `refetchTick` is an intentional escape hatch that re-runs the effect
  // when the caller invokes `refetch()`. Biome cannot infer this intent.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetchTick is the refetch trigger
  useEffect(() => {
    // Guard: don't fire a fetch with an empty companyId. The companion
    // `useCompanyContext` may emit an empty id during its initial loading
    // tick — we'd otherwise send a throwaway request that the route
    // immediately rejects as `invalid_company_id`.
    if (companyId.length === 0) {
      setLoading(true);
      setError(undefined);
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setSnapshot(null);

    fetcher(companyId)
      .then((raw) => {
        if (cancelled) return;
        const parsed = wireSnapshotSchema.safeParse(raw);
        if (!parsed.success) {
          setError(new Error(`snapshot-validation-failed: ${parsed.error.message}`));
          setLoading(false);
          return;
        }
        setSnapshot(parsed.data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetcher, companyId, refetchTick]);

  const refetch = useCallback(() => {
    setRefetchTick((tick) => tick + 1);
  }, []);

  return { snapshot, loading, error, refetch };
}
