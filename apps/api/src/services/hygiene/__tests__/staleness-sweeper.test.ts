/**
 * Staleness sweeper unit tests.
 *
 * Splits Evidence into `fresh` + `stale` buckets based on
 * `thresholds.freshnessMaxDays`. Per-tenant thresholds mean the same row can
 * be stale for tenant A (strict) and fresh for tenant B (lenient).
 *
 * Boundary: `ageDays === freshnessMaxDays` is FRESH (matches the existing
 * TrustEvaluator.evaluateFreshness semantics — see trust.test.ts
 * "treats age exactly at threshold as fresh").
 */

import { createEvidence, type Evidence, type ThresholdConfig } from "@hap/config";
import { describe, expect, it } from "vitest";
import { sweepStaleness } from "../staleness-sweeper";

const TENANT = "tenant-sweep-a";
const DAY_MS = 24 * 60 * 60 * 1000;

function ev(overrides: Partial<Evidence> = {}): Evidence {
  return createEvidence(TENANT, {
    id: overrides.id ?? "ev-1",
    source: overrides.source ?? "example.com",
    confidence: overrides.confidence ?? 0.7,
    content: overrides.content ?? "content",
    timestamp: overrides.timestamp ?? new Date(),
    isRestricted: overrides.isRestricted ?? false,
    ...overrides,
  });
}

describe("sweepStaleness", () => {
  const NOW = new Date("2026-04-15T00:00:00Z");
  const clock = () => NOW;

  it("splits 29-day-old as fresh and 31-day-old as stale at 30-day threshold", () => {
    const thresholds: ThresholdConfig = {
      freshnessMaxDays: 30,
      minConfidence: 0.5,
    };
    const fresh29 = ev({
      id: "ev-29",
      timestamp: new Date(NOW.getTime() - 29 * DAY_MS),
    });
    const stale31 = ev({
      id: "ev-31",
      timestamp: new Date(NOW.getTime() - 31 * DAY_MS),
    });
    const out = sweepStaleness([fresh29, stale31], thresholds, clock);
    expect(out.fresh.map((e) => e.id)).toEqual(["ev-29"]);
    expect(out.stale.map((e) => e.id)).toEqual(["ev-31"]);
  });

  it("same evidence is stale for strict tenant (7d) and fresh for lenient tenant (90d)", () => {
    const strict: ThresholdConfig = { freshnessMaxDays: 7, minConfidence: 0.5 };
    const lenient: ThresholdConfig = {
      freshnessMaxDays: 90,
      minConfidence: 0.5,
    };
    const e = ev({
      id: "ev-30",
      timestamp: new Date(NOW.getTime() - 30 * DAY_MS),
    });
    const strictOut = sweepStaleness([e], strict, clock);
    const lenientOut = sweepStaleness([e], lenient, clock);
    expect(strictOut.stale).toHaveLength(1);
    expect(strictOut.fresh).toHaveLength(0);
    expect(lenientOut.fresh).toHaveLength(1);
    expect(lenientOut.stale).toHaveLength(0);
  });

  it("treats exactly-N-days-old as FRESH (boundary aligns with TrustEvaluator.evaluateFreshness)", () => {
    const thresholds: ThresholdConfig = {
      freshnessMaxDays: 30,
      minConfidence: 0.5,
    };
    const e = ev({
      id: "ev-exact",
      timestamp: new Date(NOW.getTime() - 30 * DAY_MS),
    });
    const out = sweepStaleness([e], thresholds, clock);
    expect(out.fresh).toHaveLength(1);
    expect(out.stale).toHaveLength(0);
  });

  it("returns { fresh: [], stale: [] } for empty input", () => {
    const thresholds: ThresholdConfig = {
      freshnessMaxDays: 30,
      minConfidence: 0.5,
    };
    const out = sweepStaleness([], thresholds, clock);
    expect(out).toEqual({ fresh: [], stale: [] });
  });

  it("preserves input order within each bucket", () => {
    const thresholds: ThresholdConfig = {
      freshnessMaxDays: 30,
      minConfidence: 0.5,
    };
    const a = ev({ id: "a", timestamp: new Date(NOW.getTime() - 5 * DAY_MS) });
    const b = ev({
      id: "b",
      timestamp: new Date(NOW.getTime() - 100 * DAY_MS),
    });
    const c = ev({ id: "c", timestamp: new Date(NOW.getTime() - 10 * DAY_MS) });
    const d = ev({
      id: "d",
      timestamp: new Date(NOW.getTime() - 200 * DAY_MS),
    });
    const out = sweepStaleness([a, b, c, d], thresholds, clock);
    expect(out.fresh.map((e) => e.id)).toEqual(["a", "c"]);
    expect(out.stale.map((e) => e.id)).toEqual(["b", "d"]);
  });

  it("defaults `now` to wall clock when not injected", () => {
    const thresholds: ThresholdConfig = {
      freshnessMaxDays: 30,
      minConfidence: 0.5,
    };
    // Fresh because timestamp=now via default createEvidence
    const e = ev({ id: "ev-default-now" });
    const out = sweepStaleness([e], thresholds);
    expect(out.fresh).toHaveLength(1);
  });
});
