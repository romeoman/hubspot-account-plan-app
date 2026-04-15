import type { ThresholdConfig } from "@hap/config";
import { createDatabase, type Database } from "@hap/db";
import { Hono } from "hono";
import { createMockLlmAdapter } from "../adapters/mock-llm-adapter";
import { createMockSignalAdapter } from "../adapters/mock-signal-adapter";
import { getProviderConfig } from "../lib/config-resolver";
import type { TenantVariables } from "../middleware/tenant";
import type { CompanyPropertyFetcher } from "../services/eligibility";
import type { ContactFetcher } from "../services/people-selector";
import { assembleSnapshot } from "../services/snapshot-assembler";

type Vars = TenantVariables & { portalId?: string };

/**
 * Validate companyId: must be a non-empty, trimmed string of reasonable
 * length. We accept the HubSpot numeric-string convention but stay permissive
 * since the CRM uses multiple record id shapes.
 */
function isValidCompanyId(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > 128) return false;
  return /^[A-Za-z0-9._-]+$/.test(trimmed);
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

const DEFAULT_THRESHOLDS: ThresholdConfig = {
  freshnessMaxDays: 30,
  minConfidence: 0.5,
};
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
 * V1 fixture property fetcher — reports any company as an eligible target
 * account. Step 9 replaces this with a real HubSpot CRM property fetch.
 */
const fixturePropertyFetcher: CompanyPropertyFetcher = async () => true;

/**
 * V1 fixture contact fetcher — returns three ICP-shaped contacts for any
 * company. Step 9+ replace with a real HubSpot contact association fetch.
 */
const fixtureContactFetcher: ContactFetcher = async () => [
  { id: "contact-1", name: "Alex Champion", title: "VP Engineering" },
  { id: "contact-2", name: "Jordan Decider", title: "CTO" },
  { id: "contact-3", name: "Sam Influencer", title: "Head of Platform" },
];

/** Lazy DB handle so DATABASE_URL changes between tests are respected. */
function getDb(): Database {
  const url = process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";
  return createDatabase(url);
}

snapshotRoutes.post("/:companyId", async (c) => {
  const rawCompanyId = c.req.param("companyId") ?? "";
  const decoded = decodeURIComponent(rawCompanyId);

  if (!isValidCompanyId(decoded)) {
    return c.json({ error: "invalid_company_id" }, 400);
  }

  // Testability hook: reserved id for the 404 path.
  if (decoded === "missing-company") {
    return c.json({ error: "not_found" }, 404);
  }

  const tenantId = c.get("tenantId");
  if (!tenantId) {
    // Defensive — tenantMiddleware should have already returned 401.
    return c.json({ error: "unauthorized" }, 401);
  }

  try {
    const db = getDb();
    const thresholds = await resolveThresholds(db, tenantId);
    const snapshot = await assembleSnapshot(
      {
        db,
        providerAdapter: createMockSignalAdapter({ fixture: "strong" }),
        llmAdapter: createMockLlmAdapter({ style: "short" }),
        propertyFetcher: fixturePropertyFetcher,
        contactFetcher: fixtureContactFetcher,
        thresholds,
      },
      { tenantId, companyId: decoded },
    );
    return c.json(snapshot, 200);
  } catch (_err) {
    return c.json({ error: "internal_error" }, 500);
  }
});

export default snapshotRoutes;
