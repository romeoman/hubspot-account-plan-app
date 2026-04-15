import type { ExtensionPointApiActions, ExtensionPointApiContext } from "@hubspot/ui-extensions";
import { useEffect, useState } from "react";

/**
 * Subset of HubSpot CRM object properties the extension cares about right now.
 *
 * Property names use HubSpot internal snake_case on the wire; this hook maps
 * them into camelCase for TypeScript consumers. `hs_is_target_account` is a
 * string ("true"/"false") on the wire and is coerced into a boolean here.
 */
export type CompanyProperties = {
  name?: string;
  domain?: string;
  hsIsTargetAccount?: boolean;
};

/**
 * Return shape of `useCompanyContext`.
 *
 * - `companyId`: stringified form of `context.crm.objectId` (which is numeric
 *   in the HubSpot SDK; the V1 API contract accepts string ids).
 * - `objectType`: `context.crm.objectTypeId` (e.g. `"0-2"` for companies).
 * - `portalId`: stringified form of `context.portal.id`.
 * - `properties`: CRM properties fetched via `fetchCrmObjectProperties`.
 * - `loading`, `error`: property-fetch lifecycle state.
 */
export type CompanyContext = {
  companyId: string;
  objectType: string;
  portalId: string;
  properties: CompanyProperties;
  loading: boolean;
  error?: Error;
};

/**
 * HubSpot CRM property names we request. Kept as a tuple constant so the
 * shape is stable across calls (important for `useEffect` dep-array sanity).
 */
const REQUESTED_PROPERTIES: readonly string[] = ["name", "domain", "hs_is_target_account"];

/**
 * Read current CRM record context + target-account properties.
 *
 * This hook is a pure function of its inputs (no global state), which makes
 * it trivial to test with `createRenderer('crm.record.tab')` — callers supply
 * the mock `context` and a mock `fetchCrmObjectProperties` spy.
 *
 * Lifecycle:
 *   mount       → loading=true
 *   fetch ok    → loading=false, properties populated
 *   fetch fails → loading=false, error set (properties stays empty)
 *
 * @param context               CRM extension point context from `hubspot.extend()`.
 * @param fetchCrmObjectProperties Action fetched from the host via extension
 *   point `actions.fetchCrmObjectProperties`. Tests pass a Vitest spy.
 */
export function useCompanyContext(
  context: ExtensionPointApiContext<"crm.record.tab">,
  fetchCrmObjectProperties: ExtensionPointApiActions<"crm.record.tab">["fetchCrmObjectProperties"],
): CompanyContext {
  const companyId = String(context.crm.objectId);
  const objectType = String(context.crm.objectTypeId);
  const portalId = String(context.portal.id);

  const [properties, setProperties] = useState<CompanyProperties>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | undefined>(undefined);

  // Intentional extra deps: `companyId`/`objectType` are derived from
  // `context` and represent the CRM record identity. If the host swaps
  // the record under us, we want to re-run the fetch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-fetch on CRM record identity change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);

    fetchCrmObjectProperties(REQUESTED_PROPERTIES as string[])
      .then((raw) => {
        if (cancelled) return;
        setProperties(mapRawProperties(raw));
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
  }, [fetchCrmObjectProperties, companyId, objectType]);

  return {
    companyId,
    objectType,
    portalId,
    properties,
    loading,
    error,
  };
}

/**
 * Map HubSpot snake_case string-valued property responses to the
 * extension-internal camelCase + typed form.
 *
 * Keeps conversion in one place so tests stay focused on the transition
 * semantics, not string munging.
 */
function mapRawProperties(raw: Record<string, string>): CompanyProperties {
  const out: CompanyProperties = {};
  if (typeof raw.name === "string" && raw.name.length > 0) {
    out.name = raw.name;
  }
  if (typeof raw.domain === "string" && raw.domain.length > 0) {
    out.domain = raw.domain;
  }
  if (typeof raw.hs_is_target_account === "string") {
    out.hsIsTargetAccount = raw.hs_is_target_account === "true";
  }
  return out;
}
