import type { LlmProviderConfig, ProviderConfig, ThresholdConfig } from "@hap/config";
import { createDatabase, type Database } from "@hap/db";
import { Hono } from "hono";
import { createLlmAdapter, wrapWithGuards } from "../adapters/llm/factory";
import type { LlmAdapter } from "../adapters/llm-adapter";
import { createMockLlmAdapter } from "../adapters/mock-llm-adapter";
import {
  createMockSignalAdapter,
  isMockSignalFixture,
  type MockSignalFixture,
} from "../adapters/mock-signal-adapter";
import type { ProviderAdapter } from "../adapters/provider-adapter";
import { createSignalAdapter, wrapSignalWithGuards } from "../adapters/signal/factory";
import { DEFAULT_THRESHOLDS, getLlmConfig, getProviderConfig } from "../lib/config-resolver";
import { withObservability } from "../lib/observability";
import { getProcessRateLimiter } from "../lib/rate-limiter";
import type { CorrelationVariables } from "../middleware/correlation";
import type { TenantVariables } from "../middleware/tenant";
import type { CompanyPropertyFetcher } from "../services/eligibility";
import type { ContactFetcher } from "../services/people-selector";
import { assembleSnapshot } from "../services/snapshot-assembler";

type Vars = TenantVariables & CorrelationVariables & { portalId?: string };

/**
 * Normalize + validate companyId. Returns the trimmed value when valid, or
 * `null` when not. Caller must use the returned normalized value — never the
 * raw param — so downstream consumers never see leading/trailing whitespace.
 *
 * We accept the HubSpot numeric-string convention but stay permissive since
 * the CRM uses multiple record id shapes.
 */
function normalizeCompanyId(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 128) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Snapshot route module.
 *
 * Mounted under `/api/snapshot` in `index.ts`. Full route: `POST /api/snapshot/:companyId`.
 *
 * V1 pipeline (Step 8):
 *   eligibility gate → mock signal adapter → dominant signal → reason text
 *   → mock contact fetcher → ranked people → assembled Snapshot.
 *
 * Tenant safety: `tenantId` is ALWAYS sourced from `c.get('tenantId')` set by
 * the upstream tenant middleware. Body-provided tenantIds are ignored and the
 * assembler re-stamps evidence with the middleware-resolved tenantId.
 *
 * Trust thresholds: resolved per-tenant from `provider_config.thresholds`
 * (provider name `mock-signal` in V1, matching {@link createMockSignalAdapter}).
 * Falls back to {@link DEFAULT_THRESHOLDS} when the tenant has no row yet so
 * the route stays usable on a fresh install. Slice 2 will replace the
 * `mock-signal` provider name with the real adapter family selected per call.
 */
export const snapshotRoutes = new Hono<{ Variables: Vars }>();

const SIGNAL_PROVIDER_NAME = "mock-signal";

/** Reasonable bounds — guard against malformed or hostile DB rows. */
function isValidThresholds(t: ThresholdConfig): boolean {
  return (
    Number.isFinite(t.freshnessMaxDays) &&
    t.freshnessMaxDays >= 0 &&
    Number.isFinite(t.minConfidence) &&
    t.minConfidence >= 0 &&
    t.minConfidence <= 1
  );
}

async function resolveThresholds(db: Database, tenantId: string): Promise<ThresholdConfig> {
  try {
    const cfg = await getProviderConfig({ db }, { tenantId, providerName: SIGNAL_PROVIDER_NAME });
    if (cfg && isValidThresholds(cfg.thresholds)) {
      return cfg.thresholds;
    }
  } catch {
    // Resolver failure must not break the snapshot path — fall back to defaults.
  }
  return DEFAULT_THRESHOLDS;
}

/**
 * Resolve the LLM adapter for a tenant.
 *
 * 1. Look up the tenant's default `llm_config` row via the resolver.
 * 2. If present, build the real provider adapter via {@link createLlmAdapter}
 *    and wrap with rate-limiter + observability so every outbound call is
 *    structured-logged and correlation-ID-traced.
 * 3. If absent, fall back to the Slice 1 mock adapter. This preserves
 *    existing-fixture behavior for tenants that predate the Slice 2 seed
 *    script (Step 14). A structured `outcome=fallback` log line is emitted so
 *    operators can see when a fallback fires. Slice 3 removes this fallback
 *    once every tenant has a provisioned LLM row.
 */
async function resolveLlmAdapter(
  db: Database,
  tenantId: string,
  correlationId: string | undefined,
): Promise<LlmAdapter> {
  let cfg: LlmProviderConfig | null = null;
  try {
    cfg = await getLlmConfig({ db }, { tenantId });
  } catch {
    cfg = null;
  }

  if (!cfg) {
    await withObservability(
      async () => undefined,
      {
        tenantId,
        provider: "mock",
        operation: "llm.complete",
        correlationId,
      },
      () => ({ tokenUsage: { inputTokens: 0, outputTokens: 0 } }),
    );
    return createMockLlmAdapter({ style: "short" });
  }

  // M24: construction can throw on malformed config (e.g., provider=custom
  // with a missing endpoint_url, which is nullable in the schema). One
  // misconfigured tenant MUST NOT 500 the route — degrade to mock + log.
  let real: LlmAdapter;
  try {
    real = createLlmAdapter(cfg);
  } catch (err) {
    console.error("llm_adapter_construction_failed", {
      tenantId,
      provider: cfg.provider,
      errorClass: err instanceof Error ? err.constructor.name : typeof err,
    });
    return createMockLlmAdapter({ style: "short" });
  }

  return wrapWithGuards(real, {
    tenantId,
    correlationId,
    rateLimiter: getProcessRateLimiter(),
  });
}

/**
 * Real signal providers Slice 2 can resolve from `provider_config` rows.
 * Probed in listed order; first match wins.
 *
 * Slice 2 ONLY wires `exa` end-to-end. `hubspot-enrichment` and `news` are
 * scaffolded stubs that throw on call — including them here would 500 any
 * tenant that configures them (surfaced by cubic review P1). They are
 * re-added in Slice 3 alongside the adapter bodies. Tenants with those
 * provider rows today silently fall back to the mock adapter, which is
 * the same behavior as if the row didn't exist.
 */
const REAL_SIGNAL_PROVIDERS = ["exa"] as const;

/**
 * Resolve the signal adapter for a tenant.
 *
 * Mirrors {@link resolveLlmAdapter}. Probes `provider_config` for each of the
 * {@link REAL_SIGNAL_PROVIDERS} in order; on the first hit, builds the real
 * adapter via {@link createSignalAdapter} and wraps it with
 * {@link wrapSignalWithGuards} (rate limiter + observability). On no hit or
 * any resolver error, falls back to the Slice 1 {@link createMockSignalAdapter}
 * so fixture-driven behavior stays identical for tenants that predate the
 * Slice 2 seed script (Step 14). A structured `outcome=fallback` log line is
 * emitted so operators can see when a fallback fires.
 *
 * Slice 3: once every tenant has a provisioned `provider_config` row AND
 * the stub adapters (`hubspot-enrichment`, `news`) are replaced with real
 * bodies, the fallback is removed and the probe list in
 * {@link REAL_SIGNAL_PROVIDERS} is expanded to include them. Slice 2 only
 * probes `exa` — other provider rows fall through to the mock fallback.
 */
type SignalResolution = {
  adapter: ProviderAdapter;
  /** Allow-list from the resolved provider row; undefined on mock fallback. */
  allowList?: string[];
  /** Block-list from the resolved provider row; undefined on mock fallback. */
  blockList?: string[];
  /**
   * Thresholds from the resolved provider row; undefined on mock fallback so
   * the caller can fall back to `resolveThresholds()` (the legacy
   * `mock-signal` probe) or {@link DEFAULT_THRESHOLDS}. CodeRabbit M1:
   * without this, the route always used `mock-signal` thresholds even when
   * a real provider with tenant-specific thresholds was selected, causing
   * trust suppression + dominant-signal selection to run with stale values.
   */
  thresholds?: ThresholdConfig;
};

async function resolveSignalAdapter(
  db: Database,
  tenantId: string,
  fixture: MockSignalFixture,
  correlationId: string | undefined,
): Promise<SignalResolution> {
  let chosen: ProviderConfig | null = null;
  for (const providerName of REAL_SIGNAL_PROVIDERS) {
    try {
      const cfg = await getProviderConfig({ db }, { tenantId, providerName });
      if (cfg?.enabled) {
        chosen = cfg;
        break;
      }
    } catch {
      // Resolver failure must not break the snapshot path — try the next
      // provider, ultimately falling back to the mock adapter below.
    }
  }

  if (!chosen) {
    await withObservability(async () => undefined, {
      tenantId,
      provider: "mock",
      operation: "signal.fetch",
      correlationId,
    });
    return { adapter: createMockSignalAdapter({ fixture }) };
  }

  // M4: createSignalAdapter can throw at construction time — e.g., if a
  // future provider (hubspot-enrichment / news) is added back to the probe
  // list without injecting the required deps, or if a provider requires a
  // non-null field that's nullable in the schema. Fall back to mock rather
  // than 500 the snapshot response.
  let real: ProviderAdapter;
  try {
    real = createSignalAdapter(chosen);
  } catch (err) {
    console.error("signal_adapter_construction_failed", {
      tenantId,
      provider: chosen.name,
      errorClass: err instanceof Error ? err.constructor.name : typeof err,
    });
    await withObservability(async () => undefined, {
      tenantId,
      provider: "mock",
      operation: "signal.fetch",
      correlationId,
    });
    return { adapter: createMockSignalAdapter({ fixture }) };
  }

  const adapter = wrapSignalWithGuards(real, {
    tenantId,
    correlationId,
    rateLimiter: getProcessRateLimiter(),
  });
  return {
    adapter,
    allowList: chosen.allowList,
    blockList: chosen.blockList,
    thresholds: isValidThresholds(chosen.thresholds) ? chosen.thresholds : undefined,
  };
}

/**
 * V1 fixture property fetchers. Selected via `?eligibility=` query param so
 * the route can produce the eligible / ineligible / unconfigured snapshot
 * shapes end-to-end. Slice 2 replaces these with a real HubSpot CRM property
 * fetch (one fetcher, gating value comes from real CRM data).
 */
const eligiblePropertyFetcher: CompanyPropertyFetcher = async () => true;
const ineligiblePropertyFetcher: CompanyPropertyFetcher = async () => false;
const unconfiguredPropertyFetcher: CompanyPropertyFetcher = async () => undefined;

type EligibilityMode = "eligible" | "ineligible" | "unconfigured";
const ELIGIBILITY_MODES: readonly EligibilityMode[] = ["eligible", "ineligible", "unconfigured"];
function isEligibilityMode(v: unknown): v is EligibilityMode {
  return typeof v === "string" && (ELIGIBILITY_MODES as readonly string[]).includes(v);
}

function pickPropertyFetcher(mode: EligibilityMode): CompanyPropertyFetcher {
  switch (mode) {
    case "ineligible":
      return ineligiblePropertyFetcher;
    case "unconfigured":
      return unconfiguredPropertyFetcher;
    case "eligible":
      return eligiblePropertyFetcher;
  }
}

/**
 * V1 fixture contact fetcher — returns three ICP-shaped contacts for any
 * company. Step 9+ replace with a real HubSpot contact association fetch.
 */
const fixtureContactFetcher: ContactFetcher = async () => [
  { id: "contact-1", name: "Alex Champion", title: "VP Engineering" },
  { id: "contact-2", name: "Jordan Decider", title: "CTO" },
  { id: "contact-3", name: "Sam Influencer", title: "Head of Platform" },
];

/**
 * Memoized DB handle, keyed by DATABASE_URL so tests that flip the env
 * between cases still get a fresh handle. In production the URL is stable,
 * so we create one client wrapper per process and let postgres.js pool
 * connections internally.
 */
let cachedDb: { url: string; db: Database } | null = null;

/**
 * Lazy DB handle. No production fallback. If DATABASE_URL is unset, fail
 * loudly so a misconfigured deployment surfaces immediately instead of
 * quietly trying to connect to the dev Postgres on `localhost:5433`.
 */
function getDb(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The snapshot route refuses to connect to a default dev URL in any environment.",
    );
  }
  if (cachedDb && cachedDb.url === url) return cachedDb.db;
  const db = createDatabase(url);
  cachedDb = { url, db };
  return db;
}

snapshotRoutes.post("/:companyId", async (c) => {
  const rawCompanyId = c.req.param("companyId") ?? "";
  const decoded = decodeURIComponent(rawCompanyId);

  const companyId = normalizeCompanyId(decoded);
  if (!companyId) {
    return c.json({ error: "invalid_company_id" }, 400);
  }

  // Testability hook: reserved id for the 404 path.
  if (companyId === "missing-company") {
    return c.json({ error: "not_found" }, 404);
  }

  const tenantId = c.get("tenantId");
  if (!tenantId) {
    // Defensive — tenantMiddleware should have already returned 401.
    return c.json({ error: "unauthorized" }, 401);
  }

  // V1 fixture selectors. Default behavior unchanged: eligible + strong.
  // Invalid values silently fall back to defaults so callers can't induce
  // 4xx noise with typos. Slice 2 removes both selectors when real adapters
  // and a real property fetcher land.
  const stateParam = c.req.query("state");
  const fixture: MockSignalFixture = isMockSignalFixture(stateParam) ? stateParam : "strong";
  const eligibilityParam = c.req.query("eligibility");
  const mode: EligibilityMode = isEligibilityMode(eligibilityParam) ? eligibilityParam : "eligible";

  try {
    const db = getDb();
    const correlationId = c.get("correlationId");
    const llmAdapter = await resolveLlmAdapter(db, tenantId, correlationId);
    const signal = await resolveSignalAdapter(db, tenantId, fixture, correlationId);
    // M1: prefer thresholds from the resolved signal provider row when a
    // real provider was selected. Only fall back to the legacy mock-signal
    // probe when the signal resolution landed on the mock (no real row
    // matched). This keeps tenant-specific thresholds in sync with the
    // adapter actually fetching their evidence.
    const thresholds = signal.thresholds ?? (await resolveThresholds(db, tenantId));
    const snapshot = await assembleSnapshot(
      {
        db,
        providerAdapter: signal.adapter,
        llmAdapter,
        propertyFetcher: pickPropertyFetcher(mode),
        contactFetcher: fixtureContactFetcher,
        thresholds,
        allowList: signal.allowList,
        blockList: signal.blockList,
        // M13: trace continuity — the assembler threads this into the
        // next-move observability ctx so the whole request chain shares
        // one correlation ID in logs.
        correlationId,
      },
      { tenantId, companyId },
    );
    return c.json(snapshot, 200);
  } catch (err) {
    // Log a stable error CLASS + safe request context. Never the raw
    // err.message — external clients can smuggle URLs / tenant data / auth
    // material into Error.message and we don't want that in shared logs.
    console.error("snapshot_route_error", {
      tenantId,
      companyId,
      fixture,
      eligibilityMode: mode,
      errorClass: err instanceof Error ? err.constructor.name : typeof err,
    });
    return c.json({ error: "internal_error" }, 500);
  }
});

export default snapshotRoutes;
