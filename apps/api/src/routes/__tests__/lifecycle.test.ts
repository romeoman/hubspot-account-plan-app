/**
 * Tests for POST /webhooks/hubspot/lifecycle.
 *
 * Receiver for HubSpot app-lifecycle webhook events. Payload shape comes
 * directly from HubSpot's webhook v3 journal spec (per Slice 6 preflight
 * notes):
 *
 *   [
 *     {
 *       eventId: number,
 *       subscriptionId: number,
 *       portalId: number,
 *       appId: number,
 *       occurredAt: number,
 *       subscriptionType: "APP_LIFECYCLE_EVENT",
 *       attemptNumber: number,
 *       eventTypeId: "4-1909196" | "4-1916193" | string,
 *       sourceId: string
 *     }, ...
 *   ]
 *
 * IDs (verified in docs/slice-6-preflight-notes.md):
 *   - 4-1909196  →  app_install
 *   - 4-1916193  →  app_uninstall
 */
import { createHmac, randomUUID } from "node:crypto";
import { createDatabase, tenantHubspotOauth, tenants } from "@hap/db";
import { eq, like } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { __resetEncryptionCacheForTests, encryptProviderKey } from "../../lib/encryption";
import { lifecycleWebhookRoutes } from "../lifecycle";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("lifecycle.test.ts requires DATABASE_URL");
}

const db = createDatabase(DATABASE_URL);
const PORTAL_PREFIX = `lifecyclewh-${randomUUID().slice(0, 8)}-`;

const LIFECYCLE_EVENT_TYPE_INSTALL = "4-1909196";
const LIFECYCLE_EVENT_TYPE_UNINSTALL = "4-1916193";

const TEST_CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET ?? "";
if (TEST_CLIENT_SECRET.length === 0) {
  throw new Error("lifecycle.test.ts requires HUBSPOT_CLIENT_SECRET (seeded by vitest.setup.ts)");
}

function portalId() {
  return `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;
}

function buildApp() {
  const app = new Hono();
  app.route("/webhooks/hubspot/lifecycle", lifecycleWebhookRoutes({ db }));
  return app;
}

/**
 * Compute HubSpot v3 signature for a given request exactly as the middleware
 * reconstructs it: method + decodeURIComponent(url) + body + timestamp.
 *
 * The `url` string passed in MUST match what the Hono request will report
 * via `c.req.url` — for `app.request(path, init)` on an unbound Hono app
 * that is `http://localhost{path}`.
 */
function signV3(params: {
  clientSecret: string;
  method: string;
  url: string;
  body: string;
  timestamp: number;
}): string {
  const raw = `${params.method}${decodeURIComponent(params.url)}${params.body}${params.timestamp}`;
  return createHmac("sha256", params.clientSecret).update(raw, "utf8").digest("base64");
}

async function seedTenant(customPortalId?: string) {
  const pid = customPortalId ?? portalId();
  const [tenant] = await db
    .insert(tenants)
    .values({
      hubspotPortalId: pid,
      name: "Lifecycle Webhook Test",
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

async function postLifecycleRequest(params: {
  events: Array<Record<string, unknown>>;
  signatureOverride?: string;
  timestampOverride?: number;
}) {
  const app = buildApp();
  const url = "http://localhost/webhooks/hubspot/lifecycle";
  const body = JSON.stringify(params.events);
  const timestamp = params.timestampOverride ?? Date.now();
  const signature =
    params.signatureOverride ??
    signV3({
      clientSecret: TEST_CLIENT_SECRET,
      method: "POST",
      url,
      body,
      timestamp,
    });

  return app.request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hubspot-signature-v3": signature,
      "x-hubspot-request-timestamp": String(timestamp),
    },
    body,
  });
}

beforeEach(async () => {
  __resetEncryptionCacheForTests();
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

afterAll(async () => {
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

describe("POST /webhooks/hubspot/lifecycle — auth", () => {
  it("rejects a request with a tampered signature (401) and leaves the tenant untouched", async () => {
    const tenant = await seedTenant();

    const res = await postLifecycleRequest({
      events: [
        {
          eventId: 1,
          subscriptionId: 123,
          portalId: Number.isNaN(Number(tenant.hubspotPortalId))
            ? tenant.hubspotPortalId
            : Number(tenant.hubspotPortalId),
          appId: 12345,
          occurredAt: Date.now(),
          subscriptionType: "APP_LIFECYCLE_EVENT",
          attemptNumber: 0,
          eventTypeId: LIFECYCLE_EVENT_TYPE_UNINSTALL,
          sourceId: "source-1",
        },
      ],
      signatureOverride: "definitely-not-a-valid-signature",
    });

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("unauthorized");

    const [row] = await db.select().from(tenants).where(eq(tenants.id, tenant.id));
    expect(row?.isActive).toBe(true);
    expect(row?.deactivatedAt).toBeNull();
  });

  it("accepts a webhook signed against https when x-forwarded-proto: https is set on a http-scheme request (issue #24)", async () => {
    // On Vercel TLS terminates at the edge so the function's req.url is
    // http://..., but HubSpot signs the public https URL. The lifecycle
    // route must canonicalize via x-forwarded-proto for the same reason
    // the middleware does.
    const tenant = await seedTenant();
    const app = buildApp();
    const httpUrl = "http://localhost/webhooks/hubspot/lifecycle";
    const httpsUrl = "https://localhost/webhooks/hubspot/lifecycle";
    const events = [
      {
        eventId: 1,
        subscriptionId: 123,
        portalId: Number.isNaN(Number(tenant.hubspotPortalId))
          ? tenant.hubspotPortalId
          : Number(tenant.hubspotPortalId),
        appId: 12345,
        occurredAt: Date.now(),
        subscriptionType: "APP_LIFECYCLE_EVENT",
        attemptNumber: 0,
        eventTypeId: LIFECYCLE_EVENT_TYPE_UNINSTALL,
        sourceId: "source-1",
      },
    ];
    const body = JSON.stringify(events);
    const timestamp = Date.now();
    const signature = signV3({
      clientSecret: TEST_CLIENT_SECRET,
      method: "POST",
      url: httpsUrl,
      body,
      timestamp,
    });

    const res = await app.request(httpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hubspot-signature-v3": signature,
        "x-hubspot-request-timestamp": String(timestamp),
        "x-forwarded-proto": "https",
      },
      body,
    });
    expect(res.status).toBe(200);
  });
});

describe("POST /webhooks/hubspot/lifecycle — app_uninstall (4-1916193)", () => {
  it("deactivates the matching tenant and clears its oauth credentials", async () => {
    const tenant = await seedTenant();
    const occurredAt = Date.now() - 1000;

    const res = await postLifecycleRequest({
      events: [
        {
          eventId: 42,
          subscriptionId: 123,
          portalId: tenant.hubspotPortalId,
          appId: 12345,
          occurredAt,
          subscriptionType: "APP_LIFECYCLE_EVENT",
          attemptNumber: 0,
          eventTypeId: LIFECYCLE_EVENT_TYPE_UNINSTALL,
          sourceId: "source-1",
        },
      ],
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      received: number;
      applied: number;
      ignored: number;
    };
    expect(body.received).toBe(1);
    expect(body.applied).toBe(1);
    expect(body.ignored).toBe(0);

    const [row] = await db.select().from(tenants).where(eq(tenants.id, tenant.id));
    const oauthRows = await db
      .select()
      .from(tenantHubspotOauth)
      .where(eq(tenantHubspotOauth.tenantId, tenant.id));
    expect(row?.isActive).toBe(false);
    expect(row?.deactivationReason).toBe("hubspot_app_uninstalled");
    expect(oauthRows).toHaveLength(0);
  });
});

describe("POST /webhooks/hubspot/lifecycle — app_install (4-1909196)", () => {
  it("reactivates a previously-deactivated tenant", async () => {
    const tenant = await seedTenant();

    // Simulate a prior uninstall so reactivation has something to flip.
    await db
      .update(tenants)
      .set({
        isActive: false,
        deactivatedAt: new Date("2026-04-17T12:00:00.000Z"),
        deactivationReason: "hubspot_app_uninstalled",
      })
      .where(eq(tenants.id, tenant.id));

    const res = await postLifecycleRequest({
      events: [
        {
          eventId: 99,
          subscriptionId: 123,
          portalId: tenant.hubspotPortalId,
          appId: 12345,
          occurredAt: Date.now(),
          subscriptionType: "APP_LIFECYCLE_EVENT",
          attemptNumber: 0,
          eventTypeId: LIFECYCLE_EVENT_TYPE_INSTALL,
          sourceId: "source-1",
        },
      ],
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      received: number;
      applied: number;
      ignored: number;
    };
    expect(body.applied).toBe(1);

    const [row] = await db.select().from(tenants).where(eq(tenants.id, tenant.id));
    expect(row?.isActive).toBe(true);
    expect(row?.deactivatedAt).toBeNull();
    expect(row?.deactivationReason).toBeNull();
  });
});

describe("POST /webhooks/hubspot/lifecycle — ignored paths", () => {
  it("ignores events with an unrecognised eventTypeId without mutating tenant state", async () => {
    const tenant = await seedTenant();

    const res = await postLifecycleRequest({
      events: [
        {
          eventId: 7,
          subscriptionId: 123,
          portalId: tenant.hubspotPortalId,
          appId: 12345,
          occurredAt: Date.now(),
          subscriptionType: "APP_LIFECYCLE_EVENT",
          attemptNumber: 0,
          eventTypeId: "4-0000000",
          sourceId: "source-1",
        },
      ],
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      received: number;
      applied: number;
      ignored: number;
    };
    expect(body.received).toBe(1);
    expect(body.applied).toBe(0);
    expect(body.ignored).toBe(1);

    const [row] = await db.select().from(tenants).where(eq(tenants.id, tenant.id));
    expect(row?.isActive).toBe(true);
    expect(row?.deactivatedAt).toBeNull();
  });

  it("returns 200 and treats unknown portalIds as a no-op (HubSpot retries would otherwise loop)", async () => {
    const unknownPortal = portalId(); // never inserted

    const res = await postLifecycleRequest({
      events: [
        {
          eventId: 8,
          subscriptionId: 123,
          portalId: unknownPortal,
          appId: 12345,
          occurredAt: Date.now(),
          subscriptionType: "APP_LIFECYCLE_EVENT",
          attemptNumber: 0,
          eventTypeId: LIFECYCLE_EVENT_TYPE_UNINSTALL,
          sourceId: "source-1",
        },
      ],
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      received: number;
      applied: number;
      ignored: number;
    };
    // Applied against a missing tenant is a no-op in the service layer, but
    // from the receiver's perspective the event was recognised and processed.
    expect(body.received).toBe(1);
    expect(body.applied).toBe(1);
    expect(body.ignored).toBe(0);
  });
});
