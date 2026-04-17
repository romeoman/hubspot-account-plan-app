import { randomUUID } from "node:crypto";
import { createDatabase, tenantHubspotOauth, tenants } from "@hap/db";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { __resetEncryptionCacheForTests, encryptProviderKey } from "../encryption";
import {
  type ApplyHubSpotLifecycleEventArgs,
  applyHubSpotLifecycleEvent,
  deactivateTenant,
  reactivateTenant,
} from "../tenant-lifecycle";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("tenant-lifecycle.test.ts requires DATABASE_URL");
}

const db = createDatabase(DATABASE_URL);
const PORTAL_PREFIX = `tenantlife-${randomUUID().slice(0, 8)}-`;
const ROOT_KEK_BASE64 = Buffer.alloc(32, 7).toString("base64");
let savedRootKek: string | undefined;

beforeAll(() => {
  savedRootKek = process.env.ROOT_KEK;
  process.env.ROOT_KEK = ROOT_KEK_BASE64;
  __resetEncryptionCacheForTests();
});

beforeEach(async () => {
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

afterAll(async () => {
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
  if (savedRootKek !== undefined) {
    process.env.ROOT_KEK = savedRootKek;
  } else {
    delete process.env.ROOT_KEK;
  }
  __resetEncryptionCacheForTests();
});

function portalId() {
  return `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;
}

async function seedTenant() {
  const [tenant] = await db
    .insert(tenants)
    .values({
      hubspotPortalId: portalId(),
      name: "Tenant Lifecycle Test",
    })
    .returning();

  if (!tenant) {
    throw new Error("failed to seed tenant");
  }

  await db.insert(tenantHubspotOauth).values({
    tenantId: tenant.id,
    accessTokenEncrypted: encryptProviderKey(tenant.id, "access-token-1"),
    refreshTokenEncrypted: encryptProviderKey(tenant.id, "refresh-token-1"),
    expiresAt: new Date("2026-04-20T10:00:00.000Z"),
    scopes: ["oauth", "crm.objects.companies.read"],
  });

  return tenant;
}

describe("tenant lifecycle service", () => {
  it("soft-deactivates the tenant and clears oauth credentials", async () => {
    const tenant = await seedTenant();
    const deactivatedAt = new Date("2026-04-17T12:00:00.000Z");

    await deactivateTenant({
      db,
      tenantId: tenant.id,
      reason: "hubspot_app_uninstalled",
      deactivatedAt,
    });

    const [tenantRow] = await db.select().from(tenants).where(eq(tenants.id, tenant.id));
    const oauthRows = await db
      .select()
      .from(tenantHubspotOauth)
      .where(eq(tenantHubspotOauth.tenantId, tenant.id));

    expect(tenantRow?.isActive).toBe(false);
    expect(tenantRow?.deactivatedAt).toEqual(deactivatedAt);
    expect(tenantRow?.deactivationReason).toBe("hubspot_app_uninstalled");
    expect(oauthRows).toHaveLength(0);
  });

  it("reactivates the same tenant identity and clears offboarding metadata", async () => {
    const tenant = await seedTenant();

    await deactivateTenant({
      db,
      tenantId: tenant.id,
      reason: "oauth_refresh_failed",
      deactivatedAt: new Date("2026-04-17T12:15:00.000Z"),
    });

    await reactivateTenant({
      db,
      tenantId: tenant.id,
    });

    const [tenantRow] = await db.select().from(tenants).where(eq(tenants.id, tenant.id));

    expect(tenantRow?.id).toBe(tenant.id);
    expect(tenantRow?.isActive).toBe(true);
    expect(tenantRow?.deactivatedAt).toBeNull();
    expect(tenantRow?.deactivationReason).toBeNull();
  });

  it("applies app_uninstall lifecycle events by portal id", async () => {
    const tenant = await seedTenant();
    const eventTime = new Date("2026-04-17T12:30:00.000Z");

    await applyHubSpotLifecycleEvent({
      db,
      portalId: tenant.hubspotPortalId,
      eventType: "app_uninstall",
      occurredAt: eventTime,
    });

    const [tenantRow] = await db.select().from(tenants).where(eq(tenants.id, tenant.id));
    const oauthRows = await db
      .select()
      .from(tenantHubspotOauth)
      .where(eq(tenantHubspotOauth.tenantId, tenant.id));

    expect(tenantRow?.isActive).toBe(false);
    expect(tenantRow?.deactivatedAt).toEqual(eventTime);
    expect(tenantRow?.deactivationReason).toBe("hubspot_app_uninstalled");
    expect(oauthRows).toHaveLength(0);
  });

  it("reactivates an existing tenant when an app_install lifecycle event arrives", async () => {
    const tenant = await seedTenant();

    await deactivateTenant({
      db,
      tenantId: tenant.id,
      reason: "hubspot_app_uninstalled",
      deactivatedAt: new Date("2026-04-17T12:45:00.000Z"),
    });

    await applyHubSpotLifecycleEvent({
      db,
      portalId: tenant.hubspotPortalId,
      eventType: "app_install",
      occurredAt: new Date("2026-04-17T13:00:00.000Z"),
    });

    const [tenantRow] = await db.select().from(tenants).where(eq(tenants.id, tenant.id));

    expect(tenantRow?.id).toBe(tenant.id);
    expect(tenantRow?.isActive).toBe(true);
    expect(tenantRow?.deactivatedAt).toBeNull();
    expect(tenantRow?.deactivationReason).toBeNull();
  });

  it("is a no-op when no tenant matches the lifecycle portal id", async () => {
    const tenant = await seedTenant();

    await expect(
      applyHubSpotLifecycleEvent({
        db,
        portalId: portalId(),
        eventType: "app_uninstall",
        occurredAt: new Date("2026-04-17T13:15:00.000Z"),
      }),
    ).resolves.toBeUndefined();

    const [tenantRow] = await db.select().from(tenants).where(eq(tenants.id, tenant.id));
    const oauthRows = await db
      .select()
      .from(tenantHubspotOauth)
      .where(eq(tenantHubspotOauth.tenantId, tenant.id));

    expect(tenantRow?.isActive).toBe(true);
    expect(tenantRow?.deactivatedAt).toBeNull();
    expect(tenantRow?.deactivationReason).toBeNull();
    expect(oauthRows).toHaveLength(1);
  });

  it("does not reactivate on unexpected lifecycle event types", async () => {
    const tenant = await seedTenant();

    await deactivateTenant({
      db,
      tenantId: tenant.id,
      reason: "hubspot_app_uninstalled",
      deactivatedAt: new Date("2026-04-17T12:45:00.000Z"),
    });

    await expect(
      applyHubSpotLifecycleEvent({
        db,
        portalId: tenant.hubspotPortalId,
        eventType: "unexpected" as ApplyHubSpotLifecycleEventArgs["eventType"],
        occurredAt: new Date("2026-04-17T13:30:00.000Z"),
      }),
    ).resolves.toBeUndefined();

    const [tenantRow] = await db.select().from(tenants).where(eq(tenants.id, tenant.id));

    expect(tenantRow?.isActive).toBe(false);
    expect(tenantRow?.deactivatedAt).toBeTruthy();
    expect(tenantRow?.deactivationReason).toBe("hubspot_app_uninstalled");
  });

  it("fails fast when deactivating a missing tenant", async () => {
    await expect(
      deactivateTenant({
        db,
        tenantId: randomUUID(),
        reason: "hubspot_app_uninstalled",
      }),
    ).rejects.toThrow(/tenant not found/i);
  });

  it("fails fast when reactivating a missing tenant", async () => {
    await expect(
      reactivateTenant({
        db,
        tenantId: randomUUID(),
      }),
    ).rejects.toThrow(/tenant not found/i);
  });
});
