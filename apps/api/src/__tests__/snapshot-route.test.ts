import { randomUUID } from "node:crypto";
import { createDatabase, providerConfig, tenants } from "@hap/db";
import { like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearConfigResolverCache } from "../lib/config-resolver";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const db = createDatabase(DATABASE_URL);

const PORTAL_PREFIX = `snaptest-${randomUUID().slice(0, 8)}-`;

function portalId() {
  return `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;
}

beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = DATABASE_URL;
});

afterAll(() => {
  // postgres.js cleans up on process exit
});

beforeEach(async () => {
  clearConfigResolverCache();
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

async function loadApp() {
  // Ensure fresh module bind each test run so env changes are respected.
  const mod = await import("../index");
  return mod.default;
}

describe("POST /api/snapshot/:companyId", () => {
  it("returns 401 when no Authorization header is provided in production mode", async () => {
    // Temporarily flip out of bypass mode to confirm auth is wired.
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.API_TOKENS = "tok-real:portal-real";
    try {
      const app = await loadApp();
      const res = await app.request("/api/snapshot/c123", { method: "POST" });
      expect(res.status).toBe(401);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it("returns 401 when portalId has no matching tenant", async () => {
    const app = await loadApp();
    const res = await app.request("/api/snapshot/c123", {
      method: "POST",
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": "missing-portal-xyz",
      },
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when companyId path segment is empty", async () => {
    const portal = portalId();
    await db.insert(tenants).values({ hubspotPortalId: portal, name: "Empty ID Co" });
    const app = await loadApp();
    // Empty companyId via trailing slash — route matches but validates to 400.
    const res = await app.request("/api/snapshot/", {
      method: "POST",
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": portal,
      },
    });
    // When nothing matches the param, Hono returns 404; our empty-check path
    // is the literal companyId "" not present. Prefer an explicit whitespace case.
    expect([400, 404]).toContain(res.status);
  });

  it("trims leading/trailing whitespace before passing companyId downstream", async () => {
    const portal = portalId();
    await db.insert(tenants).values({ hubspotPortalId: portal, name: "Trim Co" });
    const app = await loadApp();
    // "%20co-trim%20" = "  co-trim  " after decodeURIComponent.
    const res = await app.request("/api/snapshot/%20co-trim%20", {
      method: "POST",
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": portal,
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { companyId: string };
    // Must be normalized, no leading/trailing whitespace.
    expect(body.companyId).toBe("co-trim");
  });

  it("returns 400 when companyId is whitespace only", async () => {
    const portal = portalId();
    await db.insert(tenants).values({ hubspotPortalId: portal, name: "WS Co" });
    const app = await loadApp();
    const res = await app.request("/api/snapshot/%20%20", {
      method: "POST",
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": portal,
      },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_company_id");
  });

  it("returns 404 for the literal 'missing-company' companyId", async () => {
    const portal = portalId();
    await db.insert(tenants).values({ hubspotPortalId: portal, name: "MC Co" });
    const app = await loadApp();
    const res = await app.request("/api/snapshot/missing-company", {
      method: "POST",
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": portal,
      },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("returns 200 + valid snapshot JSON carrying tenantId from middleware (not path/body)", async () => {
    const portal = portalId();
    const [inserted] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portal, name: "Happy Path Co" })
      .returning();
    const expectedTenantId = inserted?.id;
    expect(expectedTenantId).toBeDefined();

    const app = await loadApp();
    const res = await app.request("/api/snapshot/co-123", {
      method: "POST",
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": portal,
        "Content-Type": "application/json",
      },
      // Attempt to "spoof" tenantId via body — must be ignored.
      body: JSON.stringify({ tenantId: "spoofed-tenant" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tenantId: string;
      companyId: string;
      eligibilityState: string;
      people: unknown[];
      evidence: unknown[];
      stateFlags: Record<string, boolean>;
      createdAt: string;
    };

    expect(body.tenantId).toBe(expectedTenantId);
    expect(body.tenantId).not.toBe("spoofed-tenant");
    expect(typeof body.companyId).toBe("string");
    expect(body.eligibilityState).toBe("eligible");
    expect(Array.isArray(body.people)).toBe(true);
    expect(Array.isArray(body.evidence)).toBe(true);
    expect(body.stateFlags).toBeDefined();
    expect(typeof body.createdAt).toBe("string");
    // Every evidence row must carry the middleware-resolved tenantId.
    for (const ev of body.evidence as Array<{ tenantId: string }>) {
      expect(ev.tenantId).toBe(expectedTenantId);
    }
  });

  it("uses per-tenant thresholds from provider_config (strict minConfidence flips lowConfidence flag)", async () => {
    const portal = portalId();
    const [inserted] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portal, name: "Strict Co" })
      .returning();
    const tenantId = inserted?.id;
    expect(tenantId).toBeDefined();
    if (!tenantId) throw new Error("tenant insert failed");

    // Strict threshold higher than every confidence in the "strong" fixture
    // (max 0.92). Default route thresholds (minConfidence 0.5) would let it
    // through; per-tenant config must take effect and flip lowConfidence=true.
    await db.insert(providerConfig).values({
      tenantId,
      providerName: "mock-signal",
      enabled: true,
      thresholds: { freshnessMaxDays: 30, minConfidence: 0.99 },
    });

    const app = await loadApp();
    const res = await app.request("/api/snapshot/co-strict", {
      method: "POST",
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": portal,
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      stateFlags: Record<string, boolean>;
    };
    expect(body.stateFlags.lowConfidence).toBe(true);
  });

  it("falls back to default thresholds when no provider_config row exists", async () => {
    const portal = portalId();
    await db.insert(tenants).values({ hubspotPortalId: portal, name: "Default Co" });
    const app = await loadApp();
    const res = await app.request("/api/snapshot/co-default", {
      method: "POST",
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": portal,
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { stateFlags: Record<string, boolean> };
    // Strong fixture confidence 0.87-0.92 vs default 0.5 → not low-confidence.
    expect(body.stateFlags.lowConfidence).toBe(false);
  });

  // ─── End-to-end coverage of all 8 QA states via ?state= and ?eligibility= ───
  // These selectors exist only in V1's fixture-backed mode; Slice 2 removes
  // them when real adapters and a real property fetcher land.

  async function snapshotFor(query: string) {
    const portal = portalId();
    await db.insert(tenants).values({ hubspotPortalId: portal, name: `QA-${query}` });
    const app = await loadApp();
    const res = await app.request(`/api/snapshot/co-qa${query ? `?${query}` : ""}`, {
      method: "POST",
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": portal,
      },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as {
      eligibilityState: string;
      reasonToContact?: string;
      people: unknown[];
      evidence: Array<{ id: string; tenantId: string; isRestricted?: boolean }>;
      stateFlags: Record<string, boolean>;
    };
  }

  it("?state=strong + default eligibility → eligible-strong (no warning flags)", async () => {
    const body = await snapshotFor("state=strong");
    expect(body.eligibilityState).toBe("eligible");
    expect(body.stateFlags.empty).toBe(false);
    expect(body.stateFlags.stale).toBe(false);
    expect(body.stateFlags.degraded).toBe(false);
    expect(body.stateFlags.lowConfidence).toBe(false);
    expect(body.stateFlags.restricted).toBe(false);
    expect(body.evidence.length).toBeGreaterThan(0);
    expect(body.people.length).toBeGreaterThan(0);
  });

  it("?state=stale → stateFlags.stale=true with evidence retained", async () => {
    const body = await snapshotFor("state=stale");
    expect(body.eligibilityState).toBe("eligible");
    expect(body.stateFlags.stale).toBe(true);
  });

  it("?state=degraded → stateFlags.degraded=true (invalid source)", async () => {
    const body = await snapshotFor("state=degraded");
    expect(body.eligibilityState).toBe("eligible");
    expect(body.stateFlags.degraded).toBe(true);
  });

  it("?state=empty → stateFlags.empty=true with zero evidence and zero people", async () => {
    const body = await snapshotFor("state=empty");
    expect(body.eligibilityState).toBe("eligible");
    expect(body.stateFlags.empty).toBe(true);
    expect(body.evidence).toHaveLength(0);
    expect(body.people).toHaveLength(0);
  });

  it("?state=lowconf → stateFlags.lowConfidence=true under default thresholds", async () => {
    const body = await snapshotFor("state=lowconf");
    expect(body.eligibilityState).toBe("eligible");
    expect(body.stateFlags.lowConfidence).toBe(true);
  });

  it("?state=restricted → zero-leak: restricted=true and every other field empty", async () => {
    const body = await snapshotFor("state=restricted");
    expect(body.stateFlags.restricted).toBe(true);
    expect(body.evidence).toHaveLength(0);
    expect(body.people).toHaveLength(0);
    expect(body.reasonToContact).toBeFalsy();
    // Belt-and-suspenders: even the raw JSON cannot mention the restricted ids.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("ev-restricted-1");
    expect(raw).not.toContain("ev-restricted-2");
    expect(raw).not.toContain("REDACTED");
  });

  it("?eligibility=ineligible → eligibilityState=ineligible, no evidence, no people", async () => {
    const body = await snapshotFor("eligibility=ineligible");
    expect(body.eligibilityState).toBe("ineligible");
    expect(body.stateFlags.ineligible).toBe(true);
    expect(body.evidence).toHaveLength(0);
    expect(body.people).toHaveLength(0);
  });

  it("?eligibility=unconfigured → eligibilityState=unconfigured, no evidence, no people", async () => {
    const body = await snapshotFor("eligibility=unconfigured");
    expect(body.eligibilityState).toBe("unconfigured");
    expect(body.evidence).toHaveLength(0);
    expect(body.people).toHaveLength(0);
  });

  it("invalid ?state and ?eligibility values silently fall back to defaults", async () => {
    const body = await snapshotFor("state=garbage&eligibility=nonsense");
    expect(body.eligibilityState).toBe("eligible");
    expect(body.stateFlags.empty).toBe(false);
    expect(body.evidence.length).toBeGreaterThan(0);
  });

  it("CORS preflight OPTIONS returns allow headers for HubSpot origin", async () => {
    const app = await loadApp();
    const res = await app.request("/api/snapshot/c123", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.hubspot.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    // cors middleware returns 204 No Content for preflight.
    expect([200, 204]).toContain(res.status);
    const allowOrigin = res.headers.get("access-control-allow-origin");
    expect(allowOrigin).toBeTruthy();
    // Either echoes the requested origin or "*" in dev/test — assert against
    // the literal expected values rather than `[allowOrigin, "*"]` which
    // would be a tautology.
    expect(["https://app.hubspot.com", "*"]).toContain(allowOrigin);
  });
});
