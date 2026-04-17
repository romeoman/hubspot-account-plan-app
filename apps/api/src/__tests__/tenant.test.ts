import { randomUUID } from "node:crypto";
import { createDatabase, tenants } from "@hap/db";
import { eq, like } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type TenantVariables, tenantMiddleware } from "../middleware/tenant";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const db = createDatabase(DATABASE_URL);

// Unique prefix so this file's cleanup never races with other test files
// that also touch the `tenants` table (e.g. packages/db schema tests).
const PORTAL_PREFIX = `mwtest-${randomUUID().slice(0, 8)}-`;

function portalId() {
  return `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;
}

/**
 * Build a minimal Hono app that seeds `portalId` into context (simulating
 * what auth.ts will do in Step 5) and then mounts tenantMiddleware.
 */
function buildTestApp(seedPortalId: string | undefined) {
  const app = new Hono<{ Variables: TenantVariables }>();
  app.use("*", async (c, next) => {
    if (seedPortalId !== undefined) {
      c.set("portalId", seedPortalId);
    }
    await next();
  });
  app.use("*", tenantMiddleware({ db }));
  app.get("/whoami", (c) => {
    return c.json({
      tenantId: c.get("tenantId"),
      tenantName: c.get("tenant")?.name,
    });
  });
  return app;
}

beforeAll(async () => {
  // sanity check connection
  await db.execute("SELECT 1" as unknown as never).catch(() => {
    /* drizzle.execute shape varies; ignore */
  });
});

afterAll(async () => {
  // postgres.js client — close via underlying sql ended by process exit.
});

beforeEach(async () => {
  // Only delete tenants created by THIS test file to avoid racing with
  // packages/db/src/__tests__/schema.test.ts (which also truncates tenants).
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

describe("tenant middleware", () => {
  it("resolves tenant when portalId matches a seeded tenant and sets context vars", async () => {
    const portal = portalId();
    const [inserted] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portal, name: "Acme" })
      .returning();
    const expectedId = inserted?.id;
    expect(expectedId).toBeDefined();

    const app = buildTestApp(portal);
    const res = await app.request("/whoami");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenantId: string; tenantName: string };
    expect(body.tenantId).toBe(expectedId);
    expect(body.tenantName).toBe("Acme");
  });

  it("returns 401 when portalId is missing from context", async () => {
    const app = buildTestApp(undefined);
    const res = await app.request("/whoami");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe("unauthorized");
    expect(body.detail).toBe("tenant not found");
  });

  it("returns 401 when portalId has no matching tenant row", async () => {
    const app = buildTestApp("portal-nonexistent-xyz");
    const res = await app.request("/whoami");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe("unauthorized");
    expect(body.detail).toBe("tenant not found");
  });

  it("returns 401 when the tenant exists but is deactivated", async () => {
    const portal = portalId();
    await db.insert(tenants).values({
      hubspotPortalId: portal,
      name: "Inactive Acme",
      isActive: false,
      deactivatedAt: new Date("2026-04-17T12:30:00.000Z"),
      deactivationReason: "hubspot_app_uninstalled",
    });

    const app = buildTestApp(portal);
    const res = await app.request("/whoami");

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe("tenant_inactive");
    expect(body.detail).toBe("tenant is deactivated");
  });

  it("tenant A's portal_id never resolves to tenant B's id (cross-tenant isolation)", async () => {
    const portalA = portalId();
    const portalB = portalId();
    const [a] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalA, name: "A" })
      .returning();
    const [b] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalB, name: "B" })
      .returning();

    const appA = buildTestApp(portalA);
    const resA = await appA.request("/whoami");
    const bodyA = (await resA.json()) as { tenantId: string };
    expect(bodyA.tenantId).toBe(a?.id);
    expect(bodyA.tenantId).not.toBe(b?.id);

    const appB = buildTestApp(portalB);
    const resB = await appB.request("/whoami");
    const bodyB = (await resB.json()) as { tenantId: string };
    expect(bodyB.tenantId).toBe(b?.id);
    expect(bodyB.tenantId).not.toBe(a?.id);

    // And a direct DB sanity check
    const [row] = await db.select().from(tenants).where(eq(tenants.hubspotPortalId, portalA));
    expect(row?.name).toBe("A");
  });
});
