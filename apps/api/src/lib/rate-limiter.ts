/**
 * Per-tenant token-bucket rate limiter (Slice 2 Step 7).
 *
 * Buckets are keyed on `(tenantId, provider)`. Each external-service adapter
 * (Step 8 LLM, Step 9 signals) is expected to call {@link RateLimiter.acquire}
 * BEFORE making a network request and handle `allowed === false` either by
 * backing off or surfacing a retry-after response to the caller.
 *
 * Algorithm: classic token bucket.
 *   - `capacity` is the maximum burst — a fresh bucket starts full.
 *   - `refillRatePerSec` tokens are added per second of wall-clock time.
 *   - On `acquire`, we lazily refill based on the elapsed time since last
 *     refill, then consume one token if any are available.
 *
 * The clock is injectable (`deps.now`) so tests run deterministically without
 * touching `vi.useFakeTimers()` for every case — cleaner than using the Step 6
 * {@link ./cache-adapter} which reads `Date.now()` internally.
 *
 * Config source of truth: the `rate_limit_config` jsonb column on
 * {@link ../../../../packages/db/src/schema/provider-config} and
 * {@link ../../../../packages/db/src/schema/llm-config}. Its shape is
 * unconstrained at the DB level; {@link parseRateLimitConfig} is the runtime
 * guard that callers use to validate before passing to {@link RateLimiter.acquire}.
 *
 * Cross-tenant + cross-provider isolation is structural: bucket keys concat
 * both dimensions (`${tenantId}:${provider}`). This class does NOT enforce
 * tenant authentication — that's the upstream middleware's job. It assumes
 * the caller has already resolved a trusted `tenantId`.
 */

/**
 * Shape of the `rate_limit_config` jsonb column. When a tenant hasn't
 * configured limits, callers pass `undefined` and the default kicks in.
 */
export interface RateLimitConfig {
  /** Maximum burst size. A fresh bucket starts with this many tokens. */
  capacity: number;
  /** Tokens added per second of elapsed wall-clock time. */
  refillRatePerSec: number;
}

/**
 * Sensible default when a tenant has not configured explicit limits.
 *
 * 60-token burst / 1 rps sustained matches typical LLM + search provider
 * free-tier limits (OpenAI 3 rpm for gpt-4 is the exception — those tenants
 * MUST override this via `rate_limit_config`). We prefer generous defaults at
 * this layer because individual providers enforce their own quotas server-side
 * and surface retryable 429s that the adapter can handle.
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = Object.freeze({
  capacity: 60,
  refillRatePerSec: 1,
});

/**
 * Validate a `rate_limit_config` jsonb value read from the DB.
 *
 * Hand-rolled rather than using Zod — keeps apps/api dep-free of the
 * validator package and matches the minimal-dep discipline from Slice 1.
 *
 * @returns the parsed config, or `null` if the shape is malformed, missing,
 *   or contains non-positive values. Callers SHOULD fall back to
 *   {@link DEFAULT_RATE_LIMIT_CONFIG} when this returns null.
 */
export function parseRateLimitConfig(value: unknown): RateLimitConfig | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const { capacity, refillRatePerSec } = obj;
  if (
    typeof capacity !== "number" ||
    !Number.isFinite(capacity) ||
    !Number.isInteger(capacity) ||
    capacity <= 0
  ) {
    return null;
  }
  if (
    typeof refillRatePerSec !== "number" ||
    !Number.isFinite(refillRatePerSec) ||
    refillRatePerSec <= 0
  ) {
    return null;
  }
  return { capacity, refillRatePerSec };
}

/** Internal per-`(tenant, provider)` bucket state. */
interface Bucket {
  capacity: number;
  refillRatePerSec: number;
  tokens: number;
  lastRefillMs: number;
}

/** Outcome of an `acquire()` call. */
export interface AcquireResult {
  allowed: boolean;
  /** When `allowed === false`, ms until the next token becomes available. */
  retryAfterMs?: number;
}

/** Constructor options. */
export interface RateLimiterDeps {
  /** Clock source in ms. Defaults to `Date.now`. Inject for tests. */
  now?: () => number;
}

/**
 * Token-bucket rate limiter. Instances hold bucket state in-process; multi-
 * instance deployments (Slice 3+) should swap in a shared store (Redis INCR
 * with a TTL script). That change doesn't affect the public contract.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;

  constructor(deps: RateLimiterDeps = {}) {
    this.now = deps.now ?? Date.now;
  }

  /**
   * Attempt to consume one token for `(tenantId, provider)`.
   *
   * @param tenantId - trusted tenant UUID (caller must have authenticated).
   * @param provider - provider identifier (e.g. `'exa'`, `'openai'`).
   * @param config - optional override; defaults to
   *   {@link DEFAULT_RATE_LIMIT_CONFIG} when absent.
   */
  async acquire(
    tenantId: string,
    provider: string,
    config?: RateLimitConfig,
  ): Promise<AcquireResult> {
    const cfg = config ?? DEFAULT_RATE_LIMIT_CONFIG;
    const key = `${tenantId}:${provider}`;
    const now = this.now();

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        capacity: cfg.capacity,
        refillRatePerSec: cfg.refillRatePerSec,
        tokens: cfg.capacity,
        lastRefillMs: now,
      };
      this.buckets.set(key, bucket);
    } else {
      // If config changed since last call, apply the new ceiling on refill
      // but don't retroactively inflate tokens past the new capacity.
      bucket.capacity = cfg.capacity;
      bucket.refillRatePerSec = cfg.refillRatePerSec;
    }

    // Lazy refill: add tokens proportional to elapsed time.
    const elapsedMs = Math.max(0, now - bucket.lastRefillMs);
    if (elapsedMs > 0) {
      const refilled = (elapsedMs / 1000) * bucket.refillRatePerSec;
      bucket.tokens = Math.min(bucket.capacity, bucket.tokens + refilled);
      bucket.lastRefillMs = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true };
    }

    // Denied. Compute time until the next whole token is available.
    const deficit = 1 - bucket.tokens;
    const retryAfterMs = Math.ceil((deficit / bucket.refillRatePerSec) * 1000);
    return { allowed: false, retryAfterMs };
  }

  /** @internal — test-only helper. */
  __clear(): void {
    this.buckets.clear();
  }
}

/**
 * Factory helper for callers that prefer the functional style. Equivalent to
 * `new RateLimiter(deps)` but reads naturally in adapter-factory wiring.
 */
export function createRateLimiter(deps: RateLimiterDeps = {}): RateLimiter {
  return new RateLimiter(deps);
}

/**
 * Module-level process singleton, used by default adapter factories in Step 8/9
 * so all tenants share one in-process bucket map. Tests that want isolation
 * should build their own `createRateLimiter(...)` instance.
 */
let processLimiter: RateLimiter | null = null;

/** Shared process-wide limiter (lazy). */
export function getProcessRateLimiter(): RateLimiter {
  if (!processLimiter) processLimiter = new RateLimiter();
  return processLimiter;
}

/**
 * TEST-ONLY hook. Drops the process-singleton and clears bucket state so
 * `beforeEach` gets a clean slate. Mirrors the pattern used by
 * {@link ./encryption.__resetEncryptionCacheForTests}.
 * @internal
 */
export function __resetRateLimiterForTests(): void {
  if (processLimiter) processLimiter.__clear();
  processLimiter = null;
}
