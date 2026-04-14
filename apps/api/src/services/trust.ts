/**
 * Trust + suppression service.
 *
 * Central policy for evaluating individual Evidence rows against a
 * tenant-configured {@link ThresholdConfig} and for applying suppression over
 * a batch of Evidence to produce the StateFlags that downstream assembly and
 * rendering depend on.
 *
 * ## Suppression contract (V1)
 *
 * - `isRestricted: true` evidence is the highest-stakes case. It is REMOVED
 *   COMPLETELY from `filteredEvidence`. No id, source, content, timestamp,
 *   or count derived from restricted rows is propagated to the caller —
 *   warnings never echo restricted values either. The only signal that
 *   restricted data existed is `stateFlags.restricted = true`. Downstream
 *   callers (assembler, route, UI) are contractually forbidden from
 *   rendering any count or summary of restricted evidence.
 *
 * - Stale evidence (age > `freshnessMaxDays`) is KEPT. `stateFlags.stale`
 *   is set, and a warning including `ageDays` is emitted.
 *
 * - Low-confidence evidence (confidence < `minConfidence`) is KEPT.
 *   `stateFlags.lowConfidence` is set, and a warning including the numeric
 *   score is emitted.
 *
 * - Degraded-source evidence (invalid / empty source, or any source that
 *   fails {@link validateSource}) is KEPT. `stateFlags.degraded` is set,
 *   and a warning including the degradation reason is emitted.
 *
 * - Multiple flags may fire for the same Evidence (stale AND low-confidence
 *   AND degraded are all independent).
 *
 * - `stateFlags.empty` is true iff `filteredEvidence` is empty after all
 *   suppression has run. This is the signal the assembler uses to render the
 *   empty state.
 *
 * ## Why source validation is simple in V1
 *
 * Slice 1 only ships a mock adapter. `validateSource` uses a permissive
 * alphanumeric + `.-_` regex and rejects empty / whitespace strings. Real
 * provider-specific source allow-lists + blocklists land in Slice 2 when
 * Exa / HubSpot / news adapters become config-driven.
 *
 * ## Honesty
 *
 * When the evaluator cannot classify a row (e.g. source missing), it errs
 * toward DEGRADED rather than silently passing. This matches the project
 * rule: prefer explicit empty/suppressed state over bluffing.
 */

import type { Evidence, StateFlags, ThresholdConfig } from "@hap/config";
import { createStateFlags } from "@hap/config";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Source strings must be non-empty and match this pattern to be considered valid. */
const VALID_SOURCE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type FreshnessResult = {
  isFresh: boolean;
  /** Integer days between `now` and `evidence.timestamp`, floored. */
  ageDays: number;
};

export type ConfidenceResult = {
  isAdequate: boolean;
  score: number;
};

export type SourceValidationResult = {
  isValid: boolean;
  degradationReason?: string;
};

export type SuppressionResult = {
  filteredEvidence: Evidence[];
  stateFlags: StateFlags;
  warnings: string[];
};

export interface TrustEvaluator {
  evaluateFreshness(evidence: Evidence, thresholds: ThresholdConfig, now?: Date): FreshnessResult;
  evaluateConfidence(evidence: Evidence, thresholds: ThresholdConfig): ConfidenceResult;
  validateSource(evidence: Evidence): SourceValidationResult;
  applySuppression(
    evidence: Evidence[],
    thresholds: ThresholdConfig,
    now?: Date,
  ): SuppressionResult;
}

/**
 * Create a {@link TrustEvaluator}.
 *
 * The evaluator is pure — no I/O, no logging. Callers inject thresholds
 * per-tenant so one instance can safely service many tenants.
 */
export function createTrustEvaluator(): TrustEvaluator {
  function evaluateFreshness(
    evidence: Evidence,
    thresholds: ThresholdConfig,
    now: Date = new Date(),
  ): FreshnessResult {
    const ageMs = now.getTime() - evidence.timestamp.getTime();
    const ageDays = Math.max(0, Math.floor(ageMs / DAY_MS));
    return {
      isFresh: ageDays <= thresholds.freshnessMaxDays,
      ageDays,
    };
  }

  function evaluateConfidence(evidence: Evidence, thresholds: ThresholdConfig): ConfidenceResult {
    return {
      isAdequate: evidence.confidence >= thresholds.minConfidence,
      score: evidence.confidence,
    };
  }

  function validateSource(evidence: Evidence): SourceValidationResult {
    const raw = evidence.source;
    if (typeof raw !== "string" || raw.trim().length === 0) {
      return { isValid: false, degradationReason: "empty source" };
    }
    if (!VALID_SOURCE_RE.test(raw)) {
      return { isValid: false, degradationReason: "invalid source format" };
    }
    return { isValid: true };
  }

  function applySuppression(
    evidence: Evidence[],
    thresholds: ThresholdConfig,
    now: Date = new Date(),
  ): SuppressionResult {
    const flags = createStateFlags();
    const warnings: string[] = [];

    // 1. Detect + strip restricted rows. No metadata derived from restricted
    //    evidence may reach `filteredEvidence` or `warnings`.
    let sawRestricted = false;
    const nonRestricted: Evidence[] = [];
    for (const ev of evidence) {
      if (ev.isRestricted === true) {
        sawRestricted = true;
        continue;
      }
      nonRestricted.push(ev);
    }
    if (sawRestricted) {
      flags.restricted = true;
      // Intentionally NO warning text — any warning could leak that a
      // restricted row existed with specific provenance. The single bit
      // `stateFlags.restricted` is the only allowed signal.
    }

    // 2. Classify each surviving row. All non-restricted rows are KEPT; only
    //    the flags + warnings change.
    for (const ev of nonRestricted) {
      const freshness = evaluateFreshness(ev, thresholds, now);
      if (!freshness.isFresh) {
        flags.stale = true;
        warnings.push(`stale evidence: ageDays=${freshness.ageDays}`);
      }
      const confidence = evaluateConfidence(ev, thresholds);
      if (!confidence.isAdequate) {
        flags.lowConfidence = true;
        warnings.push(`low confidence: score=${confidence.score}`);
      }
      const source = validateSource(ev);
      if (!source.isValid) {
        flags.degraded = true;
        warnings.push(`degraded source: ${source.degradationReason ?? "unknown"}`);
      }
    }

    // 3. Empty flag reflects the FILTERED set, not the input.
    if (nonRestricted.length === 0) {
      flags.empty = true;
    }

    return {
      filteredEvidence: nonRestricted,
      stateFlags: flags,
      warnings,
    };
  }

  return {
    evaluateFreshness,
    evaluateConfidence,
    validateSource,
    applySuppression,
  };
}
