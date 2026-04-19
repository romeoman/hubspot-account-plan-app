/**
 * Per-tenant token-bucket rate limiter for the settings test-connection
 * endpoint.
 *
 * Distinct from {@link ./rate-limiter} (which is keyed `(tenantId, provider)`
 * and protects downstream adapter calls with a DEFAULT of 60-burst/1-rps). The
 * test-connection path wants a stricter policy: 5 tests per 60 seconds per
 * tenant, so a single compromised tenant cannot turn the endpoint into a
 * free-tier DoS vector against upstream vendors.
 *
 * The bucket is in-process; multi-instance deployments will see up to
 * N * capacity per 60s across the fleet, which is acceptable for a human-
 * driven "Test connection" button.
 */

export interface TestConnectionRateLimiterOptions {
  /** Max tests per window. Default: 5. */
  capacity?: number;
  /** Window size in milliseconds. Default: 60_000. */
  windowMs?: number;
  /** Clock source for testability. */
  now?: () => number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export class TestConnectionRateLimiter {
  private readonly capacity: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(opts: TestConnectionRateLimiterOptions = {}) {
    this.capacity = opts.capacity ?? 5;
    this.windowMs = opts.windowMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Try to consume one token for `tenantId`. Returns `true` when allowed,
   * `false` when the bucket is empty.
   */
  allow(tenantId: string): boolean {
    const now = this.now();
    const refillRatePerMs = this.capacity / this.windowMs;
    let bucket = this.buckets.get(tenantId);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefillMs: now };
      this.buckets.set(tenantId, bucket);
    } else {
      const elapsed = Math.max(0, now - bucket.lastRefillMs);
      if (elapsed > 0) {
        bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * refillRatePerMs);
        bucket.lastRefillMs = now;
      }
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  /** @internal — test hook. */
  __clear(): void {
    this.buckets.clear();
  }
}

/** Module-level singleton used by the default route wiring. */
let processLimiter: TestConnectionRateLimiter | null = null;

export function getTestConnectionRateLimiter(): TestConnectionRateLimiter {
  if (!processLimiter) processLimiter = new TestConnectionRateLimiter();
  return processLimiter;
}

/** TEST-ONLY: reset the singleton. */
export function __resetTestConnectionRateLimiterForTests(): void {
  processLimiter = null;
}
