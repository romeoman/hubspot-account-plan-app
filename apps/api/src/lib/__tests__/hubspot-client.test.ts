/**
 * Tests for the server-side HubSpot CRM client.
 *
 * Slice 3 refactor: constructor now takes `{ tenantId, db, fetch? }` instead
 * of reading the old single-portal token from the env. Token resolution queries
 * the `tenant_hubspot_oauth` table via the Drizzle handle, decrypts with
 * AES-256-GCM, and auto-refreshes on expiry/401.
 *
 * All tests stub `fetch` and mock the DB layer; no live HubSpot or Postgres.
 */

import type { Database } from "@hap/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptProviderKey } from "../encryption";
import { HubSpotClient, TenantAccessRevokedError } from "../hubspot-client";
import { OAuthHttpError } from "../oauth";

// ---------------------------------------------------------------------------
// Helpers — fake DB + fetch
// ---------------------------------------------------------------------------

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const TEST_ACCESS_TOKEN = "access-token-abc-123";
const TEST_REFRESH_TOKEN = "refresh-token-xyz-789";
/** Far-future so the token is not expired in normal tests. */
const FAR_FUTURE = new Date(Date.now() + 3_600_000);

/**
 * Build a mock DB handle that returns a single OAuth row for the test tenant.
 * The `findFirst` mock resolves with encrypted tokens.
 */
function makeMockDb(overrides?: {
  expiresAt?: Date;
  accessToken?: string;
  refreshToken?: string;
  missing?: boolean;
  rowSequence?: Array<
    | {
        tenantId: string;
        accessTokenEncrypted: string;
        refreshTokenEncrypted: string;
        expiresAt: Date;
        scopes: string[];
        keyVersion: number;
        createdAt: Date;
        updatedAt: Date;
      }
    | undefined
  >;
}): Database {
  const accessToken = overrides?.accessToken ?? TEST_ACCESS_TOKEN;
  const refreshToken = overrides?.refreshToken ?? TEST_REFRESH_TOKEN;
  const expiresAt = overrides?.expiresAt ?? FAR_FUTURE;

  const row = overrides?.missing
    ? undefined
    : {
        tenantId: TEST_TENANT_ID,
        accessTokenEncrypted: encryptProviderKey(TEST_TENANT_ID, accessToken),
        refreshTokenEncrypted: encryptProviderKey(TEST_TENANT_ID, refreshToken),
        expiresAt,
        scopes: ["crm.objects.companies.read", "crm.objects.contacts.read"],
        keyVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

  const rowSequence = overrides?.rowSequence;
  const findFirstMock = rowSequence
    ? vi.fn().mockImplementation(async () => rowSequence.shift())
    : vi.fn().mockResolvedValue(row);
  const updateWhereMock = vi.fn().mockImplementation(() => {
    const result = Promise.resolve(undefined) as Promise<void> & {
      returning: ReturnType<typeof vi.fn>;
    };
    result.returning = vi.fn().mockResolvedValue([{ id: TEST_TENANT_ID }]);
    return result;
  });
  const updateSetMock = vi.fn().mockReturnValue({
    where: updateWhereMock,
  });
  const updateMock = vi.fn().mockReturnValue({
    set: updateSetMock,
  });
  const deleteWhereMock = vi.fn().mockResolvedValue(undefined);
  const deleteMock = vi.fn().mockReturnValue({
    where: deleteWhereMock,
  });

  // Drizzle query pattern: db.query.tenantHubspotOauth.findFirst({ where: ... })
  // We mock the minimal chain needed.
  const mockDb = {
    query: {
      tenantHubspotOauth: {
        findFirst: findFirstMock,
      },
    },
    // For UPDATE (token refresh persist)
    update: updateMock,
    delete: deleteMock,
    transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(mockDb)),
  } as unknown as Database;

  return mockDb;
}

/**
 * Build a fake fetch that resolves with a canned response.
 */
function makeFakeFetch(responseBody: unknown, status = 200): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(responseBody), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

/**
 * Build a fake fetch that returns different responses per call.
 */
function makeFakeFetchSequence(
  ...responses: Array<{ body: unknown; status: number }>
): typeof globalThis.fetch {
  const fn = vi.fn();
  for (const [, r] of responses.entries()) {
    fn.mockResolvedValueOnce(
      new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { "content-type": "application/json" },
      }),
    );
  }
  return fn as typeof globalThis.fetch;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HubSpotClient (Slice 3 — per-tenant OAuth)", () => {
  // ---- Constructor ----

  it("constructor accepts { tenantId, db, fetch } and does NOT read the legacy static token env", () => {
    const db = makeMockDb();
    const fakeFetch = makeFakeFetch({});
    const legacyTokenEnv = "HUBSPOT" + "_DEV_PORTAL_TOKEN";
    // Should NOT throw even if the old env path is unset.
    const saved = process.env[legacyTokenEnv];
    delete process.env[legacyTokenEnv];
    try {
      const client = new HubSpotClient({
        tenantId: TEST_TENANT_ID,
        db,
        fetch: fakeFetch,
      });
      expect(client).toBeDefined();
    } finally {
      if (saved !== undefined) process.env[legacyTokenEnv] = saved;
    }
  });

  // ---- Token resolution from DB ----

  it("getCompanyProperties resolves token from DB and sends Bearer header", async () => {
    const db = makeMockDb();
    const fakeFetch = makeFakeFetch({
      id: "123",
      properties: { name: "Acme", domain: "acme.test" },
    });

    const client = new HubSpotClient({
      tenantId: TEST_TENANT_ID,
      db,
      fetch: fakeFetch,
    });

    const props = await client.getCompanyProperties("123", ["name", "domain"]);

    expect(props).toEqual({ name: "Acme", domain: "acme.test" });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toMatch(/\/crm\/v3\/objects\/companies\/123/);
    expect(url).toContain("properties=name");
    expect(url).toContain("properties=domain");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TEST_ACCESS_TOKEN}`);
  });

  it("throws when tenant has no OAuth row in the DB", async () => {
    const db = makeMockDb({ missing: true });
    const fakeFetch = makeFakeFetch({});

    const client = new HubSpotClient({
      tenantId: TEST_TENANT_ID,
      db,
      fetch: fakeFetch,
    });

    await expect(client.getCompanyProperties("123", ["name"])).rejects.toBeInstanceOf(
      TenantAccessRevokedError,
    );
  });

  // ---- Token caching ----

  it("caches decrypted token across multiple calls (DB queried only once while not expired)", async () => {
    const db = makeMockDb();
    const fakeFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "1", properties: { name: "A" } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "2", properties: { name: "B" } }), {
          status: 200,
        }),
      );

    const client = new HubSpotClient({
      tenantId: TEST_TENANT_ID,
      db,
      fetch: fakeFetch as typeof globalThis.fetch,
    });

    await client.getCompanyProperties("1", ["name"]);
    await client.getCompanyProperties("2", ["name"]);

    // DB findFirst called only once — second call used cache
    // biome-ignore lint/suspicious/noExplicitAny: mock DB query chain needs untyped access
    const queryMock = db.query as any;
    expect(queryMock.tenantHubspotOauth.findFirst).toHaveBeenCalledTimes(1);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  // ---- Pre-expiry refresh ----

  it("proactively refreshes when token is within 60s of expiry", async () => {
    // Token expires in 30 seconds — within the 60s pre-expiry window
    const almostExpired = new Date(Date.now() + 30_000);
    const db = makeMockDb({ expiresAt: almostExpired });

    // First call: the HubSpot API call after refresh
    // The refresh is done via oauth.refreshAccessToken which uses its own fetch
    // We need to mock the oauth module
    const newAccessToken = "refreshed-access-token";
    const newRefreshToken = "refreshed-refresh-token";

    // Mock the oauth.refreshAccessToken
    vi.spyOn(await import("../oauth"), "refreshAccessToken").mockResolvedValue({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: 21600,
      tokenType: "bearer",
    });

    const fakeFetch = makeFakeFetch({
      id: "123",
      properties: { name: "Acme" },
    });

    const client = new HubSpotClient({
      tenantId: TEST_TENANT_ID,
      db,
      fetch: fakeFetch,
    });

    const props = await client.getCompanyProperties("123", ["name"]);
    expect(props).toEqual({ name: "Acme" });

    // The Bearer header should use the refreshed token
    const [, init] = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${newAccessToken}`);

    // DB update should have been called to persist rotated tokens
    expect(db.update).toHaveBeenCalled();
  });

  it("soft-deactivates the tenant when refresh fails with an unrecoverable OAuth error", async () => {
    const almostExpired = new Date(Date.now() + 30_000);
    const db = makeMockDb({ expiresAt: almostExpired });

    vi.spyOn(await import("../oauth"), "refreshAccessToken").mockRejectedValue(
      new OAuthHttpError("hubspot token endpoint returned 400", 400, {
        error: "invalid_grant",
        error_description: "refresh token is invalid, expired or revoked",
      }),
    );

    const client = new HubSpotClient({
      tenantId: TEST_TENANT_ID,
      db,
      fetch: makeFakeFetch({}),
    });

    await expect(client.getCompanyProperties("123", ["name"])).rejects.toBeInstanceOf(
      TenantAccessRevokedError,
    );

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalled();
    expect(db.update).toHaveBeenCalled();
  });

  it("does not deactivate the tenant when invalid_grant is caused by a stale refresh-token race", async () => {
    const almostExpired = new Date(Date.now() + 30_000);
    const db = makeMockDb({
      expiresAt: almostExpired,
      rowSequence: [
        {
          tenantId: TEST_TENANT_ID,
          accessTokenEncrypted: encryptProviderKey(TEST_TENANT_ID, TEST_ACCESS_TOKEN),
          refreshTokenEncrypted: encryptProviderKey(TEST_TENANT_ID, TEST_REFRESH_TOKEN),
          expiresAt: almostExpired,
          scopes: ["crm.objects.companies.read", "crm.objects.contacts.read"],
          keyVersion: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          tenantId: TEST_TENANT_ID,
          accessTokenEncrypted: encryptProviderKey(TEST_TENANT_ID, "rotated-access-token"),
          refreshTokenEncrypted: encryptProviderKey(TEST_TENANT_ID, "rotated-refresh-token"),
          expiresAt: FAR_FUTURE,
          scopes: ["crm.objects.companies.read", "crm.objects.contacts.read"],
          keyVersion: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    vi.spyOn(await import("../oauth"), "refreshAccessToken").mockRejectedValue(
      new OAuthHttpError("hubspot token endpoint returned 400", 400, {
        error: "invalid_grant",
        error_description: "refresh token is invalid, expired or revoked",
      }),
    );

    const client = new HubSpotClient({
      tenantId: TEST_TENANT_ID,
      db,
      fetch: makeFakeFetch({}),
    });

    await expect(client.getCompanyProperties("123", ["name"])).rejects.toBeInstanceOf(
      OAuthHttpError,
    );

    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  // ---- 401 auto-retry ----

  it("retries once on 401 after refreshing the token", async () => {
    const db = makeMockDb();

    vi.spyOn(await import("../oauth"), "refreshAccessToken").mockResolvedValue({
      accessToken: "retry-token",
      refreshToken: "new-refresh",
      expiresIn: 21600,
      tokenType: "bearer",
    });

    // First call → 401, second call (retry) → 200
    const fakeFetch = makeFakeFetchSequence(
      { body: { message: "Unauthorized" }, status: 401 },
      {
        body: { id: "123", properties: { name: "Acme" } },
        status: 200,
      },
    );

    const client = new HubSpotClient({
      tenantId: TEST_TENANT_ID,
      db,
      fetch: fakeFetch,
    });

    const props = await client.getCompanyProperties("123", ["name"]);
    expect(props).toEqual({ name: "Acme" });
    expect(fakeFetch).toHaveBeenCalledTimes(2);

    // Second call should use the refreshed token
    const [, init] = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls[1] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer retry-token");
  });

  it("does NOT infinite-loop — throws after retry also returns 401", async () => {
    const db = makeMockDb();

    vi.spyOn(await import("../oauth"), "refreshAccessToken").mockResolvedValue({
      accessToken: "still-bad-token",
      refreshToken: "new-refresh",
      expiresIn: 21600,
      tokenType: "bearer",
    });

    // Both calls → 401
    const fakeFetch = makeFakeFetchSequence(
      { body: { message: "Unauthorized" }, status: 401 },
      { body: { message: "Unauthorized" }, status: 401 },
    );

    const client = new HubSpotClient({
      tenantId: TEST_TENANT_ID,
      db,
      fetch: fakeFetch,
    });

    await expect(client.getCompanyProperties("123", ["name"])).rejects.toThrow(/hubspot: 401/);
    // Exactly 2 fetch calls (original + one retry)
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("getCompanyEngagements reads associated note and task activities for a company", async () => {
    const db = makeMockDb();
    const fakeFetch = makeFakeFetchSequence(
      {
        status: 200,
        body: {
          results: [
            {
              from: { id: "123" },
              to: [{ toObjectId: "note-1" }],
            },
          ],
        },
      },
      {
        status: 200,
        body: {
          results: [
            {
              id: "note-1",
              properties: {
                hs_note_body: "Champion mentioned implementation timing.",
                hs_timestamp: "2026-04-10T10:00:00.000Z",
              },
            },
          ],
        },
      },
      {
        status: 200,
        body: {
          results: [
            {
              from: { id: "123" },
              to: [{ toObjectId: "task-1" }],
            },
          ],
        },
      },
      {
        status: 200,
        body: {
          results: [
            {
              id: "task-1",
              properties: {
                hs_task_subject: "Follow up next week",
                hs_task_body: "Send pricing recap",
                hs_timestamp: "2026-04-11T12:30:00.000Z",
              },
            },
          ],
        },
      },
      {
        status: 200,
        body: {
          results: [],
        },
      },
      {
        status: 200,
        body: {
          results: [],
        },
      },
      {
        status: 200,
        body: {
          results: [],
        },
      },
    );

    const client = new HubSpotClient({
      tenantId: TEST_TENANT_ID,
      db,
      fetch: fakeFetch,
    });

    const engagements = await client.getCompanyEngagements("123");

    expect(engagements).toEqual([
      {
        id: "note-1",
        type: "note",
        timestamp: new Date("2026-04-10T10:00:00.000Z"),
        content: "Champion mentioned implementation timing.",
      },
      {
        id: "task-1",
        type: "task",
        timestamp: new Date("2026-04-11T12:30:00.000Z"),
        content: "Follow up next week\n\nSend pricing recap",
      },
    ]);
  });

  it("getCompanyEngagements parses HubSpot epoch-millisecond timestamps", async () => {
    const db = makeMockDb();
    const fakeFetch = makeFakeFetchSequence(
      {
        status: 200,
        body: {
          results: [
            {
              from: { id: "123" },
              to: [{ toObjectId: "note-epoch" }],
            },
          ],
        },
      },
      {
        status: 200,
        body: {
          results: [
            {
              id: "note-epoch",
              properties: {
                hs_note_body: "Budget approved for rollout.",
                hs_timestamp: "1710000000000",
              },
            },
          ],
        },
      },
      { status: 200, body: { results: [] } },
      { status: 200, body: { results: [] } },
      { status: 200, body: { results: [] } },
      { status: 200, body: { results: [] } },
      { status: 200, body: { results: [] } },
    );

    const client = new HubSpotClient({
      tenantId: TEST_TENANT_ID,
      db,
      fetch: fakeFetch,
    });

    const engagements = await client.getCompanyEngagements("123");

    expect(engagements).toEqual([
      {
        id: "note-epoch",
        type: "note",
        timestamp: new Date(1_710_000_000_000),
        content: "Budget approved for rollout.",
      },
    ]);
  });

  // ---- Error message does not leak token ----

  it("error messages do not leak the access token", async () => {
    const db = makeMockDb();
    const fakeFetch = makeFakeFetch({ message: "forbidden" }, 403);

    const client = new HubSpotClient({
      tenantId: TEST_TENANT_ID,
      db,
      fetch: fakeFetch,
    });

    try {
      await client.getCompanyProperties("123", ["name"]);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error).message).toMatch(/hubspot: 403/i);
      expect((err as Error).message).not.toContain(TEST_ACCESS_TOKEN);
    }
  });

  // ---- Existing method-level tests (updated constructor shape) ----

  it("createCompany POSTs to /crm/v3/objects/companies with properties body", async () => {
    const db = makeMockDb();
    const fakeFetch = makeFakeFetch(
      {
        id: "co-101",
        properties: {
          name: "Slice2-EligibleStrong-AcmeCorp",
          hs_is_target_account: "true",
        },
      },
      201,
    );

    const client = new HubSpotClient({
      tenantId: TEST_TENANT_ID,
      db,
      fetch: fakeFetch,
    });

    const result = await client.createCompany({
      name: "Slice2-EligibleStrong-AcmeCorp",
      domain: "acme.test",
      hs_is_target_account: true,
    });

    expect(result.id).toBe("co-101");
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.hubapi.com/crm/v3/objects/companies");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TEST_ACCESS_TOKEN}`);
    expect(headers.get("content-type")).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      properties: {
        name: "Slice2-EligibleStrong-AcmeCorp",
        domain: "acme.test",
        hs_is_target_account: "true",
      },
    });
  });

  it("createCompany throws on non-2xx without leaking token", async () => {
    const db = makeMockDb();
    const fakeFetch = makeFakeFetch({ message: "boom" }, 500);

    const client = new HubSpotClient({
      tenantId: TEST_TENANT_ID,
      db,
      fetch: fakeFetch,
    });

    try {
      await client.createCompany({ name: "x" });
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error).message).toMatch(/hubspot: 500/);
      expect((err as Error).message).not.toContain(TEST_ACCESS_TOKEN);
    }
  });

  it("createContact POSTs to /crm/v3/objects/contacts", async () => {
    const db = makeMockDb();
    const fakeFetch = makeFakeFetch({ id: "ct-7", properties: { email: "a@b.test" } }, 201);

    const client = new HubSpotClient({
      tenantId: TEST_TENANT_ID,
      db,
      fetch: fakeFetch,
    });

    const result = await client.createContact({
      firstname: "Alex",
      lastname: "Champion",
      email: "alex@acme.test",
      jobtitle: "VP Engineering",
    });

    expect(result.id).toBe("ct-7");
    const [url, init] = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.hubapi.com/crm/v3/objects/contacts");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.properties.firstname).toBe("Alex");
    expect(body.properties.email).toBe("alex@acme.test");
  });

  it("updateCompany PATCHes to /crm/v3/objects/companies/{id}", async () => {
    const db = makeMockDb();
    const fakeFetch = makeFakeFetch({ id: "co-55", properties: { name: "Updated" } }, 200);

    const client = new HubSpotClient({
      tenantId: TEST_TENANT_ID,
      db,
      fetch: fakeFetch,
    });

    await client.updateCompany("co-55", {
      name: "Updated",
      hs_is_target_account: false,
    });

    const [url, init] = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.hubapi.com/crm/v3/objects/companies/co-55");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string);
    expect(body.properties.hs_is_target_account).toBe("false");
  });

  it("associateContactWithCompany PUTs to the default-association endpoint", async () => {
    const db = makeMockDb();
    const fakeFetch = vi.fn().mockResolvedValue(new Response("", { status: 200 }));

    const client = new HubSpotClient({
      tenantId: TEST_TENANT_ID,
      db,
      fetch: fakeFetch as typeof globalThis.fetch,
    });

    await client.associateContactWithCompany("co-1", "ct-9");

    const [url, init] = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.hubapi.com/crm/v4/objects/companies/co-1/associations/default/contacts/ct-9",
    );
    expect(init.method).toBe("PUT");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TEST_ACCESS_TOKEN}`);
  });

  it("associateContactWithCompany throws on non-2xx without leaking token", async () => {
    const db = makeMockDb();
    const fakeFetch = makeFakeFetch({ message: "nope" }, 404);

    const client = new HubSpotClient({
      tenantId: TEST_TENANT_ID,
      db,
      fetch: fakeFetch,
    });

    try {
      await client.associateContactWithCompany("co-1", "ct-9");
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error).message).toMatch(/hubspot: 404/);
      expect((err as Error).message).not.toContain(TEST_ACCESS_TOKEN);
    }
  });

  it("searchCompaniesByMarker POSTs filterGroups and returns results array", async () => {
    const db = makeMockDb();
    const fakeFetch = makeFakeFetch({
      results: [
        {
          id: "co-A",
          properties: { name: "Slice2-EligibleStrong-AcmeCorp" },
        },
        { id: "co-B", properties: { name: "Slice2-Empty-GammaCo" } },
      ],
    });

    const client = new HubSpotClient({
      tenantId: TEST_TENANT_ID,
      db,
      fetch: fakeFetch,
    });

    const rows = await client.searchCompaniesByMarker("hap_seed_marker", "slice2-walkthrough-v1");

    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBe("co-A");
    const [url, init] = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.hubapi.com/crm/v3/objects/companies/search");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.filterGroups[0].filters[0]).toEqual({
      propertyName: "hap_seed_marker",
      operator: "EQ",
      value: "slice2-walkthrough-v1",
    });
  });

  it("searchCompaniesByMarker returns empty array when no results", async () => {
    const db = makeMockDb();
    const fakeFetch = makeFakeFetch({});

    const client = new HubSpotClient({
      tenantId: TEST_TENANT_ID,
      db,
      fetch: fakeFetch,
    });

    const rows = await client.searchCompaniesByMarker("hap_seed_marker", "unknown");
    expect(rows).toEqual([]);
  });

  it("findContactByEmail returns the first match", async () => {
    const db = makeMockDb();
    const fakeFetch = makeFakeFetch({
      results: [
        {
          id: "ct-1",
          properties: { email: "a@b.example.com", firstname: "A" },
        },
      ],
    });

    const client = new HubSpotClient({
      tenantId: TEST_TENANT_ID,
      db,
      fetch: fakeFetch,
    });

    const contact = await client.findContactByEmail("a@b.example.com");
    expect(contact?.id).toBe("ct-1");
  });

  it("findContactByEmail returns null when no match", async () => {
    const db = makeMockDb();
    const fakeFetch = makeFakeFetch({ results: [] });

    const client = new HubSpotClient({
      tenantId: TEST_TENANT_ID,
      db,
      fetch: fakeFetch,
    });

    const contact = await client.findContactByEmail("ghost@nowhere.example.com");
    expect(contact).toBeNull();
  });
});
