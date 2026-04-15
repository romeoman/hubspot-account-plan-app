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

export type AllowBlockLists = {
  allow?: string[];
  block?: string[];
};

export interface TrustEvaluator {
  evaluateFreshness(evidence: Evidence, thresholds: ThresholdConfig, now?: Date): FreshnessResult;
  evaluateConfidence(evidence: Evidence, thresholds: ThresholdConfig): ConfidenceResult;
  validateSource(evidence: Evidence): SourceValidationResult;
  /**
   * Apply per-provider allow/block lists to an Evidence[].
   *
   * - `block` runs first: any `evidence.source` ending with a blocked entry
   *   (subdomain match, e.g. `news.example.com` blocked by `example.com`) is
   *   dropped.
   * - `allow` runs second: if provided (and non-empty), only evidence whose
   *   source matches (via the same `endsWith` rule) is kept.
   * - Both empty / missing → no-op.
   * - Block ALWAYS wins over allow.
   *
   * Restricted-state short-circuit is the CALLER's responsibility. This
   * method operates purely on the array it's given.
   */
  applyAllowBlockLists(evidence: Evidence[], lists: AllowBlockLists): Evidence[];
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
/**
 * Coerce a timestamp into a Date. The `Evidence.timestamp` field is typed as
 * `Date`, but when evidence has been JSON-serialized (e.g., cached by a
 * caller, or re-parsed from an API response) it comes back as an ISO string.
 * Be permissive at the evaluator boundary so a single upstream slip cannot
 * crash the whole snapshot pipeline with `getTime is not a function`.
 */
function coerceTimestamp(v: Evidence["timestamp"] | string): Date {
  if (v instanceof Date) return v;
  const d = new Date(v as string);
  // If parse failed, treat as epoch so the row flows as "extremely stale"
  // rather than throwing mid-evaluation.
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

export function createTrustEvaluator(): TrustEvaluator {
  function evaluateFreshness(
    evidence: Evidence,
    thresholds: ThresholdConfig,
    now: Date = new Date(),
  ): FreshnessResult {
    const ts = coerceTimestamp(evidence.timestamp);
    const ageMs = now.getTime() - ts.getTime();
    // Future-dated evidence (ageMs < 0) is suspect — clamping to age=0 would
    // silently bless a tomorrow timestamp as "fresh" and inflate trust. Treat
    // it as not-fresh and report the absolute skew so callers see the issue.
    if (ageMs < 0) {
      return {
        isFresh: false,
        ageDays: Math.ceil(-ageMs / DAY_MS),
      };
    }
    const ageDays = Math.floor(ageMs / DAY_MS);
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

  function applyAllowBlockLists(evidence: Evidence[], lists: AllowBlockLists): Evidence[] {
    // Normalize once: trim + lowercase patterns and drop empties. Without trim
    // a stray whitespace in tenant config ("example.com " → stored verbatim
    // in jsonb) would silently fail to match anything and exclude all
    // evidence on an allow-list — a false-positive suppression.
    const normalize = (xs: readonly string[] | undefined): string[] =>
      xs
        ?.filter((s): s is string => typeof s === "string")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0) ?? [];
    const block = normalize(lists.block);
    const allow = normalize(lists.allow);
    if (block.length === 0 && allow.length === 0) return evidence;

    // Dot-prefix guard: `example.com` must match `news.example.com` but NOT
    // `malicious-example.com`. Exact match + `.`-boundary suffix is safe.
    const matches = (source: string, patterns: string[]): boolean => {
      const src = source.toLowerCase();
      return patterns.some((p) => src === p || src.endsWith(`.${p}`));
    };

    const out: Evidence[] = [];
    for (const ev of evidence) {
      const source = typeof ev.source === "string" ? ev.source : "";
      // Block always wins.
      if (block.length > 0 && matches(source, block)) continue;
      if (allow.length > 0 && !matches(source, allow)) continue;
      out.push(ev);
    }
    return out;
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
    applyAllowBlockLists,
    applySuppression,
  };
}
