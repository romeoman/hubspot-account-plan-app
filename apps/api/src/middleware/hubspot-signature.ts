/**
 * HubSpot signed-request authentication middleware (Slice 2 Step 4).
 *
 * Verifies inbound requests from HubSpot (typically forwarded through
 * `hubspot.fetch()` in a UI extension) using the v3 request-signature spec:
 *
 *   - Header:    `X-HubSpot-Signature-v3` (base64-encoded HMAC-SHA256)
 *   - Timestamp: `X-HubSpot-Request-Timestamp` (ms since epoch)
 *   - Raw:       `method + decoded(uri) + body + timestamp`
 *   - Key:       `HUBSPOT_CLIENT_SECRET`
 *   - Freshness: reject if |now - timestamp| > 5 minutes
 *
 * Source:  https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/request-validation
 * Also:    https://developers.hubspot.com/docs/apps/developer-platform/add-features/ui-extensions/fetching-data
 * Retrieved: 2026-04-15 (via Context7 `/websites/developers_hubspot`).
 *
 * `portalId` and `userId` are extracted from the signed payload — the request
 * body for POST/PUT/PATCH (JSON), or the query string for GET/DELETE. They
 * are NEVER read from custom headers. The portal is then resolved to an
 * internal `tenantId` by the downstream `tenantMiddleware`.
 *
 * Failure modes (all return `401 { error: 'unauthorized' }`):
 *   - Missing signature or timestamp header
 *   - Malformed / non-numeric timestamp
 *   - Timestamp outside the 5-minute freshness window
 *   - HMAC mismatch (tampered body, wrong secret, forged signature)
 *   - Missing `portalId` in the signed payload
 *
 * Test bypass: when `NODE_ENV === 'test'` AND `ALLOW_TEST_AUTH === 'true'`,
 * an inbound `x-test-portal-id` header (with optional `x-test-user-id`) is
 * honored WITHOUT signature verification. Both env conditions are REQUIRED —
 * removing either rejects the bypass with 401. This matches `auth.test.ts`
 * and `hubspot-signature.test.ts`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { loadEnv } from "@hap/config";
import type { MiddlewareHandler } from "hono";
import type { TenantVariables } from "./tenant.js";

/**
 * HubSpot v3 signature freshness window.
 *
 * Signature validation still enforces HubSpot's 5-minute skew bound; Slice 3's
 * replay defense is layered separately in `nonceMiddleware()`, which records a
 * tenant-scoped nonce after auth + tenant resolution.
 */
const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

/** Header names (lower-cased for consistent lookup via Hono's `c.req.header`). */
const SIGNATURE_HEADER = "x-hubspot-signature-v3";
const TIMESTAMP_HEADER = "x-hubspot-request-timestamp";
const TEST_PORTAL_HEADER = "x-test-portal-id";
const TEST_USER_HEADER = "x-test-user-id";

/**
 * Lazily-resolved `HUBSPOT_CLIENT_SECRET`. Cached for the process lifetime
 * once first read, mirroring {@link ../lib/encryption.ts}.
 */
let clientSecretCache: string | null = null;
function getClientSecret(): string {
  if (clientSecretCache !== null) return clientSecretCache;
  const env = loadEnv();
  if (!env.HUBSPOT_CLIENT_SECRET || env.HUBSPOT_CLIENT_SECRET.length === 0) {
    throw new Error(
      "hubspot-signature: HUBSPOT_CLIENT_SECRET is not set; required for signed-request verification.",
    );
  }
  clientSecretCache = env.HUBSPOT_CLIENT_SECRET;
  return clientSecretCache;
}

/**
 * TEST-ONLY hook: clears the cached client secret so tests that swap
 * `HUBSPOT_CLIENT_SECRET` between cases force a re-read on next request.
 * @internal
 */
export function __resetHubspotSignatureCacheForTests(): void {
  clientSecretCache = null;
}

/**
 * Pure HubSpot v3 signed-request HMAC check. Shared by
 * {@link hubspotSignatureMiddleware} and webhook routes whose payload shape
 * (e.g., top-level JSON arrays) means the middleware's principal extraction
 * cannot apply.
 *
 * Contract:
 *   - `url` MUST be exactly what Hono's `c.req.url` reports (includes
 *     protocol + host + path + query). The verifier applies
 *     `decodeURIComponent` to match HubSpot's reference implementation.
 *   - `timestamp` is ms since epoch, taken from
 *     `X-HubSpot-Request-Timestamp`.
 *   - The signature is the base64 HMAC-SHA256 of
 *     `${method}${decodeURIComponent(url)}${body}${timestamp}`, keyed by
 *     `HUBSPOT_CLIENT_SECRET`.
 *
 * Freshness is enforced here as well so callers never have to reimplement
 * the 5-minute skew check.
 */
export function verifyHubSpotSignatureV3(params: {
  method: string;
  url: string;
  body: string;
  timestamp: number;
  signature: string;
  /** Override for tests; defaults to `Date.now()`. */
  now?: number;
}): { ok: true } | { ok: false; reason: string } {
  if (!params.signature || params.signature.length === 0) {
    return { ok: false, reason: "missing signature" };
  }
  if (!Number.isFinite(params.timestamp) || params.timestamp <= 0) {
    return { ok: false, reason: "malformed timestamp" };
  }
  const now = params.now ?? Date.now();
  if (Math.abs(now - params.timestamp) > MAX_TIMESTAMP_SKEW_MS) {
    return { ok: false, reason: "stale timestamp" };
  }

  let decodedUrl: string;
  try {
    decodedUrl = decodeURIComponent(params.url);
  } catch {
    return { ok: false, reason: "malformed url" };
  }

  const method = params.method.toUpperCase();
  const raw = `${method}${decodedUrl}${params.body}${params.timestamp}`;
  const expected = createHmac("sha256", getClientSecret()).update(raw, "utf8").digest("base64");

  if (!safeEquals(params.signature, expected)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}

/**
 * Hono variables populated by this middleware on success:
 *   - `portalId` — HubSpot portal identifier (string form of the numeric id).
 *   - `userId`   — HubSpot user identifier when present in the signed payload.
 *
 * Downstream `tenantMiddleware` uses `portalId` to resolve `tenantId`.
 */
export type HubSpotSignatureVariables = TenantVariables & {
  portalId?: string;
  userId?: string;
  rawBody?: string;
};

/** Opaque 401 response body — never includes the offending signature. */
function unauthorized() {
  return { error: "unauthorized" } as const;
}

/**
 * Redacted warning logger. Intentionally records only the failure reason and
 * an optional short tag — never the secret, signature, or raw body.
 */
function logAuthFailure(reason: string): void {
  console.warn(`hubspot-signature: ${reason}`);
}

/**
 * Constant-time equality over two strings. Handles unequal lengths safely by
 * coercing to fixed-size buffers before `timingSafeEqual` (which requires
 * matching lengths).
 */
function safeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    // Still run a dummy compare on a padded buffer so timing is roughly
    // constant regardless of length mismatch.
    const padded = Buffer.alloc(aBuf.length);
    timingSafeEqual(aBuf, padded);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Extract `portalId` + `userId` from the signed payload.
 *
 * For POST/PUT/PATCH with a JSON body, portal/user fields are expected at
 * the top level of the body object. For GET/DELETE they are read from the
 * query string (HubSpot appends them there for `hubspot.fetch()` without a
 * body). Returns `null` when portalId is absent — the middleware rejects
 * such requests.
 */
function extractPrincipals(
  method: string,
  url: URL,
  body: string,
): { portalId: string; userId?: string } | null {
  // Query string first (applies to GET/DELETE and also acts as a fallback
  // when a body lacks the fields).
  const queryPortal = url.searchParams.get("portalId");
  const queryUser = url.searchParams.get("userId") ?? undefined;

  if (method !== "POST" && method !== "PUT" && method !== "PATCH") {
    if (!queryPortal) return null;
    return { portalId: queryPortal, userId: queryUser };
  }

  // Body-based extraction for mutating methods.
  if (body.length === 0) {
    if (queryPortal) return { portalId: queryPortal, userId: queryUser };
    return null;
  }
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const portalRaw = parsed.portalId;
    const userRaw = parsed.userId;
    const portalId =
      typeof portalRaw === "string"
        ? portalRaw
        : typeof portalRaw === "number"
          ? String(portalRaw)
          : undefined;
    const userId =
      typeof userRaw === "string"
        ? userRaw
        : typeof userRaw === "number"
          ? String(userRaw)
          : undefined;
    if (portalId && portalId.length > 0) return { portalId, userId };
    if (queryPortal) return { portalId: queryPortal, userId: queryUser ?? userId };
    return null;
  } catch {
    // A mutating request with a malformed JSON body is anomalous — HubSpot's
    // signed requests always carry well-formed JSON. Silently downgrading to
    // query-string principal widens the surface for future parser bugs; fail
    // closed instead (independent review I7).
    return null;
  }
}

/**
 * Reconstruct the URL HubSpot signed. Hono's `c.req.url` already includes
 * protocol + host + path + query, which matches HubSpot's reference
 * implementation (`${protocol}://${hostname}${url}`).
 *
 * On Vercel TLS terminates at the edge and the function's underlying socket
 * is plain TCP, so `@hono/node-server/vercel` reconstructs `c.req.url` with
 * scheme `http://`. HubSpot's `hubspot.fetch` proxy signs the public HTTPS
 * URL, which would otherwise produce an HMAC mismatch (issue #24). When the
 * platform sets `x-forwarded-proto`, honor it as the canonical scheme so the
 * payload matches what HubSpot signed. Only `http`/`https` are accepted; any
 * other value is ignored (defensive — a forged header cannot redirect us to
 * an unknown scheme).
 */
export function canonicalizeRequestUrl(rawUrl: string, forwardedProto: string | null): string {
  if (!forwardedProto) return rawUrl;
  // `x-forwarded-proto` may be a comma-separated list (proxy chain). Take the
  // first entry, which is the original client-facing scheme.
  const proto = forwardedProto.split(",")[0]?.trim().toLowerCase();
  if (proto !== "http" && proto !== "https") return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === `${proto}:`) return rawUrl;
    parsed.protocol = `${proto}:`;
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Hono middleware factory for HubSpot v3 signed-request verification.
 */
export function hubspotSignatureMiddleware(): MiddlewareHandler<{
  Variables: HubSpotSignatureVariables;
}> {
  // Defer env validation to first request. Validating at construction-time
  // throws during module import in any context that hasn't loaded .env yet
  // (e.g., a future standalone utility script importing this for its types).
  // vitest.setup.ts still loads defaults for test runs, so tests see a valid
  // secret on their first mock request. (CodeRabbit C1.)
  let secretValidated = false;

  return async (c, next) => {
    if (!secretValidated) {
      // Throws with a clear "HUBSPOT_CLIENT_SECRET not set" error if missing.
      // The exception propagates to Hono's default 500 handler — operators
      // see it on the first real request, which is what we want for a
      // misconfigured deployment.
      getClientSecret();
      secretValidated = true;
    }
    // --- Test bypass (gated on BOTH NODE_ENV=test AND ALLOW_TEST_AUTH=true).
    const bypassEligible =
      process.env.NODE_ENV === "test" && process.env.ALLOW_TEST_AUTH === "true";
    if (bypassEligible) {
      const testPortal = c.req.header(TEST_PORTAL_HEADER);
      if (testPortal && testPortal.length > 0) {
        c.set("portalId", testPortal);
        const testUser = c.req.header(TEST_USER_HEADER);
        if (testUser && testUser.length > 0) c.set("userId", testUser);
        await next();
        return;
      }
    }

    const signature = c.req.header(SIGNATURE_HEADER);
    const timestampRaw = c.req.header(TIMESTAMP_HEADER);

    if (!signature || !timestampRaw) {
      logAuthFailure("missing signature or timestamp header");
      return c.json(unauthorized(), 401);
    }

    const timestamp = Number(timestampRaw);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      logAuthFailure("malformed timestamp header");
      return c.json(unauthorized(), 401);
    }

    const now = Date.now();
    if (Math.abs(now - timestamp) > MAX_TIMESTAMP_SKEW_MS) {
      logAuthFailure("stale timestamp");
      return c.json(unauthorized(), 401);
    }

    const method = c.req.method.toUpperCase();
    const url = canonicalizeRequestUrl(c.req.url, c.req.header("x-forwarded-proto") ?? null);

    // Read the raw body text exactly once. For GET/DELETE, this is an empty
    // string. For JSON POST/PUT/PATCH, Hono's `c.req.text()` returns the raw
    // stringified payload that HubSpot signed.
    let body = "";
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      try {
        body = await c.req.text();
      } catch {
        logAuthFailure("failed to read request body");
        return c.json(unauthorized(), 401);
      }
    }
    c.set("rawBody", body);

    // Per HubSpot reference implementation: decode the URI before hashing.
    let decodedUrl: string;
    try {
      decodedUrl = decodeURIComponent(url);
    } catch {
      logAuthFailure("malformed request url");
      return c.json(unauthorized(), 401);
    }

    const raw = `${method}${decodedUrl}${body}${timestamp}`;
    const expected = createHmac("sha256", getClientSecret()).update(raw, "utf8").digest("base64");

    if (!safeEquals(signature, expected)) {
      logAuthFailure("signature mismatch");
      return c.json(unauthorized(), 401);
    }

    const principals = extractPrincipals(method, new URL(url), body);
    if (!principals) {
      logAuthFailure("missing portalId in signed payload");
      return c.json(unauthorized(), 401);
    }

    c.set("portalId", principals.portalId);
    if (principals.userId) c.set("userId", principals.userId);
    await next();
  };
}
