/**
 * Staleness sweeper.
 *
 * Splits Evidence into `fresh` + `stale` buckets based on the tenant's
 * configured `freshnessMaxDays`. Returning BOTH buckets lets the trust
 * evaluator set `stateFlags.stale` when stale evidence was present,
 * even if it's the only hygiene stage that saw it.
 *
 * ## Boundary semantics
 *
 * `ageDays === freshnessMaxDays` is FRESH. This matches
 * {@link TrustEvaluator.evaluateFreshness} ("treats age exactly at threshold
 * as fresh"). Callers relying on both stages get consistent boundary
 * behaviour.
 *
 * ## Clock injection
 *
 * The default clock is `() => new Date()`. Tests inject a deterministic
 * clock to pin "now" across boundary cases.
 *
 * ## Known limitation (Slice 2)
 *
 * The Exa adapter defaults missing `publishedDate` values to `new Date()`
 * before they reach this stage, so a result without a real publish date
 * will look fresh. Slice 3 adds explicit "publish date missing" handling so
 * those rows can be flagged degraded rather than trusted as current.
 */

import type { Evidence, ThresholdConfig } from "@hap/config";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse an Evidence timestamp, tolerating ISO strings from JSON round-trips. */
function coerceTimestamp(v: Evidence["timestamp"] | string): Date {
  if (v instanceof Date) return v;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

export type StalenessSweepResult = {
  fresh: Evidence[];
  stale: Evidence[];
};

/**
 * Split `evidence` into `fresh` + `stale` buckets.
 *
 * - `ageDays <= thresholds.freshnessMaxDays` → fresh
 * - `ageDays > thresholds.freshnessMaxDays`  → stale
 * - future-dated timestamps (`ageDays < 0`) are treated as stale, mirroring
 *   the trust evaluator's suspicion of forward skew.
 */
export function sweepStaleness(
  evidence: Evidence[],
  thresholds: ThresholdConfig,
  now: () => Date = () => new Date(),
): StalenessSweepResult {
  if (evidence.length === 0) return { fresh: [], stale: [] };

  const currentMs = now().getTime();
  const fresh: Evidence[] = [];
  const stale: Evidence[] = [];

  for (const ev of evidence) {
    const ts = coerceTimestamp(ev.timestamp).getTime();
    const ageMs = currentMs - ts;
    if (ageMs < 0) {
      // Future-dated: suspect; treat as stale so it never silently boosts trust.
      stale.push(ev);
      continue;
    }
    const ageDays = Math.floor(ageMs / DAY_MS);
    if (ageDays <= thresholds.freshnessMaxDays) {
      fresh.push(ev);
    } else {
      stale.push(ev);
    }
  }

  return { fresh, stale };
}
