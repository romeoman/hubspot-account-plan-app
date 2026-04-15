/**
 * Per-tenant provider / LLM config resolver.
 *
 * Responsibilities:
 *  - Read `provider_config` / `llm_config` rows for a given `tenantId`.
 *  - Decrypt stored `api_key_encrypted` via {@link decryptProviderKey} so
 *    callers get an `apiKeyRef` (plaintext usable for outbound calls in
 *    Slice 2 adapters) while the ciphertext never leaves this module.
 *  - Map DB row shapes to the domain types exported from `@hap/config`
 *    (`ProviderConfig`, `LlmProviderConfig`).
 *  - Cache results per-tenant with a 5-minute TTL. Keys embed `tenantId` so
 *    cross-tenant lookups cannot collide.
 *
 * Tenant isolation: every cache key is prefixed with `tenantId`; no helper in
 * this module returns a config whose underlying row belongs to a different
 * tenant. Tests in `__tests__/config-resolver.test.ts` assert this directly.
 *
 * @todo Slice 2: the in-memory Map cache is fine for a single API instance
 * in Slice 1. For multi-instance deployments, swap to Redis (or Supabase
 * Postgres LISTEN/NOTIFY invalidation) keyed by `${tenantId}:...`.
 *
 * @todo Slice 2: once real provider adapters exist, add a higher-level
 * `resolveProviderAdapter(tenantId, providerName)` factory here that wires
 * this resolver's output into the correct adapter constructor.
 */

import type {
  LlmProviderConfig,
  LlmProviderType,
  ProviderConfig,
  ThresholdConfig,
} from "@hap/config";
import { type Database, llmConfig, providerConfig, tenants } from "@hap/db";
import { and, asc, eq } from "drizzle-orm";
import { decryptProviderKey } from "./encryption";

/** Cache TTL: 5 minutes. Matches eligibility-service TTL for consistency. */
export const CONFIG_RESOLVER_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * V1 default thresholds. Shared with `routes/snapshot.ts` so callers and
 * config resolution agree on what "unconfigured" means. A tenant that has a
 * provider row with no explicit threshold fields inherits these values —
 * parsing the empty jsonb `{}` no longer coerces to `{0, 0}`.
 */
export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  freshnessMaxDays: 30,
  minConfidence: 0.5,
};

const LLM_PROVIDER_TYPES: readonly LlmProviderType[] = [
  "anthropic",
  "openai",
  "gemini",
  "openrouter",
  "custom",
];

function isLlmProviderType(v: unknown): v is LlmProviderType {
  return typeof v === "string" && (LLM_PROVIDER_TYPES as readonly string[]).includes(v);
}

/**
 * Cached row shape — the `apiKeyEncrypted` ciphertext is fine to keep in
 * memory for the TTL window, but the decrypted plaintext is NOT. Caches
 * therefore store the raw row and decrypt on demand inside each call so
 * plaintext only lives for the duration of a single function execution.
 */
type ProviderRow = {
  providerName: string;
  enabled: boolean;
  apiKeyEncrypted: string | null;
  thresholds: unknown;
};
type LlmRow = {
  providerName: string;
  modelName: string;
  apiKeyEncrypted: string | null;
  endpointUrl: string | null;
};

type ProviderCacheEntry = { row: ProviderRow | null; expiresAt: number };
type LlmCacheEntry = { row: LlmRow | null; expiresAt: number };

const providerCache = new Map<string, ProviderCacheEntry>();
const llmCache = new Map<string, LlmCacheEntry>();

/** Clear all cached entries. Tests call this in `beforeEach`. */
export function clearConfigResolverCache(): void {
  providerCache.clear();
  llmCache.clear();
}

/**
 * Drop the cached entry for one tenant + provider so the next read hits the
 * DB. Call from any code path that mutates `provider_config` (insert / update
 * / delete) — without this, a `null` cached from a prior look-up would mask
 * the new row for up to {@link CONFIG_RESOLVER_CACHE_TTL_MS}.
 */
export function invalidateProviderConfig(tenantId: string, providerName: string): void {
  providerCache.delete(buildProviderKey(tenantId, providerName));
}

/**
 * Drop the cached LLM-config entry for a tenant. Call from any code path that
 * mutates `llm_config` rows for that tenant (insert / update / delete) or
 * `tenants.settings.defaultLlmProvider`.
 */
export function invalidateLlmConfig(tenantId: string): void {
  llmCache.delete(buildLlmKey(tenantId));
}

export type ConfigResolverDeps = {
  db: Database;
  /** Monotonic clock source (ms). Inject in tests for deterministic TTL checks. */
  now?: () => number;
};

function buildProviderKey(tenantId: string, providerName: string): string {
  return `${tenantId}:provider:${providerName}`;
}

function buildLlmKey(tenantId: string): string {
  return `${tenantId}:llm`;
}

/**
 * Parse the `thresholds` jsonb column into a PARTIAL ThresholdConfig. Only
 * fields that are actually present in the row and are finite numbers are
 * returned. Missing fields are omitted (not coerced to 0) so callers can
 * distinguish "tenant left this blank, use the default" from "tenant
 * explicitly set zero".
 *
 * The zero-coercion bug this replaces caused tenants with a provider row
 * but no explicit thresholds to be treated as `{ freshnessMaxDays: 0,
 * minConfidence: 0 }` — which made every piece of evidence stale.
 */
function parseThresholds(raw: unknown): Partial<ThresholdConfig> {
  const out: Partial<ThresholdConfig> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const rec = raw as Record<string, unknown>;
    if (typeof rec.freshnessMaxDays === "number" && Number.isFinite(rec.freshnessMaxDays)) {
      out.freshnessMaxDays = rec.freshnessMaxDays;
    }
    if (typeof rec.minConfidence === "number" && Number.isFinite(rec.minConfidence)) {
      out.minConfidence = rec.minConfidence;
    }
  }
  return out;
}

/**
 * Fetch the `ProviderConfig` for a tenant + provider name.
 *
 * Returns `null` when no row exists. NEVER throws on missing data; only
 * propagates errors from the decryption layer (tenant mismatch / malformed
 * ciphertext) because those indicate a security-relevant inconsistency.
 */
export async function getProviderConfig(
  deps: ConfigResolverDeps,
  args: { tenantId: string; providerName: string },
): Promise<ProviderConfig | null> {
  const now = deps.now ?? Date.now;
  const currentTime = now();
  const key = buildProviderKey(args.tenantId, args.providerName);

  let row: ProviderRow | null;
  const cached = providerCache.get(key);
  if (cached && cached.expiresAt > currentTime) {
    row = cached.row;
  } else {
    const rows = await deps.db
      .select({
        providerName: providerConfig.providerName,
        enabled: providerConfig.enabled,
        apiKeyEncrypted: providerConfig.apiKeyEncrypted,
        thresholds: providerConfig.thresholds,
      })
      .from(providerConfig)
      .where(
        and(
          eq(providerConfig.tenantId, args.tenantId),
          eq(providerConfig.providerName, args.providerName),
        ),
      )
      .limit(1);
    row = rows[0] ?? null;
    providerCache.set(key, {
      row,
      expiresAt: currentTime + CONFIG_RESOLVER_CACHE_TTL_MS,
    });
  }

  if (!row) return null;

  // Decrypt at point of use — the cache holds ciphertext only. The plaintext
  // returned here lives only for the caller's own scope.
  const apiKeyRef = row.apiKeyEncrypted
    ? decryptProviderKey(args.tenantId, row.apiKeyEncrypted)
    : "";
  // Merge parsed fields ON TOP of defaults. A tenant that sets only
  // `freshnessMaxDays` still gets the default `minConfidence`; a completely
  // empty jsonb returns DEFAULT_THRESHOLDS as-is rather than zeros.
  const thresholds: ThresholdConfig = {
    ...DEFAULT_THRESHOLDS,
    ...parseThresholds(row.thresholds),
  };
  return {
    name: row.providerName,
    enabled: row.enabled,
    apiKeyRef,
    thresholds,
  };
}

/**
 * Fetch the preferred `LlmProviderConfig` for a tenant.
 *
 * Selection strategy (V1, intentionally simple):
 *   1. If `tenants.settings.defaultLlmProvider` is a supported
 *      {@link LlmProviderType} AND a matching `llm_config` row exists,
 *      return that row.
 *   2. Otherwise, return the first `llm_config` row for the tenant
 *      (by insertion order in `id`).
 *   3. Returns `null` when no rows exist.
 *
 * @todo Slice 2: expose explicit `getLlmConfigByProvider(tenantId, provider)`
 * for callers that need to target a specific family (e.g. guardrail / judge
 * models). V1 callers only need the tenant default.
 */
export async function getLlmConfig(
  deps: ConfigResolverDeps,
  args: { tenantId: string },
): Promise<LlmProviderConfig | null> {
  const now = deps.now ?? Date.now;
  const currentTime = now();
  const key = buildLlmKey(args.tenantId);

  let chosen: LlmRow | null;
  const cached = llmCache.get(key);
  if (cached && cached.expiresAt > currentTime) {
    chosen = cached.row;
  } else {
    // Look up tenant default (if set) and all llm_config rows in one pair of queries.
    const tenantRows = await deps.db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, args.tenantId))
      .limit(1);

    let defaultProvider: LlmProviderType | undefined;
    const tenantSettings = tenantRows[0]?.settings;
    if (tenantSettings && typeof tenantSettings === "object" && !Array.isArray(tenantSettings)) {
      const raw = (tenantSettings as Record<string, unknown>).defaultLlmProvider;
      if (isLlmProviderType(raw)) defaultProvider = raw;
    }

    const rows = await deps.db
      .select({
        providerName: llmConfig.providerName,
        modelName: llmConfig.modelName,
        apiKeyEncrypted: llmConfig.apiKeyEncrypted,
        endpointUrl: llmConfig.endpointUrl,
      })
      .from(llmConfig)
      .where(eq(llmConfig.tenantId, args.tenantId))
      // Deterministic selection — without orderBy, Postgres returns rows in
      // physical order which can change after VACUUM, replication, or any
      // table-level mutation.
      .orderBy(asc(llmConfig.id));

    let pick = rows[0] ?? null;
    if (defaultProvider) {
      const match = rows.find((r) => r.providerName === defaultProvider);
      if (match) pick = match;
    }
    chosen = pick;
    llmCache.set(key, {
      row: chosen,
      expiresAt: currentTime + CONFIG_RESOLVER_CACHE_TTL_MS,
    });
  }

  if (!chosen) return null;
  if (!isLlmProviderType(chosen.providerName)) {
    // Defensive: unknown provider string in DB — skip rather than crash.
    return null;
  }

  // Decrypt at point of use — cache holds ciphertext only.
  const apiKeyRef = chosen.apiKeyEncrypted
    ? decryptProviderKey(args.tenantId, chosen.apiKeyEncrypted)
    : "";
  return {
    provider: chosen.providerName,
    model: chosen.modelName,
    apiKeyRef,
    endpointUrl: chosen.endpointUrl ?? undefined,
  };
}
