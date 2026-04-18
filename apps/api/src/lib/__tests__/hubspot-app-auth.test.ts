/**
 * Slice 11 Task 2 — HubSpot app-level auth client (client-credentials flow).
 *
 * Covers `../hubspot-app-auth.ts`:
 *   - Required env validation (HUBSPOT_APP_CLIENT_ID, HUBSPOT_APP_CLIENT_SECRET,
 *     HUBSPOT_APP_ID) — missing any one throws a clear error that NEVER
 *     includes the suspected secret value.
 *   - Successful token fetch — form-urlencoded body with grant_type,
 *     client_id, client_secret, and space-separated scopes; Content-Type
 *     header set.
 *   - Error path — non-2xx token-endpoint response throws with a clean
 *     message that strips any response body content (secrets-paranoid).
 *   - Cache — second call inside TTL does NOT re-fetch; second call AFTER
 *     `expires_in - 60s` elapsed does re-fetch.
 *
 * Zero network access — every test injects a fake `fetch`. Time is
 * controlled via an injected `nowMs`. Env is injected per-test so module
 * state never leaks across cases.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetAppAuthCache,
  AppAuthError,
  getAppAccessToken,
  HUBSPOT_APP_AUTH_SCOPES,
  HUBSPOT_APP_TOKEN_URL,
} from "../hubspot-app-auth";

const BASE_ENV: NodeJS.ProcessEnv = {
  HUBSPOT_APP_ID: "1234567",
  HUBSPOT_APP_CLIENT_ID: "client-id-xxx",
  HUBSPOT_APP_CLIENT_SECRET: "client-secret-yyy",
};

function successResponse(body: {
  access_token: string;
  expires_in: number;
  token_type?: string;
}): Response {
  return new Response(JSON.stringify({ token_type: "bearer", ...body }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  __resetAppAuthCache();
});

describe("getAppAccessToken — env validation", () => {
  it("throws when HUBSPOT_APP_CLIENT_ID is missing", async () => {
    const env = { ...BASE_ENV };
    delete env.HUBSPOT_APP_CLIENT_ID;
    const fetchImpl = vi.fn();
    await expect(
      getAppAccessToken({
        env,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HUBSPOT_APP_CLIENT_ID/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws when HUBSPOT_APP_CLIENT_SECRET is missing", async () => {
    const env = { ...BASE_ENV };
    delete env.HUBSPOT_APP_CLIENT_SECRET;
    const fetchImpl = vi.fn();
    await expect(
      getAppAccessToken({
        env,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HUBSPOT_APP_CLIENT_SECRET/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws when HUBSPOT_APP_ID is missing", async () => {
    const env = { ...BASE_ENV };
    delete env.HUBSPOT_APP_ID;
    const fetchImpl = vi.fn();
    await expect(
      getAppAccessToken({
        env,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HUBSPOT_APP_ID/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("missing-env error message never includes the suspected secret value", async () => {
    const env = { ...BASE_ENV };
    delete env.HUBSPOT_APP_CLIENT_SECRET;
    const fetchImpl = vi.fn();
    await expect(
      getAppAccessToken({
        env,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("client-secret-yyy"),
      }) as unknown as Error,
    );
  });
});

describe("getAppAccessToken — successful fetch", () => {
  it("POSTs x-www-form-urlencoded with grant_type, client_id, client_secret, scopes", async () => {
    const fetchImpl = vi.fn(async () =>
      successResponse({ access_token: "TOKEN-1", expires_in: 1800 }),
    );
    const token = await getAppAccessToken({
      env: BASE_ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowMs: () => 1_000_000,
    });
    expect(token).toBe("TOKEN-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe(HUBSPOT_APP_TOKEN_URL);
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toMatch(/application\/x-www-form-urlencoded/);

    const body = init.body as string;
    const params = new URLSearchParams(body);
    expect(params.get("grant_type")).toBe("client_credentials");
    expect(params.get("client_id")).toBe("client-id-xxx");
    expect(params.get("client_secret")).toBe("client-secret-yyy");
    expect(params.get("scope")).toBe(HUBSPOT_APP_AUTH_SCOPES);
    expect(HUBSPOT_APP_AUTH_SCOPES).toBe(
      "developer.webhooks_journal.subscriptions.read developer.webhooks_journal.subscriptions.write",
    );
  });
});

describe("getAppAccessToken — error path", () => {
  it("throws AppAuthError on non-2xx and does NOT include the response body in the message", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            message: "bad credentials — secret was client-secret-yyy",
            correlationId: "abc-123",
          }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
    );
    const err = await getAppAccessToken({
      env: BASE_ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: unknown) => e as Error);

    expect(err).toBeInstanceOf(AppAuthError);
    expect((err as Error).message).not.toContain("client-secret-yyy");
    expect((err as Error).message).toMatch(/401/);
  });

  it("throws AppAuthError when fetch itself rejects (network error) without leaking secret", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET while posting client_secret=client-secret-yyy");
    });
    const err = await getAppAccessToken({
      env: BASE_ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: unknown) => e as Error);

    expect(err).toBeInstanceOf(AppAuthError);
    expect((err as Error).message).not.toContain("client-secret-yyy");
  });
});

describe("getAppAccessToken — cache behavior", () => {
  it("returns cached token on second call within effective TTL (fetch called once)", async () => {
    const fetchImpl = vi.fn(async () =>
      successResponse({ access_token: "TOKEN-A", expires_in: 1800 }),
    );
    const t0 = 1_000_000;
    const first = await getAppAccessToken({
      env: BASE_ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowMs: () => t0,
    });
    // 1000s later — well inside (1800 - 60)s effective window.
    const second = await getAppAccessToken({
      env: BASE_ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowMs: () => t0 + 1_000_000,
    });
    expect(first).toBe("TOKEN-A");
    expect(second).toBe("TOKEN-A");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after (expires_in - 60)s effective expiry elapses", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return successResponse({
        access_token: call === 1 ? "TOKEN-1" : "TOKEN-2",
        expires_in: 1800,
      });
    });
    const t0 = 1_000_000;
    const first = await getAppAccessToken({
      env: BASE_ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowMs: () => t0,
    });
    // Jump to just past the effective expiry: (1800 - 60) * 1000 ms = 1_740_000 ms.
    const second = await getAppAccessToken({
      env: BASE_ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowMs: () => t0 + 1_740_001,
    });
    expect(first).toBe("TOKEN-1");
    expect(second).toBe("TOKEN-2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("trusts expires_in from the response (short TTL expires sooner)", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return successResponse({
        access_token: call === 1 ? "SHORT-1" : "SHORT-2",
        expires_in: 120, // 2 minutes — effective window is 60s.
      });
    });
    const t0 = 5_000_000;
    await getAppAccessToken({
      env: BASE_ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowMs: () => t0,
    });
    // 61s later — past the (120 - 60)s effective window.
    const second = await getAppAccessToken({
      env: BASE_ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowMs: () => t0 + 61_000,
    });
    expect(second).toBe("SHORT-2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
