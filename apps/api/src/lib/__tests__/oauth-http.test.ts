/**
 * Slice 3 Task 3 — OAuth HTTP helpers (cassette-based).
 *
 * Covers the network-touching helpers in `../oauth.ts`:
 *   - exchangeCodeForTokens — POST /oauth/2026-03/token, authorization_code grant
 *   - refreshAccessToken    — POST /oauth/2026-03/token, refresh_token grant
 *   - fetchTokenIdentity    — GET  /oauth/v1/access-tokens/{token}
 *
 * Cassettes stored at ./cassettes/oauth-*.json — recorded against
 * HubSpot's docs shapes (verified via Context7 in slice-3-preflight-notes.md).
 * Every test injects a fake `fetch` — no network access, no credentials
 * required in CI. Cassettes are SCRUBBED of real tokens.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  exchangeCodeForTokens,
  fetchTokenIdentity,
  OAuthHttpError,
  refreshAccessToken,
} from "../oauth";

const here = dirname(fileURLToPath(import.meta.url));

type TokenCassette = {
  request: { url: string; method: "POST" };
  response: {
    status: number;
    body: {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
    };
  };
};

type IdentityCassette = {
  request: { url: string; method: "GET" };
  response: {
    status: number;
    body: {
      token: string;
      user: string;
      hub_domain: string;
      scopes: string[];
      hub_id: number;
      app_id: number;
      expires_in: number;
      user_id: number;
      token_type: "access";
    };
  };
};

function loadCassette<T>(name: string): T {
  return JSON.parse(readFileSync(join(here, "cassettes", name), "utf8")) as T;
}

function fakeFetchFor(
  status: number,
  body: unknown,
  onCall?: (url: string, init: RequestInit | undefined) => void,
): typeof fetch {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    onCall?.(url.toString(), init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// exchangeCodeForTokens
// ---------------------------------------------------------------------------

describe("exchangeCodeForTokens", () => {
  it("parses access_token, refresh_token, expires_in from a successful response", async () => {
    const cassette = loadCassette<TokenCassette>("oauth-token-exchange.json");
    const result = await exchangeCodeForTokens({
      clientId: "client-id-abc",
      clientSecret: "client-secret-xyz",
      code: "auth-code-123",
      redirectUri: "http://localhost:3000/oauth/callback",
      fetch: fakeFetchFor(cassette.response.status, cassette.response.body),
    });

    expect(result.accessToken).toBe(cassette.response.body.access_token);
    expect(result.refreshToken).toBe(cassette.response.body.refresh_token);
    expect(result.expiresIn).toBe(cassette.response.body.expires_in);
    expect(result.tokenType).toBe("bearer");
  });

  it("posts to the 2026-03 token endpoint as form-encoded body", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    let capturedContentType = "";
    const cassette = loadCassette<TokenCassette>("oauth-token-exchange.json");
    const fetchSpy = fakeFetchFor(cassette.response.status, cassette.response.body, (url, init) => {
      capturedUrl = url;
      capturedBody = String(init?.body ?? "");
      const headers = new Headers(init?.headers);
      capturedContentType = headers.get("content-type") ?? "";
    });

    await exchangeCodeForTokens({
      clientId: "client-id-abc",
      clientSecret: "client-secret-xyz",
      code: "auth-code-123",
      redirectUri: "http://localhost:3000/oauth/callback",
      fetch: fetchSpy,
    });

    expect(capturedUrl).toBe("https://api.hubapi.com/oauth/2026-03/token");
    expect(capturedContentType).toMatch(/application\/x-www-form-urlencoded/);
    const params = new URLSearchParams(capturedBody);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("client_id")).toBe("client-id-abc");
    expect(params.get("client_secret")).toBe("client-secret-xyz");
    expect(params.get("code")).toBe("auth-code-123");
    expect(params.get("redirect_uri")).toBe("http://localhost:3000/oauth/callback");
  });

  it("throws OAuthHttpError on 4xx responses with server error details", async () => {
    await expect(
      exchangeCodeForTokens({
        clientId: "id",
        clientSecret: "secret",
        code: "bad",
        redirectUri: "http://localhost:3000/oauth/callback",
        fetch: fakeFetchFor(400, {
          message: "invalid code",
          status: "BAD_AUTH_CODE",
        }),
      }),
    ).rejects.toThrow(OAuthHttpError);
  });
});

// ---------------------------------------------------------------------------
// refreshAccessToken
// ---------------------------------------------------------------------------

describe("refreshAccessToken", () => {
  it("sends grant_type=refresh_token and parses the rotated tokens", async () => {
    let capturedBody = "";
    const cassette = loadCassette<TokenCassette>("oauth-token-refresh.json");
    const fetchSpy = fakeFetchFor(
      cassette.response.status,
      cassette.response.body,
      (_url, init) => {
        capturedBody = String(init?.body ?? "");
      },
    );

    const result = await refreshAccessToken({
      clientId: "client-id-abc",
      clientSecret: "client-secret-xyz",
      refreshToken: "refresh-token-old",
      fetch: fetchSpy,
    });

    expect(result.accessToken).toBe(cassette.response.body.access_token);
    expect(result.refreshToken).toBe(cassette.response.body.refresh_token);
    expect(result.expiresIn).toBe(cassette.response.body.expires_in);

    const params = new URLSearchParams(capturedBody);
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("refresh_token")).toBe("refresh-token-old");
    expect(params.get("client_id")).toBe("client-id-abc");
    expect(params.get("client_secret")).toBe("client-secret-xyz");
  });

  it("throws OAuthHttpError on 400 invalid_grant (expired/revoked refresh token)", async () => {
    await expect(
      refreshAccessToken({
        clientId: "id",
        clientSecret: "secret",
        refreshToken: "expired",
        fetch: fakeFetchFor(400, {
          error: "invalid_grant",
          error_description: "refresh token is invalid, expired or revoked",
        }),
      }),
    ).rejects.toThrow(OAuthHttpError);
  });
});

// ---------------------------------------------------------------------------
// fetchTokenIdentity
// ---------------------------------------------------------------------------

describe("fetchTokenIdentity", () => {
  it("returns hub_id, user, scopes, expires_in from the identity endpoint", async () => {
    const cassette = loadCassette<IdentityCassette>("oauth-token-identity.json");
    const result = await fetchTokenIdentity({
      accessToken: cassette.response.body.token,
      fetch: fakeFetchFor(cassette.response.status, cassette.response.body),
    });

    expect(result.hubId).toBe(cassette.response.body.hub_id);
    expect(result.user).toBe(cassette.response.body.user);
    expect(result.hubDomain).toBe(cassette.response.body.hub_domain);
    expect(result.scopes).toEqual(cassette.response.body.scopes);
    expect(result.expiresIn).toBe(cassette.response.body.expires_in);
    expect(result.userId).toBe(cassette.response.body.user_id);
    expect(result.appId).toBe(cassette.response.body.app_id);
  });

  it("GETs /oauth/v1/access-tokens/<token> (token in path, no Authorization header required)", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    const cassette = loadCassette<IdentityCassette>("oauth-token-identity.json");
    const fetchSpy = fakeFetchFor(cassette.response.status, cassette.response.body, (url, init) => {
      capturedUrl = url;
      capturedMethod = init?.method ?? "GET";
    });

    await fetchTokenIdentity({
      accessToken: "ACCESS_TOKEN_VALUE",
      fetch: fetchSpy,
    });

    expect(capturedUrl).toBe("https://api.hubapi.com/oauth/v1/access-tokens/ACCESS_TOKEN_VALUE");
    expect(capturedMethod).toBe("GET");
  });

  it("URL-encodes access-token path segments with reserved chars", async () => {
    let capturedUrl = "";
    const cassette = loadCassette<IdentityCassette>("oauth-token-identity.json");
    const fetchSpy = fakeFetchFor(cassette.response.status, cassette.response.body, (url) => {
      capturedUrl = url;
    });

    await fetchTokenIdentity({
      accessToken: "abc/def+ghi=jkl",
      fetch: fetchSpy,
    });

    // encodeURIComponent turns / → %2F, + → %2B, = → %3D
    expect(capturedUrl).toBe("https://api.hubapi.com/oauth/v1/access-tokens/abc%2Fdef%2Bghi%3Djkl");
  });

  it("throws OAuthHttpError on 401 (expired/invalid access token)", async () => {
    await expect(
      fetchTokenIdentity({
        accessToken: "expired-token",
        fetch: fakeFetchFor(401, { message: "expired" }),
      }),
    ).rejects.toThrow(OAuthHttpError);
  });
});
