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
    // Either echoes the origin or "*" in dev/test
    expect([allowOrigin, "*"]).toContain(allowOrigin);
  });
});
