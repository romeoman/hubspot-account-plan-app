/**
 * Tests for the per-tenant token-bucket rate limiter (Slice 2 Step 7).
 *
 * Contract under test:
 *   - Bucket keyed on `(tenantId, provider)`.
 *   - Token-bucket with injectable clock for deterministic testing.
 *   - Cross-tenant + cross-provider isolation.
 *   - `parseRateLimitConfig` validates the jsonb shape from the DB.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetRateLimiterForTests,
  createRateLimiter,
  parseRateLimitConfig,
  type RateLimitConfig,
} from "../rate-limiter";

describe("RateLimiter", () => {
  beforeEach(() => {
    __resetRateLimiterForTests();
  });

  afterEach(() => {
    __resetRateLimiterForTests();
  });

  it("allows up to `capacity` bursts with a fresh bucket", async () => {
    const now = 1_000_000;
    const limiter = createRateLimiter({ now: () => now });
    const cfg: RateLimitConfig = { capacity: 5, refillRatePerSec: 1 };

    for (let i = 0; i < 5; i += 1) {
      const r = await limiter.acquire("tenant-a", "exa", cfg);
      expect(r.allowed).toBe(true);
    }

    const denied = await limiter.acquire("tenant-a", "exa", cfg);
    expect(denied.allowed).toBe(false);
    // With 1 token/sec refill, next token in ~1000ms.
    expect(denied.retryAfterMs).toBeGreaterThan(900);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(1000);
  });

  it("refills tokens over time at refillRatePerSec", async () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ now: () => now });
    const cfg: RateLimitConfig = { capacity: 2, refillRatePerSec: 1 };

    expect((await limiter.acquire("t", "p", cfg)).allowed).toBe(true);
    expect((await limiter.acquire("t", "p", cfg)).allowed).toBe(true);
    expect((await limiter.acquire("t", "p", cfg)).allowed).toBe(false);

    // Advance 1 full second -> 1 new token.
    now += 1000;
    expect((await limiter.acquire("t", "p", cfg)).allowed).toBe(true);
    expect((await limiter.acquire("t", "p", cfg)).allowed).toBe(false);
  });

  it("isolates buckets across tenants", async () => {
    const now = 1_000_000;
    const limiter = createRateLimiter({ now: () => now });
    const cfg: RateLimitConfig = { capacity: 2, refillRatePerSec: 1 };

    // Drain tenant-A.
    expect((await limiter.acquire("tenant-a", "exa", cfg)).allowed).toBe(true);
    expect((await limiter.acquire("tenant-a", "exa", cfg)).allowed).toBe(true);
    expect((await limiter.acquire("tenant-a", "exa", cfg)).allowed).toBe(false);

    // Tenant-B must still be full.
    expect((await limiter.acquire("tenant-b", "exa", cfg)).allowed).toBe(true);
    expect((await limiter.acquire("tenant-b", "exa", cfg)).allowed).toBe(true);
  });

  it("isolates buckets across providers within one tenant", async () => {
    const now = 1_000_000;
    const limiter = createRateLimiter({ now: () => now });
    const cfg: RateLimitConfig = { capacity: 1, refillRatePerSec: 1 };

    expect((await limiter.acquire("tenant-a", "exa", cfg)).allowed).toBe(true);
    expect((await limiter.acquire("tenant-a", "exa", cfg)).allowed).toBe(false);

    // Same tenant, different provider -> fresh bucket.
    expect((await limiter.acquire("tenant-a", "openai", cfg)).allowed).toBe(true);
  });

  it("applies a sensible default config when none is provided", async () => {
    const now = 1_000_000;
    const limiter = createRateLimiter({ now: () => now });

    // Default is { capacity: 60, refillRatePerSec: 1 }.
    for (let i = 0; i < 60; i += 1) {
      expect((await limiter.acquire("t", "p")).allowed).toBe(true);
    }
    expect((await limiter.acquire("t", "p")).allowed).toBe(false);
  });

  it("__resetForTests clears all bucket state", async () => {
    const now = 1_000_000;
    const limiter = createRateLimiter({ now: () => now });
    const cfg: RateLimitConfig = { capacity: 1, refillRatePerSec: 1 };

    expect((await limiter.acquire("t", "p", cfg)).allowed).toBe(true);
    expect((await limiter.acquire("t", "p", cfg)).allowed).toBe(false);

    __resetRateLimiterForTests();

    // A fresh limiter after reset must have a full bucket again.
    const limiter2 = createRateLimiter({ now: () => now });
    expect((await limiter2.acquire("t", "p", cfg)).allowed).toBe(true);
  });
});

describe("parseRateLimitConfig", () => {
  it("accepts a well-formed config", () => {
    expect(parseRateLimitConfig({ capacity: 10, refillRatePerSec: 2 })).toEqual({
      capacity: 10,
      refillRatePerSec: 2,
    });
  });

  it("returns null for malformed shape", () => {
    expect(parseRateLimitConfig({ capacity: "wrong", refillRatePerSec: 2 })).toBeNull();
    expect(parseRateLimitConfig({ capacity: 10 })).toBeNull();
    expect(parseRateLimitConfig({ refillRatePerSec: 1 })).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(parseRateLimitConfig(null)).toBeNull();
    expect(parseRateLimitConfig(undefined)).toBeNull();
  });

  it("rejects non-positive values", () => {
    expect(parseRateLimitConfig({ capacity: 0, refillRatePerSec: 1 })).toBeNull();
    expect(parseRateLimitConfig({ capacity: 1, refillRatePerSec: 0 })).toBeNull();
    expect(parseRateLimitConfig({ capacity: -5, refillRatePerSec: 1 })).toBeNull();
  });
});
