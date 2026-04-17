/**
 * Slice 3 Task 3 — HubSpot OAuth helpers.
 *
 * This module contains:
 *   * Stateless CSRF-guard helpers — `signState`, `verifyState`.
 *   * Authorize-URL builder — `buildAuthorizeUrl`.
 *   * Network-touching helpers — `exchangeCodeForTokens`, `refreshAccessToken`,
 *     `fetchTokenIdentity`. These land alongside cassette tests in a follow-up
 *     commit inside Task 3 and are exported from the same module for route
 *     consumers.
 *
 * Design notes + threat model:
 *   * State = timing-safe HMAC-SHA256 over a short-lived payload (random
 *     nonce + absolute `expiresAt` ms). Keyed with `HUBSPOT_CLIENT_SECRET`
 *     so only this backend can produce valid state values.
 *   * Stateless by design — survives restart, no DB row per install click.
 *     This detects tampering + expiry; it does NOT detect single-use replay
 *     of an intercepted-but-unexpired state. That gap is called out in
 *     SECURITY.md §16.2 / §17 and is the accepted Slice 3 posture.
 *   * The encoding is `base64url(payload) + "." + base64url(sig)` to keep
 *     the state safe for URL query params (no `+`, `/`, `=` padding).
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// State sign / verify
// ---------------------------------------------------------------------------

export class OAuthStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthStateError";
  }
}

/**
 * Specialized subtype for expiry so callers can distinguish "stale install
 * link" from "tampered" and show a friendlier message. Tests also assert
 * this subtype directly.
 */
export class OAuthStateExpiredError extends OAuthStateError {
  constructor(message = "oauth state has expired") {
    super(message);
    this.name = "OAuthStateExpiredError";
  }
}

type StatePayload = { nonce: string; expiresAt: number };

function base64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecode(s: string): Buffer {
  // Pad back to multiple-of-4 for Node's base64 decoder.
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function signBytes(secret: string, bytes: Buffer): Buffer {
  return createHmac("sha256", secret).update(bytes).digest();
}

/**
 * Mint a fresh state string. The caller passes it into
 * {@link buildAuthorizeUrl} and HubSpot echoes it back on the callback.
 */
export function signState(args: { secret: string; ttlSeconds: number }): string {
  const payload: StatePayload = {
    nonce: randomBytes(16).toString("hex"),
    expiresAt: Date.now() + args.ttlSeconds * 1000,
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const sig = signBytes(args.secret, payloadBytes);
  return `${base64urlEncode(payloadBytes)}.${base64urlEncode(sig)}`;
}

/**
 * Verify a callback-supplied state. Throws {@link OAuthStateError} (or
 * {@link OAuthStateExpiredError} for stale states) on any failure.
 *
 * @returns `{ ok: true }` on success. We do not expose the decoded payload
 *   because callers never need the nonce — they only need to know the
 *   round-trip was honest.
 */
export function verifyState(args: { secret: string; state: string; now: number }): {
  ok: true;
} {
  const sepIdx = args.state.indexOf(".");
  if (sepIdx === -1) {
    throw new OAuthStateError("oauth state missing signature separator");
  }
  const payloadPart = args.state.slice(0, sepIdx);
  const sigPart = args.state.slice(sepIdx + 1);
  if (payloadPart.length === 0 || sigPart.length === 0) {
    throw new OAuthStateError("oauth state malformed");
  }

  let payloadBytes: Buffer;
  let receivedSig: Buffer;
  try {
    payloadBytes = base64urlDecode(payloadPart);
    receivedSig = base64urlDecode(sigPart);
  } catch {
    throw new OAuthStateError("oauth state not base64url");
  }

  const expectedSig = signBytes(args.secret, payloadBytes);

  // Length-guard first so timingSafeEqual does not throw. We still compare
  // against a fixed-length buffer so an attacker cannot distinguish
  // "wrong length" from "wrong bytes" via timing.
  const guardBytes = Buffer.alloc(expectedSig.length);
  const candidate = receivedSig.length === expectedSig.length ? receivedSig : guardBytes;
  const signatureMatches =
    timingSafeEqual(candidate, expectedSig) && receivedSig.length === expectedSig.length;
  if (!signatureMatches) {
    throw new OAuthStateError("oauth state signature invalid");
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    throw new OAuthStateError("oauth state payload not json");
  }
  if (typeof payload.expiresAt !== "number" || typeof payload.nonce !== "string") {
    throw new OAuthStateError("oauth state payload shape invalid");
  }

  if (args.now > payload.expiresAt) {
    throw new OAuthStateExpiredError();
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Authorize-URL builder
// ---------------------------------------------------------------------------

export const HUBSPOT_AUTHORIZE_URL = "https://app.hubspot.com/oauth/authorize";

/**
 * Build the HubSpot authorize URL the user is redirected to from
 * `/oauth/install`. HubSpot expects space-separated scope values.
 */
export function buildAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  optionalScopes?: string[];
  state: string;
}): string {
  if (args.scopes.length === 0) {
    throw new Error("buildAuthorizeUrl: at least one scope is required");
  }
  const redirect = new URL(args.redirectUri);
  const redirectIsLocalhostHttp =
    redirect.protocol === "http:" && redirect.hostname === "localhost";
  if (redirect.protocol !== "https:" && !redirectIsLocalhostHttp) {
    throw new Error(
      "buildAuthorizeUrl: redirectUri must use https, or http only when the hostname is localhost",
    );
  }
  const params = new URLSearchParams();
  params.set("client_id", args.clientId);
  params.set("redirect_uri", args.redirectUri);
  params.set("scope", args.scopes.join(" "));
  params.set("state", args.state);
  if (args.optionalScopes && args.optionalScopes.length > 0) {
    params.set("optional_scope", args.optionalScopes.join(" "));
  }
  return `${HUBSPOT_AUTHORIZE_URL}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// HTTP helpers — token exchange, refresh, identity
// ---------------------------------------------------------------------------

export const HUBSPOT_TOKEN_URL = "https://api.hubapi.com/oauth/2026-03/token";
export const HUBSPOT_TOKEN_IDENTITY_URL_PREFIX = "https://api.hubapi.com/oauth/v1/access-tokens/";

/** Minimum contract every OAuth helper needs: a fetch implementation. */
export type OAuthHttpDeps = {
  /**
   * Optional fetch override. Defaults to the global `fetch`. Tests inject
   * a fake fetch backed by cassettes — zero network traffic in CI.
   */
  fetch?: typeof fetch;
};

export class OAuthHttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "OAuthHttpError";
    this.status = status;
    this.body = body;
  }
}

export type OAuthTokenResponse = {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. Multiply by 1000 for Date math. */
  expiresIn: number;
  tokenType: string;
};

function resolveFetch(deps: OAuthHttpDeps): typeof fetch {
  return deps.fetch ?? fetch;
}

async function parseTokenResponse(response: Response): Promise<OAuthTokenResponse> {
  if (!response.ok) {
    // Read the body safely — HubSpot returns JSON error docs on 4xx.
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Non-JSON body; fall through with null.
    }
    throw new OAuthHttpError(
      `hubspot token endpoint returned ${response.status}`,
      response.status,
      body,
    );
  }
  const body = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  };
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresIn: body.expires_in,
    tokenType: body.token_type,
  };
}

/**
 * Exchange an authorization code for access + refresh tokens (install flow).
 *
 * HubSpot requires `application/x-www-form-urlencoded` on the request body;
 * JSON is rejected. See slice-3-preflight-notes.md §3.
 */
export async function exchangeCodeForTokens(
  args: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  } & OAuthHttpDeps,
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: args.clientId,
    client_secret: args.clientSecret,
    code: args.code,
    redirect_uri: args.redirectUri,
  });
  const response = await resolveFetch(args)(HUBSPOT_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return parseTokenResponse(response);
}

/**
 * Exchange a refresh token for a rotated access + refresh token pair.
 * HubSpot rotates refresh tokens on every refresh — the old value is invalid
 * after a successful call and the caller MUST persist the new value.
 */
export async function refreshAccessToken(
  args: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  } & OAuthHttpDeps,
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: args.clientId,
    client_secret: args.clientSecret,
    refresh_token: args.refreshToken,
  });
  const response = await resolveFetch(args)(HUBSPOT_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return parseTokenResponse(response);
}

export type TokenIdentity = {
  hubId: number;
  user: string;
  hubDomain: string;
  scopes: string[];
  /** Seconds remaining on the access token at fetch time. */
  expiresIn: number;
  userId: number;
  appId: number;
};

/**
 * Fetch identity metadata for a given access token. Called from the OAuth
 * callback flow to resolve `hub_id` (the HubSpot portal ID) and confirm the
 * scopes the user actually granted. No `Authorization` header needed — the
 * token itself goes in the URL path.
 */
export async function fetchTokenIdentity(
  args: { accessToken: string } & OAuthHttpDeps,
): Promise<TokenIdentity> {
  const url = `${HUBSPOT_TOKEN_IDENTITY_URL_PREFIX}${encodeURIComponent(args.accessToken)}`;
  const response = await resolveFetch(args)(url, { method: "GET" });

  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Non-JSON body; ignore.
    }
    throw new OAuthHttpError(
      `hubspot token-identity endpoint returned ${response.status}`,
      response.status,
      body,
    );
  }

  const body = (await response.json()) as {
    user: string;
    hub_domain: string;
    scopes: string[];
    hub_id: number;
    app_id: number;
    expires_in: number;
    user_id: number;
  };
  return {
    hubId: body.hub_id,
    user: body.user,
    hubDomain: body.hub_domain,
    scopes: body.scopes,
    expiresIn: body.expires_in,
    userId: body.user_id,
    appId: body.app_id,
  };
}
