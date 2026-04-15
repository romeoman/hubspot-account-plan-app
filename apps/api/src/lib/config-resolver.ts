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
 *  - Cache results per-tenant with a 5-minute TTL behind a {@link CacheAdapter}
 *    abstraction. Cache keys embed `tenantId` so cross-tenant lookups cannot
 *    collide; every entry is tagged `tenant:${tenantId}` so one call to
 *    {@link invalidateTenantConfig} flushes a whole tenant's configs when
 *    their DB rows change.
 *
 * Cache key conventions:
 *  - `provider:${tenantId}:${providerName}` — one row from `provider_config`.
 *  - `llm:${tenantId}:default` — the tenant's default LLM row (the
 *    {@link getLlmConfig} selection).
 *  - `llm:${tenantId}:${provider}` — a specific LLM row by `provider_name`
 *    (used by {@link getLlmConfigByProvider}, which the Step 8 LLM factory
 *    calls at request time).
 *
 * Tenant isolation: every cache key is prefixed with `tenantId` AND every
 * entry carries a `tenant:${tenantId}` tag; no helper in this module returns
 * a config whose underlying row belongs to a different tenant. Tests in
 * `__tests__/config-resolver.test.ts` assert this directly.
 *
 * Decryption flow: the cache stores the already-decrypted domain object so
 * we don't pay the AES cost on every read. The object is FROZEN on write
 * (including its nested `thresholds` / `settings`) so a buggy caller cannot
 * mutate the shared instance and poison the next reader. `invalidateTenantConfig`
 * is what forces re-decryption when a tenant rotates their key.
 *
 * @todo Slice 3: once every tenant has a provisioned `provider_config` row
 * AND the scaffolded signal adapters (hubspot-enrichment, news) ship real
 * bodies, add a higher-level `resolveProviderAdapter(tenantId, providerName)`
 * factory here that wires this resolver's output into the correct adapter
 * constructor and retires the route-level fallback-to-mock path.
 */

import type {
  LlmProviderConfig,
  LlmProviderType,
  ProviderConfig,
  ThresholdConfig,
} from "@hap/config";
import { type Database, llmConfig, providerConfig, tenants } from "@hap/db";
import { and, asc, eq } from "drizzle-orm";
import { type CacheAdapter, InMemoryCacheAdapter } from "./cache-adapter";
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

type ProviderRow = {
  providerName: string;
  enabled: boolean;
  apiKeyEncrypted: string | null;
  thresholds: unknown;
  allowList: unknown;
  blockList: unknown;
};
type LlmRow = {
  providerName: string;
  modelName: string;
  apiKeyEncrypted: string | null;
  endpointUrl: string | null;
};

// -----------------------------------------------------------------------------
// Cache adapter (module-level, swappable for tests and Slice 3 Redis)
// -----------------------------------------------------------------------------

let cache: CacheAdapter = new InMemoryCacheAdapter();

/**
 * Swap the cache adapter. Tests call this in `beforeEach` with a fresh
 * {@link InMemoryCacheAdapter} so state never leaks between cases. Slice 3
 * wires a Redis-backed implementation here at startup.
 */
export function __setCacheAdapterForTests(adapter: CacheAdapter): void {
  cache = adapter;
}

/** Clear all cached entries. Existing Slice 1 callers rely on this signature. */
export function clearConfigResolverCache(): void {
  cache.clear();
}

/**
 * Drop the cached entry for one tenant + provider so the next read hits the
 * DB. Call from any code path that mutates `provider_config` (insert / update
 * / delete) — without this, a `null` cached from a prior look-up would mask
 * the new row for up to {@link CONFIG_RESOLVER_CACHE_TTL_MS}.
 */
export function invalidateProviderConfig(tenantId: string, providerName: string): void {
  cache.delete(providerKey(tenantId, providerName));
}

/**
 * Drop the cached LLM-config entries for a tenant. Flushes BOTH the default
 * selection and any per-provider entries (Step 8+ can store either).
 */
export function invalidateLlmConfig(tenantId: string): void {
  // We don't track which per-provider entries exist, so use the tenant tag —
  // this over-flushes (drops provider rows too), which is acceptable on config
  // mutation paths and matches the pre-refactor behaviour.
  cache.invalidateByTag(tenantTag(tenantId));
}

/**
 * Flush every cached config for this tenant. Step 9+ provider adapters call
 * this when they detect a stale row (e.g., 401 Unauthorized suggests a
 * rotated key). The implementation is O(#entries-with-this-tag).
 */
export function invalidateTenantConfig(tenantId: string): void {
  cache.invalidateByTag(tenantTag(tenantId));
}

export type ConfigResolverDeps = {
  db: Database;
  /** Monotonic clock source (ms). Inject in tests for deterministic TTL checks. */
  now?: () => number;
};

// Key builders. Keep string shapes stable — tests and logs reference them.
function providerKey(tenantId: string, providerName: string): string {
  return `provider:${tenantId}:${providerName}`;
}
function llmDefaultKey(tenantId: string): string {
  return `llm:${tenantId}:default`;
}
function llmProviderKey(tenantId: string, provider: LlmProviderType): string {
  return `llm:${tenantId}:${provider}`;
}
function tenantTag(tenantId: string): string {
  return `tenant:${tenantId}`;
}

/**
 * Parse the `thresholds` jsonb column into a PARTIAL ThresholdConfig. Only
 * fields that are actually present in the row and are finite numbers are
 * returned. Missing fields are omitted (not coerced to 0) so callers can
 * distinguish "tenant left this blank, use the default" from "tenant
 * explicitly set zero".
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
 * Parse a jsonb column expected to contain `string[]`. Returns `undefined`
 * if the column is null/missing/empty/malformed so callers can treat
 * "not configured" and "configured empty" as the same no-op.
 *
 * Non-string entries are dropped defensively (a malformed row shouldn't
 * crash the pipeline or silently block all evidence).
 */
function parseStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter((v): v is string => typeof v === "string" && v.length > 0);
  return out.length > 0 ? out : undefined;
}

/**
 * Deep-freeze a config object. We chose freeze-on-set over clone-on-read:
 *  - one allocation per DB read instead of one per cache hit
 *  - immediately crashes buggy callers that try to mutate shared state
 *    (much better signal than silent divergence between "my copy" and
 *    "what's cached")
 *  - `ProviderConfig` / `LlmProviderConfig` are shallow POJOs, so freeze is
 *    cheap and complete. If these types grow arrays or nested objects in
 *    Slice 3, freeze recursively here.
 */
function freezeConfig<T>(value: T | null): T | null {
  if (value === null) return null;
  if (typeof value === "object" && value !== null) {
    for (const v of Object.values(value as Record<string, unknown>)) {
      if (v && typeof v === "object") Object.freeze(v);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Envelope wrapping a cached config with an absolute `expiresAt` timestamp.
 *
 * We intentionally do NOT use the {@link CacheAdapter}'s own `ttlMs` here —
 * the adapter reads `Date.now()` directly, but the resolver's test harness
 * injects a `now()` clock via `ConfigResolverDeps`. Keeping the expiry check
 * inside the resolver lets tests advance time deterministically without
 * monkey-patching `Date`. The adapter's TTL machinery is still used by other
 * consumers (Slice 3 rate limiter, nonce store).
 */
type CacheEnvelope<T> = { value: T; expiresAt: number };

function readCache<T>(key: string, now: number): T | undefined {
  const env = cache.get<CacheEnvelope<T>>(key);
  if (!env) return undefined;
  if (env.expiresAt <= now) return undefined;
  return env.value;
}

function writeCache<T>(key: string, tenantId: string, value: T, now: number): void {
  cache.set<CacheEnvelope<T>>(
    key,
    { value, expiresAt: now + CONFIG_RESOLVER_CACHE_TTL_MS },
    { tags: [tenantTag(tenantId)] },
  );
}

// -----------------------------------------------------------------------------
// Provider config
// -----------------------------------------------------------------------------

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
  const now = (deps.now ?? Date.now)();
  const key = providerKey(args.tenantId, args.providerName);

  // `undefined` = cache miss / expired; `null` = cached "row does not exist".
  const cached = readCache<ProviderConfig | null>(key, now);
  if (cached !== undefined) return cached;

  const rows = await deps.db
    .select({
      providerName: providerConfig.providerName,
      enabled: providerConfig.enabled,
      apiKeyEncrypted: providerConfig.apiKeyEncrypted,
      thresholds: providerConfig.thresholds,
      allowList: providerConfig.allowList,
      blockList: providerConfig.blockList,
    })
    .from(providerConfig)
    .where(
      and(
        eq(providerConfig.tenantId, args.tenantId),
        eq(providerConfig.providerName, args.providerName),
      ),
    )
    .limit(1);
  const row: ProviderRow | null = rows[0] ?? null;

  let result: ProviderConfig | null;
  if (!row) {
    result = null;
  } else {
    const apiKeyRef = row.apiKeyEncrypted
      ? decryptProviderKey(args.tenantId, row.apiKeyEncrypted)
      : "";
    const thresholds: ThresholdConfig = {
      ...DEFAULT_THRESHOLDS,
      ...parseThresholds(row.thresholds),
    };
    const allowList = parseStringArray(row.allowList);
    const blockList = parseStringArray(row.blockList);
    result = {
      name: row.providerName,
      enabled: row.enabled,
      apiKeyRef,
      thresholds,
      ...(allowList ? { allowList } : {}),
      ...(blockList ? { blockList } : {}),
    };
  }

  writeCache(key, args.tenantId, freezeConfig(result), now);
  return result;
}

// -----------------------------------------------------------------------------
// LLM config — default (tenant's preferred model) and per-provider lookup
// -----------------------------------------------------------------------------

/** Fetch-and-cache wrapper. Shared by the default + per-provider code paths. */
async function fetchLlmRow(
  deps: ConfigResolverDeps,
  args: { tenantId: string; provider?: LlmProviderType },
): Promise<LlmRow | null> {
  if (args.provider) {
    const rows = await deps.db
      .select({
        providerName: llmConfig.providerName,
        modelName: llmConfig.modelName,
        apiKeyEncrypted: llmConfig.apiKeyEncrypted,
        endpointUrl: llmConfig.endpointUrl,
      })
      .from(llmConfig)
      .where(and(eq(llmConfig.tenantId, args.tenantId), eq(llmConfig.providerName, args.provider)))
      .orderBy(asc(llmConfig.id))
      .limit(1);
    return rows[0] ?? null;
  }

  // Default selection: honour `tenants.settings.defaultLlmProvider` if set,
  // otherwise fall back to the first row by insertion order.
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
    .orderBy(asc(llmConfig.id));

  let pick = rows[0] ?? null;
  if (defaultProvider) {
    const match = rows.find((r) => r.providerName === defaultProvider);
    if (match) pick = match;
  }
  return pick;
}

/** Map a raw DB row to the domain shape, decrypting the key. */
function mapLlmRow(tenantId: string, row: LlmRow): LlmProviderConfig | null {
  if (!isLlmProviderType(row.providerName)) return null;
  const apiKeyRef = row.apiKeyEncrypted ? decryptProviderKey(tenantId, row.apiKeyEncrypted) : "";
  return {
    provider: row.providerName,
    model: row.modelName,
    apiKeyRef,
    endpointUrl: row.endpointUrl ?? undefined,
  };
}

/**
 * Fetch the preferred `LlmProviderConfig` for a tenant (the default
 * selection). See file-level docs for the selection strategy.
 */
export async function getLlmConfig(
  deps: ConfigResolverDeps,
  args: { tenantId: string },
): Promise<LlmProviderConfig | null> {
  const now = (deps.now ?? Date.now)();
  const key = llmDefaultKey(args.tenantId);
  const cached = readCache<LlmProviderConfig | null>(key, now);
  if (cached !== undefined) return cached;

  const row = await fetchLlmRow(deps, { tenantId: args.tenantId });
  const result = row ? mapLlmRow(args.tenantId, row) : null;
  writeCache(key, args.tenantId, freezeConfig(result), now);
  return result;
}

/**
 * Fetch the `LlmProviderConfig` for a tenant + specific provider (e.g. the
 * Step 8 LLM factory uses this to resolve an adapter for a guardrail or judge
 * model). Returns `null` when the tenant has no row for that provider.
 */
export async function getLlmConfigByProvider(
  deps: ConfigResolverDeps,
  args: { tenantId: string; provider: LlmProviderType },
): Promise<LlmProviderConfig | null> {
  const now = (deps.now ?? Date.now)();
  const key = llmProviderKey(args.tenantId, args.provider);
  const cached = readCache<LlmProviderConfig | null>(key, now);
  if (cached !== undefined) return cached;

  const row = await fetchLlmRow(deps, {
    tenantId: args.tenantId,
    provider: args.provider,
  });
  const result = row ? mapLlmRow(args.tenantId, row) : null;
  writeCache(key, args.tenantId, freezeConfig(result), now);
  return result;
}
