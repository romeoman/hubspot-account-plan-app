import { type Database, providerConfig } from "@hap/db";
import { and, eq } from "drizzle-orm";

/**
 * Target-account eligibility gating service.
 *
 * Reads a configurable HubSpot company property (default `hs_is_target_account`)
 * and returns a tri-state eligibility result. Fail-safe: any missing value or
 * fetcher error collapses to `unconfigured` rather than bubbling up.
 *
 * Cache is in-memory, tenant-scoped (key includes `tenantId`), with a 5-minute
 * TTL. The cache MUST never share entries across tenants.
 *
 * V1 contract: the `fetcher` is injectable — tests pass a fixture function,
 * Slice 2 will pass a real HubSpot client adapter.
 */

/** Default HubSpot property used when no provider_config override exists. */
export const DEFAULT_ELIGIBILITY_PROPERTY = "hs_is_target_account";

/** Cache TTL: 5 minutes. */
export const ELIGIBILITY_CACHE_TTL_MS = 5 * 60 * 1000;

/** Provider name in `provider_config` that holds HubSpot-related settings. */
const HUBSPOT_PROVIDER_NAME = "hubspot";

/** Settings key in `provider_config.settings` that overrides the property name. */
const ELIGIBILITY_PROPERTY_SETTINGS_KEY = "eligibilityPropertyName";

export type EligibilityReason = "eligible" | "ineligible" | "unconfigured";

export type EligibilityResult = {
  eligible: boolean;
  reason: EligibilityReason;
};

/**
 * Injectable property fetcher.
 *
 * Implementations must resolve the value of `propertyName` for `companyId`
 * SCOPED TO `tenantId`. The tenantId is required because HubSpot company IDs
 * are portal-scoped — without it, a shared fetcher has no reliable way to
 * choose the right portal/token, which is exactly how cross-tenant reads
 * sneak in.
 *
 * Implementations SHOULD return `null`/`undefined` for missing values and MAY
 * throw for transport errors — the service treats both cases as `unconfigured`.
 */
export type CompanyPropertyFetcher = (
  tenantId: string,
  companyId: string,
  propertyName: string,
) => Promise<unknown>;

export type CheckEligibilityDeps = {
  db: Database;
  fetcher: CompanyPropertyFetcher;
  /** Monotonic clock source (ms). Inject in tests for deterministic TTL checks. */
  now?: () => number;
};

export type CheckEligibilityArgs = {
  tenantId: string;
  companyId: string;
};

type CacheEntry = {
  result: EligibilityResult;
  expiresAt: number;
};

/**
 * Module-level cache. Keys embed `tenantId` so cross-tenant lookups can never
 * collide even when two tenants target the same `companyId` + property name.
 */
const cache = new Map<string, CacheEntry>();

/** Build a tenant-scoped cache key. Exposed for test assertions. */
export function buildCacheKey(tenantId: string, companyId: string, propertyName: string): string {
  return `${tenantId}:${companyId}:${propertyName}`;
}

/** Clear all cached eligibility entries. Tests call this in `beforeEach`. */
export function clearEligibilityCache(): void {
  cache.clear();
}

/**
 * Resolve the configured eligibility property name for a tenant.
 *
 * Falls back to `DEFAULT_ELIGIBILITY_PROPERTY` when no row exists or when the
 * settings JSON lacks an override. Any DB error is swallowed — the default is
 * always safe because the fetcher read will then surface `unconfigured` for
 * missing data.
 */
async function resolvePropertyName(db: Database, tenantId: string): Promise<string> {
  try {
    const rows = await db
      .select({ settings: providerConfig.settings })
      .from(providerConfig)
      .where(
        and(
          eq(providerConfig.tenantId, tenantId),
          eq(providerConfig.providerName, HUBSPOT_PROVIDER_NAME),
        ),
      )
      .limit(1);

    const settings = rows[0]?.settings;
    if (settings && typeof settings === "object" && !Array.isArray(settings)) {
      const raw = (settings as Record<string, unknown>)[ELIGIBILITY_PROPERTY_SETTINGS_KEY];
      if (typeof raw === "string" && raw.length > 0) {
        return raw;
      }
    }
  } catch {
    // Intentional: fail open to the default property name. The fetcher call
    // will still determine eligibility/unconfigured correctly.
  }
  return DEFAULT_ELIGIBILITY_PROPERTY;
}

/**
 * Classify a raw property value from HubSpot.
 *
 * HubSpot boolean properties arrive as either native booleans or the strings
 * `"true"` / `"false"`. Be conservative: only accept those exact shapes. Any
 * other value (numbers, unknown strings, objects) falls through to
 * `unconfigured` so we never bluff eligibility on ambiguous data.
 */
function classify(value: unknown): EligibilityReason {
  if (value === true || value === "true") return "eligible";
  if (value === false || value === "false") return "ineligible";
  return "unconfigured";
}

/**
 * Check whether a company qualifies as a target account for the given tenant.
 *
 * @returns `{ eligible, reason }` — never throws. Missing data, fetcher errors,
 * and DB errors all collapse to `{ eligible: false, reason: 'unconfigured' }`.
 */
export async function checkEligibility(
  deps: CheckEligibilityDeps,
  args: CheckEligibilityArgs,
): Promise<EligibilityResult> {
  const { db, fetcher } = deps;
  const now = deps.now ?? Date.now;
  const { tenantId, companyId } = args;

  const propertyName = await resolvePropertyName(db, tenantId);
  const key = buildCacheKey(tenantId, companyId, propertyName);

  const cached = cache.get(key);
  const currentTime = now();
  if (cached && cached.expiresAt > currentTime) {
    return cached.result;
  }

  let reason: EligibilityReason;
  try {
    const raw = await fetcher(tenantId, companyId, propertyName);
    reason = classify(raw);
  } catch {
    // Fail-safe: transport errors never bubble up to callers.
    reason = "unconfigured";
  }

  const result: EligibilityResult = {
    eligible: reason === "eligible",
    reason,
  };

  cache.set(key, {
    result,
    expiresAt: currentTime + ELIGIBILITY_CACHE_TTL_MS,
  });

  return result;
}
