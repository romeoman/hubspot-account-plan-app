import type { ThresholdConfig } from "@hap/config";
import { createDatabase, type Database } from "@hap/db";
import { Hono } from "hono";
import { createMockLlmAdapter } from "../adapters/mock-llm-adapter";
import {
  createMockSignalAdapter,
  isMockSignalFixture,
  type MockSignalFixture,
} from "../adapters/mock-signal-adapter";
import { DEFAULT_THRESHOLDS, getProviderConfig } from "../lib/config-resolver";
import type { TenantVariables } from "../middleware/tenant";
import type { CompanyPropertyFetcher } from "../services/eligibility";
import type { ContactFetcher } from "../services/people-selector";
import { assembleSnapshot } from "../services/snapshot-assembler";

type Vars = TenantVariables & { portalId?: string };

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
    const thresholds = await resolveThresholds(db, tenantId);
    const snapshot = await assembleSnapshot(
      {
        db,
        providerAdapter: createMockSignalAdapter({ fixture }),
        llmAdapter: createMockLlmAdapter({ style: "short" }),
        propertyFetcher: pickPropertyFetcher(mode),
        contactFetcher: fixtureContactFetcher,
        thresholds,
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
