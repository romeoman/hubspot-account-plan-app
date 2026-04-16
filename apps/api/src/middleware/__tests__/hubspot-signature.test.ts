/**
 * Tests for HubSpot signed-request middleware.
 *
 * Asserts the v3 spec (per developers.hubspot.com/docs/apps/developer-platform/
 * build-apps/authentication/request-validation, retrieved 2026-04-15):
 *   - Header:    X-HubSpot-Signature-v3 (base64 HMAC-SHA256)
 *   - Timestamp: X-HubSpot-Request-Timestamp (ms since epoch)
 *   - Raw:       method + decoded(uri) + body + timestamp
 *   - Freshness: 5 minutes
 */
import { createHmac, randomUUID } from "node:crypto";
import { createDatabase, tenants } from "@hap/db";
import { like } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withTenantTxHandle } from "../../lib/tenant-tx";
import {
  __resetHubspotSignatureCacheForTests,
  hubspotSignatureMiddleware,
} from "../hubspot-signature";
import { nonceMiddleware } from "../nonce";
import type { TenantVariables } from "../tenant";
import { tenantMiddleware } from "../tenant";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";
const db = createDatabase(DATABASE_URL);

const PORTAL_PREFIX = `sigtest-${randomUUID().slice(0, 8)}-`;
const portalId = () => `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;

type Vars = TenantVariables & {
  portalId?: string;
  userId?: string;
  rawBody?: string;
};

/**
 * Build a Hono app that runs the real signature middleware + tenant middleware
 * and exposes a probe GET/POST returning the resolved context.
 */
function buildApp(options?: { withNonce?: boolean }) {
  const app = new Hono<{ Variables: Vars }>();
  app.use("*", hubspotSignatureMiddleware());
  app.use("*", tenantMiddleware({ db }));
  if (options?.withNonce) {
    app.use("*", async (c, next) => {
      const tenantId = c.get("tenantId");
      if (!tenantId) {
        return next();
      }

      const handle = await withTenantTxHandle(db, tenantId);
      c.set("db", handle);
      try {
        await next();
      } finally {
        await handle.release();
      }
    });
    app.use("*", nonceMiddleware());
  }
  app.all("/probe", (c) =>
    c.json({
      portalId: c.get("portalId") ?? null,
      userId: c.get("userId") ?? null,
      tenantId: c.get("tenantId") ?? null,
    }),
  );
  return app;
}

/** Compute the HubSpot v3 signature for a given request. */
function signV3(params: {
  clientSecret: string;
  method: string;
  uri: string;
  body: string;
  timestamp: number;
}): string {
  const raw = `${params.method}${decodeURIComponent(params.uri)}${params.body}${params.timestamp}`;
  return createHmac("sha256", params.clientSecret).update(raw, "utf8").digest("base64");
}

/** Full URL the middleware will see — matches `${protocol}://${host}${path}`. */
const TEST_URL = "http://localhost/probe";

beforeEach(async () => {
  __resetHubspotSignatureCacheForTests();
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
  // Defense-in-depth: tests assume ALLOW_TEST_AUTH is on (set by .env.test.local).
  // Some tests explicitly unset it; we restore it each case.
  process.env.ALLOW_TEST_AUTH = "true";
  process.env.NODE_ENV = "test";
});

afterAll(() => {
  // postgres.js connection closes on process exit
});

describe("hubspotSignatureMiddleware — valid signatures", () => {
  it("accepts a valid POST signature + current timestamp + known portal", async () => {
    const portal = portalId();
    const [tenant] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portal, name: "SigAcme" })
      .returning();

    const secret = process.env.HUBSPOT_CLIENT_SECRET ?? "";
    expect(secret.length).toBeGreaterThan(0);

    const body = JSON.stringify({
      portalId: portal,
      userId: "u-1",
      companyId: "c-1",
    });
    const timestamp = Date.now();
    const signature = signV3({
      clientSecret: secret,
      method: "POST",
      uri: TEST_URL,
      body,
      timestamp,
    });

    const app = buildApp();
    const res = await app.request("/probe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HubSpot-Signature-v3": signature,
        "X-HubSpot-Request-Timestamp": String(timestamp),
      },
      body,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      portalId: string;
      userId: string;
      tenantId: string;
    };
    expect(json.portalId).toBe(portal);
    expect(json.userId).toBe("u-1");
    expect(json.tenantId).toBe(tenant?.id);
  });

  it("accepts a valid GET signature with portalId in query string", async () => {
    const portal = portalId();
    await db.insert(tenants).values({ hubspotPortalId: portal, name: "GetAcme" }).returning();

    const secret = process.env.HUBSPOT_CLIENT_SECRET ?? "";
    const url = `/probe?portalId=${encodeURIComponent(portal)}&userId=u-2`;
    const fullUrl = `http://localhost${url}`;
    const timestamp = Date.now();
    const signature = signV3({
      clientSecret: secret,
      method: "GET",
      uri: fullUrl,
      body: "",
      timestamp,
    });

    const app = buildApp();
    const res = await app.request(url, {
      method: "GET",
      headers: {
        "X-HubSpot-Signature-v3": signature,
        "X-HubSpot-Request-Timestamp": String(timestamp),
      },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { portalId: string; userId: string };
    expect(json.portalId).toBe(portal);
    expect(json.userId).toBe("u-2");
  });
});

describe("hubspotSignatureMiddleware — rejection paths", () => {
  it("rejects a missing signature header with 401", async () => {
    const app = buildApp();
    const res = await app.request("/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("unauthorized");
  });

  it("rejects a tampered body (signature mismatch) with 401", async () => {
    const secret = process.env.HUBSPOT_CLIENT_SECRET ?? "";
    const body = JSON.stringify({ portalId: "p-1", userId: "u-1" });
    const timestamp = Date.now();
    const signature = signV3({
      clientSecret: secret,
      method: "POST",
      uri: TEST_URL,
      body,
      timestamp,
    });

    const app = buildApp();
    // Swap body AFTER signing so signature no longer matches.
    const tamperedBody = JSON.stringify({
      portalId: "p-1",
      userId: "u-1",
      injected: "nope",
    });
    const res = await app.request("/probe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HubSpot-Signature-v3": signature,
        "X-HubSpot-Request-Timestamp": String(timestamp),
      },
      body: tamperedBody,
    });
    expect(res.status).toBe(401);
  });

  it("rejects a stale timestamp (> 5 min old) with 401", async () => {
    const secret = process.env.HUBSPOT_CLIENT_SECRET ?? "";
    const portal = portalId();
    await db.insert(tenants).values({ hubspotPortalId: portal, name: "Stale" }).returning();
    const body = JSON.stringify({ portalId: portal, userId: "u-1" });
    // 6 minutes ago
    const timestamp = Date.now() - 6 * 60 * 1000;
    const signature = signV3({
      clientSecret: secret,
      method: "POST",
      uri: TEST_URL,
      body,
      timestamp,
    });

    const app = buildApp();
    const res = await app.request("/probe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HubSpot-Signature-v3": signature,
        "X-HubSpot-Request-Timestamp": String(timestamp),
      },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("rejects a forged portal_id (signature valid but portal not in tenants) with 401", async () => {
    const secret = process.env.HUBSPOT_CLIENT_SECRET ?? "";
    const bogusPortal = portalId(); // never inserted
    const body = JSON.stringify({ portalId: bogusPortal, userId: "u-1" });
    const timestamp = Date.now();
    const signature = signV3({
      clientSecret: secret,
      method: "POST",
      uri: TEST_URL,
      body,
      timestamp,
    });

    const app = buildApp();
    const res = await app.request("/probe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HubSpot-Signature-v3": signature,
        "X-HubSpot-Request-Timestamp": String(timestamp),
      },
      body,
    });
    // signature middleware accepts, but tenant middleware returns 401.
    expect(res.status).toBe(401);
  });

  it("rejects a replayed request once timestamp becomes stale", async () => {
    const secret = process.env.HUBSPOT_CLIENT_SECRET ?? "";
    const portal = portalId();
    await db.insert(tenants).values({ hubspotPortalId: portal, name: "Replay" });
    const body = JSON.stringify({ portalId: portal, userId: "u-1" });
    const originalTimestamp = Date.now() - 6 * 60 * 1000; // already stale
    const signature = signV3({
      clientSecret: secret,
      method: "POST",
      uri: TEST_URL,
      body,
      timestamp: originalTimestamp,
    });

    const app = buildApp();
    const res = await app.request("/probe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HubSpot-Signature-v3": signature,
        "X-HubSpot-Request-Timestamp": String(originalTimestamp),
      },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("rejects a duplicate signed request within the freshness window with replay_detected", async () => {
    const secret = process.env.HUBSPOT_CLIENT_SECRET ?? "";
    const portal = portalId();
    await db.insert(tenants).values({ hubspotPortalId: portal, name: "ReplayNonce" });
    const body = JSON.stringify({ portalId: portal, userId: "u-1" });
    const timestamp = Date.now();
    const signature = signV3({
      clientSecret: secret,
      method: "POST",
      uri: TEST_URL,
      body,
      timestamp,
    });

    const app = buildApp({ withNonce: true });
    const headers = {
      "Content-Type": "application/json",
      "X-HubSpot-Signature-v3": signature,
      "X-HubSpot-Request-Timestamp": String(timestamp),
    };

    const first = await app.request("/probe", {
      method: "POST",
      headers,
      body,
    });
    expect(first.status).toBe(200);

    const second = await app.request("/probe", {
      method: "POST",
      headers,
      body,
    });
    expect(second.status).toBe(401);
    const json = (await second.json()) as { error: string };
    expect(json.error).toBe("replay_detected");
  });

  it("rejects a malformed timestamp header with 401", async () => {
    const secret = process.env.HUBSPOT_CLIENT_SECRET ?? "";
    const body = JSON.stringify({ portalId: "p-1" });
    const signature = signV3({
      clientSecret: secret,
      method: "POST",
      uri: TEST_URL,
      body,
      timestamp: 0,
    });

    const app = buildApp();
    const res = await app.request("/probe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HubSpot-Signature-v3": signature,
        "X-HubSpot-Request-Timestamp": "not-a-number",
      },
      body,
    });
    expect(res.status).toBe(401);
  });
});

describe("hubspotSignatureMiddleware — test bypass gating", () => {
  it("bypass works when NODE_ENV=test AND ALLOW_TEST_AUTH=true", async () => {
    process.env.NODE_ENV = "test";
    process.env.ALLOW_TEST_AUTH = "true";
    const portal = portalId();
    const [tenant] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portal, name: "Bypass" })
      .returning();

    const app = buildApp();
    const res = await app.request("/probe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-portal-id": portal,
        "x-test-user-id": "u-bypass",
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      portalId: string;
      userId: string;
      tenantId: string;
    };
    expect(json.portalId).toBe(portal);
    expect(json.userId).toBe("u-bypass");
    expect(json.tenantId).toBe(tenant?.id);
  });

  it("bypass is REFUSED when ALLOW_TEST_AUTH is unset, even in NODE_ENV=test", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.ALLOW_TEST_AUTH;
    const portal = portalId();
    await db.insert(tenants).values({ hubspotPortalId: portal, name: "NoBypass" });

    const app = buildApp();
    const res = await app.request("/probe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-portal-id": portal,
      },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("bypass is REFUSED in non-test NODE_ENV even if ALLOW_TEST_AUTH=true", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_TEST_AUTH = "true";
    const portal = portalId();
    await db.insert(tenants).values({ hubspotPortalId: portal, name: "NoBypassProd" });

    const app = buildApp();
    const res = await app.request("/probe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-portal-id": portal,
      },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });
});

describe("hubspotSignatureMiddleware — redaction", () => {
  it("error logs do not contain the client secret, signature, or full body", async () => {
    const secret = process.env.HUBSPOT_CLIENT_SECRET ?? "";
    // Force a signature mismatch to trigger the error path.
    const body = JSON.stringify({
      portalId: "p-x",
      sensitive: "SUPER_SECRET_PAYLOAD_VALUE",
    });
    const badSignature = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const timestamp = Date.now();

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const app = buildApp();
      await app.request("/probe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-HubSpot-Signature-v3": badSignature,
          "X-HubSpot-Request-Timestamp": String(timestamp),
        },
        body,
      });

      const loggedText = [warnSpy, errorSpy]
        .flatMap((spy) => spy.mock.calls.flat())
        .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
        .join(" ");
      expect(loggedText).not.toContain(secret);
      expect(loggedText).not.toContain(badSignature);
      expect(loggedText).not.toContain("SUPER_SECRET_PAYLOAD_VALUE");
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe("hubspotSignatureMiddleware — __resetForTests", () => {
  it("clears the cached secret so HUBSPOT_CLIENT_SECRET can be swapped between tests", async () => {
    // The cache would otherwise pin the first secret seen by the process. We
    // assert reset re-reads env on next request by forcing a mismatch after
    // a successful call.
    const originalSecret = process.env.HUBSPOT_CLIENT_SECRET;
    expect(originalSecret).toBeTruthy();

    const portal = portalId();
    await db.insert(tenants).values({ hubspotPortalId: portal, name: "Reset" });
    const body = JSON.stringify({ portalId: portal, userId: "u" });
    const timestamp = Date.now();

    // First request signs with the REAL secret — should pass.
    const app1 = buildApp();
    const goodSig = signV3({
      clientSecret: originalSecret as string,
      method: "POST",
      uri: TEST_URL,
      body,
      timestamp,
    });
    const res1 = await app1.request("/probe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HubSpot-Signature-v3": goodSig,
        "X-HubSpot-Request-Timestamp": String(timestamp),
      },
      body,
    });
    expect(res1.status).toBe(200);

    // Swap secret, reset cache. A signature under the OLD secret must now fail.
    process.env.HUBSPOT_CLIENT_SECRET = "a-different-secret-for-this-test";
    __resetHubspotSignatureCacheForTests();

    const app2 = buildApp();
    const res2 = await app2.request("/probe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HubSpot-Signature-v3": goodSig,
        "X-HubSpot-Request-Timestamp": String(timestamp),
      },
      body,
    });
    expect(res2.status).toBe(401);

    // Restore.
    if (originalSecret !== undefined) {
      process.env.HUBSPOT_CLIENT_SECRET = originalSecret;
    }
    __resetHubspotSignatureCacheForTests();
  });
});
