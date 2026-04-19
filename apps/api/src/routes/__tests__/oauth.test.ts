/**
 * Slice 3 Task 3b — integration tests for /oauth/install and /oauth/callback.
 *
 * The routes are built as a factory (`createOAuthRoutes(deps)`) so tests
 * inject:
 *   - a fake `fetch` backed by the same cassettes as the oauth-http unit
 *     tests (no network),
 *   - a test-scoped db handle (postgres.js talking to the local Docker
 *     Postgres on port 5433).
 *
 * Coverage:
 *   - /oauth/install → 302 to HubSpot authorize URL with state cookie
 *   - /oauth/callback happy path (new tenant) → upserts tenants +
 *     tenant_hubspot_oauth, redirects to success page
 *   - /oauth/callback happy path (existing tenant) → updates the same
 *     tenants row (no duplicates) + rotates the OAuth row
 *   - /oauth/callback with error=access_denied → 400 friendly HTML
 *   - /oauth/callback with tampered state → 400
 *   - /oauth/callback with expired state → 400
 *   - /oauth/callback when identity endpoint 4xx → 502
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@hap/db";
import { createDatabase, createTestClient } from "@hap/db";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptProviderKey } from "../../lib/encryption.js";
import { signState } from "../../lib/oauth.js";
import { deactivateTenant } from "../../lib/tenant-lifecycle.js";
import { createOAuthRoutes } from "../oauth.js";

const here = dirname(fileURLToPath(import.meta.url));
const cassettesDir = join(here, "..", "..", "lib", "__tests__", "cassettes");

function loadCassette(name: string) {
  return JSON.parse(readFileSync(join(cassettesDir, name), "utf8")) as {
    response: { status: number; body: unknown };
  };
}

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";
const sqlClient = createTestClient(DATABASE_URL);
const db = createDatabase(DATABASE_URL);

const PORTAL_PREFIX = `slice3route-${randomUUID().slice(0, 8)}-`;

const CONFIG = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:3000/oauth/callback",
  scopes: ["oauth", "crm.objects.companies.read", "crm.objects.contacts.read"],
  stateTtlSeconds: 600,
};

const ROOT_KEK_BASE64 = Buffer.alloc(32, 7).toString("base64");
let savedRootKek: string | undefined;

beforeAll(async () => {
  await sqlClient`SELECT 1`;
  savedRootKek = process.env.ROOT_KEK;
  process.env.ROOT_KEK = ROOT_KEK_BASE64;
});

afterAll(async () => {
  if (savedRootKek !== undefined) {
    process.env.ROOT_KEK = savedRootKek;
  } else {
    delete process.env.ROOT_KEK;
  }
  await sqlClient.end({ timeout: 5 });
});

beforeEach(async () => {
  await db.delete(schema.tenants).where(like(schema.tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

function fakeFetchSequence(responses: Array<{ status: number; body: unknown }>): typeof fetch {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[i++];
    if (!r) throw new Error("fakeFetchSequence exhausted");
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

/**
 * Build an identity-cassette response that carries a caller-supplied
 * hub_id so multi-tenant tests can target specific synthetic portals.
 */
function identityResponseForPortal(portalId: string) {
  const identity = loadCassette("oauth-token-identity.json");
  const body = { ...(identity.response.body as Record<string, unknown>) };
  // hub_id is an int in HubSpot but we store it as text. The route must
  // stringify it; here we pre-stringify on the cassette copy by passing
  // a deterministic numeric derived from the portalId so the route's
  // UPSERT lands on a tenant keyed by PORTAL_PREFIX-<hash>.
  // Tests pass portalId as the exact string to store — we overwrite hub_id
  // with a parseable int and rely on the route's conversion contract.
  body.hub_id = Number.parseInt(portalId.replace(/\D/g, "").slice(0, 9) || "146425426", 10);
  return {
    status: identity.response.status,
    body,
    portalIdAsText: String(body.hub_id),
  };
}

describe("GET /oauth/install", () => {
  it("redirects to HubSpot authorize URL carrying state in the query string", async () => {
    const routes = createOAuthRoutes({
      config: CONFIG,
      db,
      fetch: fakeFetchSequence([]),
    });
    const res = await routes.request("/install");
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toMatch(/^https:\/\/app\.hubspot\.com\/oauth\/authorize\?/);
    const parsed = new URL(location);
    expect(parsed.searchParams.get("client_id")).toBe(CONFIG.clientId);
    expect(parsed.searchParams.get("redirect_uri")).toBe(CONFIG.redirectUri);
    expect(parsed.searchParams.get("scope")).toBe(CONFIG.scopes.join(" "));
    expect(parsed.searchParams.get("state")).toBeTruthy();
  });
});

describe("GET /oauth/callback — happy paths", () => {
  it("upserts a new tenant + encrypted OAuth row, then redirects to a success page", async () => {
    const ident = identityResponseForPortal(`${PORTAL_PREFIX}${randomUUID().slice(0, 4)}`);
    const exchange = loadCassette("oauth-token-exchange.json");

    const state = signState({
      secret: CONFIG.clientSecret,
      ttlSeconds: CONFIG.stateTtlSeconds,
    });
    const routes = createOAuthRoutes({
      config: CONFIG,
      db,
      fetch: fakeFetchSequence([
        { status: exchange.response.status, body: exchange.response.body },
        { status: ident.status, body: ident.body },
      ]),
    });

    const res = await routes.request(`/callback?code=auth-code&state=${encodeURIComponent(state)}`);
    expect([200, 302]).toContain(res.status); // success HTML or redirect

    const tenantRows = await db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.hubspotPortalId, ident.portalIdAsText));
    expect(tenantRows).toHaveLength(1);

    const tenantId = tenantRows[0]?.id;
    expect(tenantId).toBeTruthy();
    if (!tenantId) throw new Error("tenantId missing after upsert");

    const oauthRows = await db
      .select()
      .from(schema.tenantHubspotOauth)
      .where(eq(schema.tenantHubspotOauth.tenantId, tenantId));
    expect(oauthRows).toHaveLength(1);
    const row = oauthRows[0];
    if (!row) throw new Error("oauth row missing");

    // The stored ciphertext must decrypt back to the plaintext token from
    // the token-exchange cassette.
    const access = decryptProviderKey(tenantId, row.accessTokenEncrypted);
    const refresh = decryptProviderKey(tenantId, row.refreshTokenEncrypted);
    const exchangeBody = exchange.response.body as {
      access_token: string;
      refresh_token: string;
    };
    expect(access).toBe(exchangeBody.access_token);
    expect(refresh).toBe(exchangeBody.refresh_token);
    expect(row.scopes).toEqual(ident.body.scopes);

    // clean up — leaves cascade purging tenant_hubspot_oauth
    await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
  });

  it("renders setup guidance on the success page when HubSpot does not provide a returnUrl", async () => {
    const ident = identityResponseForPortal(`${PORTAL_PREFIX}${randomUUID().slice(0, 4)}`);
    const exchange = loadCassette("oauth-token-exchange.json");

    const state = signState({
      secret: CONFIG.clientSecret,
      ttlSeconds: CONFIG.stateTtlSeconds,
    });
    const routes = createOAuthRoutes({
      config: CONFIG,
      db,
      fetch: fakeFetchSequence([
        { status: exchange.response.status, body: exchange.response.body },
        { status: ident.status, body: ident.body },
      ]),
    });

    const res = await routes.request(`/callback?code=auth-code&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Install successful");
    expect(body).toContain("open the app settings in HubSpot");

    const tenantRows = await db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.hubspotPortalId, ident.portalIdAsText));
    const tenantId = tenantRows[0]?.id;
    if (tenantId) {
      await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    }
  });

  it("updates the existing tenants row on a second install (no duplicate)", async () => {
    const ident = identityResponseForPortal(`${PORTAL_PREFIX}${randomUUID().slice(0, 4)}`);
    const exchange = loadCassette("oauth-token-exchange.json");
    const refresh = loadCassette("oauth-token-refresh.json");

    const state = signState({
      secret: CONFIG.clientSecret,
      ttlSeconds: CONFIG.stateTtlSeconds,
    });
    const routes = createOAuthRoutes({
      config: CONFIG,
      db,
      fetch: fakeFetchSequence([
        { status: exchange.response.status, body: exchange.response.body },
        { status: ident.status, body: ident.body },
        { status: refresh.response.status, body: refresh.response.body },
        { status: ident.status, body: ident.body },
      ]),
    });

    await routes.request(`/callback?code=code-1&state=${encodeURIComponent(state)}`);

    const state2 = signState({
      secret: CONFIG.clientSecret,
      ttlSeconds: CONFIG.stateTtlSeconds,
    });
    await routes.request(`/callback?code=code-2&state=${encodeURIComponent(state2)}`);

    const tenantRows = await db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.hubspotPortalId, ident.portalIdAsText));
    expect(tenantRows).toHaveLength(1);

    const tenantId = tenantRows[0]?.id;
    if (!tenantId) throw new Error("tenantId missing after second install");

    const oauthRows = await db
      .select()
      .from(schema.tenantHubspotOauth)
      .where(eq(schema.tenantHubspotOauth.tenantId, tenantId));
    expect(oauthRows).toHaveLength(1);

    // Second install used the refresh cassette tokens — the row must now
    // carry THOSE tokens, not the originals.
    const row = oauthRows[0];
    if (!row) throw new Error("oauth row missing after second install");
    const access2 = decryptProviderKey(tenantId, row.accessTokenEncrypted);
    const refreshBody = refresh.response.body as {
      access_token: string;
      refresh_token: string;
    };
    expect(access2).toBe(refreshBody.access_token);

    await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
  });

  it("reactivates an existing deactivated tenant on reinstall", async () => {
    const ident = identityResponseForPortal(`${PORTAL_PREFIX}${randomUUID().slice(0, 4)}`);
    const exchange = loadCassette("oauth-token-exchange.json");
    const refresh = loadCassette("oauth-token-refresh.json");

    const routes = createOAuthRoutes({
      config: CONFIG,
      db,
      fetch: fakeFetchSequence([
        { status: exchange.response.status, body: exchange.response.body },
        { status: ident.status, body: ident.body },
        { status: refresh.response.status, body: refresh.response.body },
        { status: ident.status, body: ident.body },
      ]),
    });

    const state1 = signState({
      secret: CONFIG.clientSecret,
      ttlSeconds: CONFIG.stateTtlSeconds,
    });
    await routes.request(`/callback?code=code-1&state=${encodeURIComponent(state1)}`);

    const [seededTenant] = await db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.hubspotPortalId, ident.portalIdAsText));
    if (!seededTenant) {
      throw new Error("seeded tenant missing after first install");
    }

    await deactivateTenant({
      db,
      tenantId: seededTenant.id,
      reason: "hubspot_app_uninstalled",
      deactivatedAt: new Date("2026-04-17T14:00:00.000Z"),
    });

    const [afterDeactivate] = await db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.id, seededTenant.id));
    expect(afterDeactivate?.isActive).toBe(false);
    expect(afterDeactivate?.deactivatedAt).toBeTruthy();
    expect(afterDeactivate?.deactivationReason).toBe("hubspot_app_uninstalled");

    const state2 = signState({
      secret: CONFIG.clientSecret,
      ttlSeconds: CONFIG.stateTtlSeconds,
    });
    await routes.request(`/callback?code=code-2&state=${encodeURIComponent(state2)}`);

    const [tenantRow] = await db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.hubspotPortalId, ident.portalIdAsText));

    expect(tenantRow?.id).toBe(seededTenant.id);
    expect(tenantRow?.isActive).toBe(true);
    expect(tenantRow?.deactivatedAt).toBeNull();
    expect(tenantRow?.deactivationReason).toBeNull();

    await db.delete(schema.tenants).where(eq(schema.tenants.id, seededTenant.id));
  });
});

describe("GET /oauth/callback — error paths", () => {
  it("returns 400 when HubSpot sent error=access_denied", async () => {
    const routes = createOAuthRoutes({
      config: CONFIG,
      db,
      fetch: fakeFetchSequence([]),
    });
    const res = await routes.request("/callback?error=access_denied&error_description=user+denied");
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body.toLowerCase()).toContain("access_denied");
  });

  it("returns 400 when state is missing or tampered", async () => {
    const routes = createOAuthRoutes({
      config: CONFIG,
      db,
      fetch: fakeFetchSequence([]),
    });
    const res = await routes.request("/callback?code=c&state=tampered.value");
    expect(res.status).toBe(400);
  });

  it("returns 400 when state has expired", async () => {
    const expired = signState({ secret: CONFIG.clientSecret, ttlSeconds: -60 });
    const routes = createOAuthRoutes({
      config: CONFIG,
      db,
      fetch: fakeFetchSequence([]),
    });
    const res = await routes.request(`/callback?code=c&state=${encodeURIComponent(expired)}`);
    expect(res.status).toBe(400);
  });

  it("returns 502 when HubSpot's token-exchange endpoint fails", async () => {
    const state = signState({
      secret: CONFIG.clientSecret,
      ttlSeconds: CONFIG.stateTtlSeconds,
    });
    const routes = createOAuthRoutes({
      config: CONFIG,
      db,
      fetch: fakeFetchSequence([
        {
          status: 400,
          body: { error: "invalid_grant", error_description: "bad code" },
        },
      ]),
    });
    const res = await routes.request(`/callback?code=c&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(502);
  });

  it("returns 502 when HubSpot's identity endpoint fails", async () => {
    const state = signState({
      secret: CONFIG.clientSecret,
      ttlSeconds: CONFIG.stateTtlSeconds,
    });
    const exchange = loadCassette("oauth-token-exchange.json");
    const routes = createOAuthRoutes({
      config: CONFIG,
      db,
      fetch: fakeFetchSequence([
        { status: exchange.response.status, body: exchange.response.body },
        { status: 401, body: { message: "token expired" } },
      ]),
    });
    const res = await routes.request(`/callback?code=c&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(502);
  });
});
