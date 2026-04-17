import {
  createSnapshot,
  createStateFlags,
  type LlmProviderConfig,
  type ProviderConfig,
  type ThresholdConfig,
} from "@hap/config";
import type { Database } from "@hap/db";
import { Hono } from "hono";
import { createLlmAdapter, wrapWithGuards } from "../adapters/llm/factory";
import type { LlmAdapter } from "../adapters/llm-adapter";
import type { ProviderAdapter } from "../adapters/provider-adapter";
import { createSignalAdapter, wrapSignalWithGuards } from "../adapters/signal/factory";
import { DEFAULT_THRESHOLDS, getLlmConfig, getProviderConfig } from "../lib/config-resolver";
import { TenantAccessRevokedError } from "../lib/hubspot-client";
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
 * Slice 3 pipeline:
 *   resolve adapters → if either missing, return `unconfigured` →
 *   eligibility gate → signal fetch → dominant signal → reason text
 *   → contact fetcher → ranked people → assembled Snapshot.
 *
 * Tenant safety: `tenantId` is ALWAYS sourced from `c.get('tenantId')` set by
 * the upstream tenant middleware. Body-provided tenantIds are ignored and the
 * assembler re-stamps evidence with the middleware-resolved tenantId.
 *
 * Adapter resolution: if a tenant has no `llm_config` or no enabled
 * `provider_config` row (or adapter construction fails), the route
 * short-circuits with `eligibilityState: "unconfigured"` instead of silently
 * serving mock data. Mock adapters remain only in `__tests__/` fixtures.
 */
export const snapshotRoutes = new Hono<{ Variables: Vars }>();

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

/**
 * Fallback thresholds when the resolved signal provider row does not carry
 * valid thresholds. In Slice 3 this only fires when the signal resolution
 * DID find a real provider row (otherwise the route short-circuits to
 * unconfigured). Returns {@link DEFAULT_THRESHOLDS}.
 */
function fallbackThresholds(): ThresholdConfig {
  return DEFAULT_THRESHOLDS;
}

/**
 * Resolve the LLM adapter for a tenant.
 *
 * 1. Look up the tenant's default `llm_config` row via the resolver.
 * 2. If present, build the real provider adapter via {@link createLlmAdapter}
 *    and wrap with rate-limiter + observability.
 * 3. If absent or construction fails, return `null`. The caller short-circuits
 *    to an `eligibilityState: "unconfigured"` snapshot. Mock adapters are no
 *    longer used in route code (Slice 3).
 */
async function resolveLlmAdapter(
  db: Database,
  tenantId: string,
  correlationId: string | undefined,
): Promise<LlmAdapter | null> {
  let cfg: LlmProviderConfig | null = null;
  try {
    cfg = await getLlmConfig({ db }, { tenantId });
  } catch {
    cfg = null;
  }

  if (!cfg) {
    return null;
  }

  // M24: construction can throw on malformed config (e.g., provider=custom
  // with a missing endpoint_url, which is nullable in the schema). One
  // misconfigured tenant returns unconfigured — not a 500.
  let real: LlmAdapter;
  try {
    real = createLlmAdapter(cfg);
  } catch (err) {
    console.error("llm_adapter_construction_failed", {
      tenantId,
      provider: cfg.provider,
      errorClass: err instanceof Error ? err.constructor.name : typeof err,
    });
    return null;
  }

  return wrapWithGuards(real, {
    tenantId,
    correlationId,
    rateLimiter: getProcessRateLimiter(),
  });
}

/**
 * Signal providers probed from `provider_config` rows in listed order; first
 * enabled match wins.
 *
 * Slice 3 adds `news` (now a real adapter). `hubspot-enrichment` stays out
 * until the adapter body is implemented — its factory throws at construction,
 * which `resolveSignalAdapter` treats the same as "no config row" = `null`.
 */
const REAL_SIGNAL_PROVIDERS = ["exa", "news"] as const;

/**
 * Successful signal resolution — contains the adapter plus per-provider
 * config (allow/block lists, thresholds).
 */
type SignalResolution = {
  adapter: ProviderAdapter;
  allowList?: string[];
  blockList?: string[];
  thresholds?: ThresholdConfig;
};

/**
 * Resolve the signal adapter for a tenant.
 *
 * Probes `provider_config` for each of {@link REAL_SIGNAL_PROVIDERS} in order.
 * On the first enabled hit, builds the real adapter and wraps with guards.
 * Returns `null` when no enabled provider row exists or adapter construction
 * fails. The caller short-circuits to `eligibilityState: "unconfigured"`.
 */
async function resolveSignalAdapter(
  db: Database,
  tenantId: string,
  correlationId: string | undefined,
): Promise<SignalResolution | null> {
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
      // provider, ultimately returning null below.
    }
  }

  if (!chosen) {
    return null;
  }

  // Construction can throw — e.g., required tenant-scoped deps are missing,
  // or a provider config row has a non-null field that's nullable in the
  // schema. Treat as unconfigured, not a 500.
  let real: ProviderAdapter;
  try {
    real = createSignalAdapter(chosen, {
      db,
      tenantId,
    });
  } catch (err) {
    console.error("signal_adapter_construction_failed", {
      tenantId,
      provider: chosen.name,
      errorClass: err instanceof Error ? err.constructor.name : typeof err,
    });
    return null;
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

function isTenantAccessRevokedError(error: unknown): boolean {
  return (
    error instanceof TenantAccessRevokedError ||
    (error instanceof Error && error.name === "TenantAccessRevokedError")
  );
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

  const eligibilityParam = c.req.query("eligibility");
  const mode: EligibilityMode = isEligibilityMode(eligibilityParam) ? eligibilityParam : "eligible";

  try {
    const db = c.get("db");
    if (!db) {
      throw new Error("tenant-scoped db handle missing from request context");
    }
    const correlationId = c.get("correlationId");
    const llmAdapter = await resolveLlmAdapter(db, tenantId, correlationId);
    const signal = await resolveSignalAdapter(db, tenantId, correlationId);

    // Short-circuit: if either adapter could not be resolved, the tenant's
    // provider configuration is incomplete. Return an explicit unconfigured
    // snapshot instead of silently serving mock data.
    if (!llmAdapter || !signal) {
      const unconfiguredSnapshot = createSnapshot(tenantId, {
        companyId,
        eligibilityState: "unconfigured",
        reasonToContact: undefined,
        people: [],
        evidence: [],
        stateFlags: createStateFlags({ empty: true }),
        createdAt: new Date(),
      });
      return c.json(unconfiguredSnapshot, 200);
    }

    const thresholds = signal.thresholds ?? fallbackThresholds();
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
    if (isTenantAccessRevokedError(err)) {
      console.warn("snapshot_route.tenant_access_revoked", {
        tenantId,
        companyId,
        eligibilityMode: mode,
        errorClass: err instanceof Error ? err.constructor.name : typeof err,
      });
      return c.json(
        {
          error: "tenant_access_revoked",
          detail: "hubspot access revoked or app uninstalled for tenant",
        },
        401,
      );
    }
    // Log a stable error CLASS + safe request context. Never the raw
    // err.message — external clients can smuggle URLs / tenant data / auth
    // material into Error.message and we don't want that in shared logs.
    console.error("snapshot_route_error", {
      tenantId,
      companyId,
      eligibilityMode: mode,
      errorClass: err instanceof Error ? err.constructor.name : typeof err,
    });
    return c.json({ error: "internal_error" }, 500);
  }
});

export default snapshotRoutes;
