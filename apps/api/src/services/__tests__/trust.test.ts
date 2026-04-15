/**
 * Trust evaluator unit tests.
 *
 * Covers freshness, confidence, source validation, and suppression semantics
 * independently of the assembler. The assembler-level 8-state coverage lives
 * in `snapshot-assembler.test.ts`.
 *
 * Restricted leakage is the highest-stakes invariant here — each applySuppression
 * test with restricted input asserts that the FILTERED evidence array contains
 * zero restricted content (no ids, no content strings, no source names, no
 * timestamps).
 */

import { createEvidence, type Evidence, type ThresholdConfig } from "@hap/config";
import { describe, expect, it } from "vitest";
import { createTrustEvaluator } from "../trust";

const TENANT = "tenant-trust-a";
const DAY_MS = 24 * 60 * 60 * 1000;

const BASE_THRESHOLDS: ThresholdConfig = {
  freshnessMaxDays: 30,
  minConfidence: 0.5,
};

function ev(overrides: Partial<Evidence> = {}): Evidence {
  return createEvidence(TENANT, {
    id: overrides.id ?? "ev-1",
    source: overrides.source ?? "hubspot",
    confidence: overrides.confidence ?? 0.9,
    content: overrides.content ?? "some content",
    timestamp: overrides.timestamp ?? new Date(),
    isRestricted: overrides.isRestricted ?? false,
    ...overrides,
  });
}

describe("TrustEvaluator.evaluateFreshness", () => {
  const evaluator = createTrustEvaluator();
  const now = new Date("2026-04-15T00:00:00Z");

  it("returns isFresh=true when ageDays < freshnessMaxDays", () => {
    const e = ev({ timestamp: new Date(now.getTime() - 5 * DAY_MS) });
    const result = evaluator.evaluateFreshness(e, BASE_THRESHOLDS, now);
    expect(result.isFresh).toBe(true);
    expect(result.ageDays).toBe(5);
  });

  it("returns isFresh=false when ageDays > freshnessMaxDays", () => {
    const e = ev({ timestamp: new Date(now.getTime() - 60 * DAY_MS) });
    const result = evaluator.evaluateFreshness(e, BASE_THRESHOLDS, now);
    expect(result.isFresh).toBe(false);
    expect(result.ageDays).toBe(60);
  });

  it("treats age exactly at threshold as fresh", () => {
    const e = ev({ timestamp: new Date(now.getTime() - 30 * DAY_MS) });
    const result = evaluator.evaluateFreshness(e, BASE_THRESHOLDS, now);
    expect(result.isFresh).toBe(true);
    expect(result.ageDays).toBe(30);
  });

  it("coerces ISO-string timestamps instead of crashing", () => {
    // Simulate an evidence row that round-tripped through JSON somewhere in
    // the pipeline — timestamp is now a string, not a Date.
    const e = ev({ timestamp: new Date(now.getTime() - 10 * DAY_MS) });
    const serialized = {
      ...e,
      timestamp: (e.timestamp as Date).toISOString(),
    } as unknown as Evidence;
    const result = evaluator.evaluateFreshness(serialized, BASE_THRESHOLDS, now);
    expect(result.ageDays).toBe(10);
    expect(result.isFresh).toBe(true);
  });

  it("treats future-dated evidence as not-fresh (no free pass via age clamping)", () => {
    const e = ev({ timestamp: new Date(now.getTime() + 5 * DAY_MS) });
    const result = evaluator.evaluateFreshness(e, BASE_THRESHOLDS, now);
    expect(result.isFresh).toBe(false);
    // Reports the absolute skew so callers can see how off the timestamp is.
    expect(result.ageDays).toBeGreaterThan(0);
  });

  it("treats unparseable timestamp as extremely stale rather than throwing", () => {
    const e = ev({ timestamp: new Date() });
    const broken = { ...e, timestamp: "not-a-date" } as unknown as Evidence;
    const result = evaluator.evaluateFreshness(broken, BASE_THRESHOLDS, now);
    expect(result.isFresh).toBe(false);
    expect(result.ageDays).toBeGreaterThan(365 * 30);
  });
});

describe("TrustEvaluator.evaluateConfidence", () => {
  const evaluator = createTrustEvaluator();

  it("returns isAdequate=true when confidence >= minConfidence", () => {
    const result = evaluator.evaluateConfidence(ev({ confidence: 0.75 }), BASE_THRESHOLDS);
    expect(result.isAdequate).toBe(true);
    expect(result.score).toBe(0.75);
  });

  it("returns isAdequate=false when confidence < minConfidence", () => {
    const result = evaluator.evaluateConfidence(ev({ confidence: 0.3 }), BASE_THRESHOLDS);
    expect(result.isAdequate).toBe(false);
    expect(result.score).toBe(0.3);
  });
});

describe("TrustEvaluator.validateSource", () => {
  const evaluator = createTrustEvaluator();

  it("accepts non-empty alphanumeric sources", () => {
    expect(evaluator.validateSource(ev({ source: "hubspot" })).isValid).toBe(true);
    expect(evaluator.validateSource(ev({ source: "news123" })).isValid).toBe(true);
    expect(evaluator.validateSource(ev({ source: "mock-signal" })).isValid).toBe(true);
  });

  it("rejects empty source", () => {
    const res = evaluator.validateSource(ev({ source: "" }));
    expect(res.isValid).toBe(false);
    expect(res.degradationReason).toBeDefined();
  });

  it("rejects whitespace-only source", () => {
    const res = evaluator.validateSource(ev({ source: "   " }));
    expect(res.isValid).toBe(false);
    expect(res.degradationReason).toBeDefined();
  });

  it("rejects unknown/garbage source characters as degraded", () => {
    const res = evaluator.validateSource(ev({ source: "<script>" }));
    expect(res.isValid).toBe(false);
    expect(res.degradationReason).toBeDefined();
  });
});

describe("TrustEvaluator.applySuppression — restricted zero-leak", () => {
  const evaluator = createTrustEvaluator();
  const now = new Date("2026-04-15T00:00:00Z");

  it("removes ALL restricted evidence and sets stateFlags.restricted=true", () => {
    // Pin a uniquely identifiable restricted timestamp so we can also assert
    // the timestamp itself is absent from filteredEvidence + warnings — not
    // just the id/source/content. A leaked timestamp is a leak.
    const RESTRICTED_TS = new Date("2024-07-04T13:37:42.555Z");
    const RESTRICTED_TS_ISO = RESTRICTED_TS.toISOString();
    const input: Evidence[] = [
      ev({
        id: "ev-secret-1",
        source: "internal-hr",
        content: "SECRET EMPLOYEE NOTE",
        timestamp: RESTRICTED_TS,
        isRestricted: true,
      }),
      ev({
        id: "ev-ok-1",
        source: "hubspot",
        content: "Public engagement signal",
        isRestricted: false,
      }),
    ];
    const out = evaluator.applySuppression(input, BASE_THRESHOLDS, now);

    expect(out.stateFlags.restricted).toBe(true);

    // No restricted row survives.
    expect(out.filteredEvidence).toHaveLength(1);
    const survivor = out.filteredEvidence[0];
    expect(survivor?.id).toBe("ev-ok-1");

    // Deep assert no restricted content leaked ANYWHERE in filteredEvidence.
    const serialized = JSON.stringify(out.filteredEvidence);
    expect(serialized).not.toContain("SECRET EMPLOYEE NOTE");
    expect(serialized).not.toContain("internal-hr");
    expect(serialized).not.toContain("ev-secret-1");
    expect(serialized).not.toContain(RESTRICTED_TS_ISO);

    // Warnings must not echo restricted content either.
    const warningsSerialized = JSON.stringify(out.warnings);
    expect(warningsSerialized).not.toContain("SECRET EMPLOYEE NOTE");
    expect(warningsSerialized).not.toContain("internal-hr");
    expect(warningsSerialized).not.toContain("ev-secret-1");
    expect(warningsSerialized).not.toContain(RESTRICTED_TS_ISO);
  });

  it("produces empty filteredEvidence when ALL input is restricted", () => {
    const input: Evidence[] = [
      ev({ id: "ev-r1", content: "restricted-a", isRestricted: true }),
      ev({ id: "ev-r2", content: "restricted-b", isRestricted: true }),
    ];
    const out = evaluator.applySuppression(input, BASE_THRESHOLDS, now);

    expect(out.filteredEvidence).toEqual([]);
    expect(out.stateFlags.restricted).toBe(true);
    expect(out.stateFlags.empty).toBe(true);

    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("restricted-a");
    expect(serialized).not.toContain("restricted-b");
    expect(serialized).not.toContain("ev-r1");
    expect(serialized).not.toContain("ev-r2");
  });

  it("does not set restricted flag when no restricted evidence exists", () => {
    const input = [ev({ id: "ev-ok", isRestricted: false })];
    const out = evaluator.applySuppression(input, BASE_THRESHOLDS, now);
    expect(out.stateFlags.restricted).toBe(false);
  });
});

describe("TrustEvaluator.applySuppression — stale / lowConfidence / degraded", () => {
  const evaluator = createTrustEvaluator();
  const now = new Date("2026-04-15T00:00:00Z");

  it("flags stale and keeps evidence with age warning", () => {
    const e = ev({
      id: "ev-stale",
      timestamp: new Date(now.getTime() - 120 * DAY_MS),
      confidence: 0.9,
      source: "news",
    });
    const out = evaluator.applySuppression([e], BASE_THRESHOLDS, now);
    expect(out.stateFlags.stale).toBe(true);
    expect(out.filteredEvidence).toHaveLength(1);
    expect(out.warnings.some((w) => w.includes("120"))).toBe(true);
  });

  it("flags lowConfidence and keeps evidence with score warning", () => {
    const e = ev({ id: "ev-low", confidence: 0.2, source: "news" });
    const out = evaluator.applySuppression([e], BASE_THRESHOLDS, now);
    expect(out.stateFlags.lowConfidence).toBe(true);
    expect(out.filteredEvidence).toHaveLength(1);
    expect(out.warnings.some((w) => w.includes("0.2"))).toBe(true);
  });

  it("flags degraded for invalid source and keeps evidence with reason warning", () => {
    const e = ev({ id: "ev-deg", source: "", confidence: 0.9 });
    const out = evaluator.applySuppression([e], BASE_THRESHOLDS, now);
    expect(out.stateFlags.degraded).toBe(true);
    expect(out.filteredEvidence).toHaveLength(1);
    expect(out.warnings.some((w) => w.toLowerCase().includes("source"))).toBe(true);
  });

  it("supports multiple flags firing simultaneously (stale + lowConfidence)", () => {
    const e = ev({
      id: "ev-multi",
      timestamp: new Date(now.getTime() - 200 * DAY_MS),
      confidence: 0.1,
      source: "news",
    });
    const out = evaluator.applySuppression([e], BASE_THRESHOLDS, now);
    expect(out.stateFlags.stale).toBe(true);
    expect(out.stateFlags.lowConfidence).toBe(true);
    expect(out.filteredEvidence).toHaveLength(1);
  });

  it("sets stateFlags.empty=true when filteredEvidence is empty after suppression", () => {
    const out = evaluator.applySuppression([], BASE_THRESHOLDS, now);
    expect(out.stateFlags.empty).toBe(true);
    expect(out.filteredEvidence).toEqual([]);
  });

  it("does NOT set empty when non-restricted evidence survives", () => {
    const e = ev({ id: "ev-ok", confidence: 0.9, source: "hubspot" });
    const out = evaluator.applySuppression([e], BASE_THRESHOLDS, now);
    expect(out.stateFlags.empty).toBe(false);
  });
});

describe("TrustEvaluator — tenant-specific thresholds produce different outcomes", () => {
  const evaluator = createTrustEvaluator();
  const now = new Date("2026-04-15T00:00:00Z");

  const LENIENT: ThresholdConfig = {
    freshnessMaxDays: 365,
    minConfidence: 0.1,
  };
  const STRICT: ThresholdConfig = { freshnessMaxDays: 7, minConfidence: 0.9 };

  const shared: Evidence = createEvidence("tenant-shared", {
    id: "ev-shared",
    source: "hubspot",
    confidence: 0.5,
    content: "Shared content",
    timestamp: new Date(now.getTime() - 45 * DAY_MS),
    isRestricted: false,
  });

  it("lenient tenant passes the same evidence cleanly", () => {
    const out = evaluator.applySuppression([shared], LENIENT, now);
    expect(out.stateFlags.stale).toBe(false);
    expect(out.stateFlags.lowConfidence).toBe(false);
  });

  it("strict tenant flags the same evidence as stale AND low-confidence", () => {
    const out = evaluator.applySuppression([shared], STRICT, now);
    expect(out.stateFlags.stale).toBe(true);
    expect(out.stateFlags.lowConfidence).toBe(true);
  });
});
