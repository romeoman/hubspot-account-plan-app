/**
 * Slice 3 Task 3 — OAuth helpers unit tests.
 *
 * Covers the PURE helpers in `../oauth.ts` that do not touch the network:
 *   - signState / verifyState — stateless CSRF guard HMACs
 *   - buildAuthorizeUrl — constructs the HubSpot install URL
 *
 * Network-touching helpers (exchangeCodeForTokens, refreshAccessToken,
 * fetchTokenIdentity) are tested via cassette in a separate spec that
 * injects a fake `fetch`.
 */

import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  OAuthStateError,
  OAuthStateExpiredError,
  signState,
  verifyState,
} from "../oauth";

const SECRET = "test-client-secret-32-bytes-minimum-length-value";
const DIFFERENT_SECRET = "different-client-secret-different-value-here";

describe("signState + verifyState", () => {
  it("round-trips a state string signed with the same secret", () => {
    const state = signState({ secret: SECRET, ttlSeconds: 600 });
    const result = verifyState({ secret: SECRET, state, now: Date.now() });
    expect(result.ok).toBe(true);
  });

  it("rejects state signed with a different secret (tampered or wrong app)", () => {
    const state = signState({ secret: SECRET, ttlSeconds: 600 });
    expect(() => verifyState({ secret: DIFFERENT_SECRET, state, now: Date.now() })).toThrow(
      OAuthStateError,
    );
  });

  it("rejects a state whose payload bytes have been tampered with", () => {
    const state = signState({ secret: SECRET, ttlSeconds: 600 });
    // Flip one character in the payload portion (before the signature dot).
    const [payload, sig] = state.split(".");
    if (!payload || !sig) throw new Error("malformed test state");
    const flippedChar = payload[0] === "a" ? "b" : "a";
    const tampered = `${flippedChar}${payload.slice(1)}.${sig}`;
    expect(() => verifyState({ secret: SECRET, state: tampered, now: Date.now() })).toThrow(
      OAuthStateError,
    );
  });

  it("rejects an expired state (now > expiresAt)", () => {
    const ttlSeconds = 60;
    const state = signState({ secret: SECRET, ttlSeconds });
    // Simulate "now" as 10 minutes in the future — well past the 60s TTL.
    const future = Date.now() + 10 * 60 * 1000;
    expect(() => verifyState({ secret: SECRET, state, now: future })).toThrow(
      OAuthStateExpiredError,
    );
  });

  it("rejects malformed state strings (no signature separator)", () => {
    expect(() => verifyState({ secret: SECRET, state: "malformed", now: Date.now() })).toThrow(
      OAuthStateError,
    );
  });

  it("uses timing-safe signature comparison (no early-exit)", () => {
    // Signatures of different lengths must NOT throw a length-mismatch-crashing
    // error; verifyState must handle the mismatch via the timing-safe path.
    const fake = "aaaa.bbbb";
    expect(() => verifyState({ secret: SECRET, state: fake, now: Date.now() })).toThrow(
      OAuthStateError,
    );
  });

  it("each sign call produces a different state (fresh nonce every time)", () => {
    const s1 = signState({ secret: SECRET, ttlSeconds: 600 });
    const s2 = signState({ secret: SECRET, ttlSeconds: 600 });
    expect(s1).not.toBe(s2);
  });
});

describe("buildAuthorizeUrl", () => {
  it("builds a well-formed HubSpot authorize URL with required params", () => {
    const url = buildAuthorizeUrl({
      clientId: "abc-123-xyz",
      redirectUri: "http://localhost:3000/oauth/callback",
      scopes: ["crm.objects.companies.read", "crm.objects.contacts.read"],
      state: "signed-state-value",
    });

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://app.hubspot.com/oauth/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("abc-123-xyz");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:3000/oauth/callback");
    expect(parsed.searchParams.get("scope")).toBe(
      "crm.objects.companies.read crm.objects.contacts.read",
    );
    expect(parsed.searchParams.get("state")).toBe("signed-state-value");
  });

  it("omits optionalScopes param when the list is empty", () => {
    const url = buildAuthorizeUrl({
      clientId: "id",
      redirectUri: "http://localhost:3000/oauth/callback",
      scopes: ["crm.objects.companies.read"],
      state: "s",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.has("optional_scope")).toBe(false);
  });

  it("includes optional_scope when optionalScopes is non-empty", () => {
    const url = buildAuthorizeUrl({
      clientId: "id",
      redirectUri: "http://localhost:3000/oauth/callback",
      scopes: ["crm.objects.companies.read"],
      optionalScopes: ["automation.sequences.read"],
      state: "s",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("optional_scope")).toBe("automation.sequences.read");
  });

  it("URL-encodes redirect_uri with query strings, spaces, and special chars", () => {
    const url = buildAuthorizeUrl({
      clientId: "id",
      redirectUri: "https://app.example.com/oauth callback?x=y&z=1",
      scopes: ["crm.objects.companies.read"],
      state: "s",
    });
    const parsed = new URL(url);
    // URLSearchParams.get decodes for us — the round-trip should match.
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/oauth callback?x=y&z=1",
    );
  });

  it("rejects an empty scope list — HubSpot requires at least one", () => {
    expect(() =>
      buildAuthorizeUrl({
        clientId: "id",
        redirectUri: "http://localhost:3000/oauth/callback",
        scopes: [],
        state: "s",
      }),
    ).toThrow(/scope/i);
  });
});
