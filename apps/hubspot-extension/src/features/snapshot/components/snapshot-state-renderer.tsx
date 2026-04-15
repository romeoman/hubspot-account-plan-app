import type { Snapshot } from "@hap/config";
import { Flex } from "@hubspot/ui-extensions";
import { EligibleView } from "./eligible-view";
import { EmptyState, IneligibleState, RestrictedState, UnconfiguredState } from "./empty-states";
import { DegradedWarning, LowConfidenceWarning, StaleWarning } from "./warning-states";

/**
 * Central render-switch for a `Snapshot`.
 *
 * Precedence rules (first match wins):
 *   1. `eligibilityState === 'unconfigured'` → UnconfiguredState
 *   2. `eligibilityState === 'ineligible'` OR `stateFlags.ineligible`
 *      → IneligibleState
 *   3. `stateFlags.restricted` → RestrictedState (no evidence/people/reason
 *      accessed — zero-leak invariant)
 *   4. `stateFlags.empty` → EmptyState
 *   5. Otherwise → `EligibleView` with stacked warning banners for
 *      `stale` / `degraded` / `lowConfidence`
 *
 * The restricted branch intentionally does not read `snapshot.evidence`,
 * `snapshot.people`, or `snapshot.reasonToContact` — if we don't read
 * those fields, we can't leak them. The backend already strips them, but
 * we treat this UI layer as an independent gate.
 */
export default function SnapshotStateRenderer({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.eligibilityState === "unconfigured") {
    return <UnconfiguredState />;
  }

  if (snapshot.eligibilityState === "ineligible" || snapshot.stateFlags.ineligible) {
    return <IneligibleState />;
  }

  if (snapshot.stateFlags.restricted) {
    return <RestrictedState />;
  }

  if (snapshot.stateFlags.empty) {
    return <EmptyState />;
  }

  const { stateFlags } = snapshot;

  // Compute the stale age from the snapshot's newest evidence timestamp.
  // If no evidence is present, fall back to 0 (the warning still renders
  // because the `stale` flag is true, but it shows "0 days"; real snapshots
  // are never stale+empty per the fixture contract).
  const ageDays = stateFlags.stale ? staleAgeDays(snapshot) : 0;

  return (
    <Flex direction="column" gap="md">
      {stateFlags.stale ? <StaleWarning ageDays={ageDays} /> : null}
      {stateFlags.degraded ? <DegradedWarning reason={degradedReason(snapshot)} /> : null}
      {stateFlags.lowConfidence ? <LowConfidenceWarning score={snapshot.trustScore ?? 0} /> : null}
      <EligibleView snapshot={snapshot} />
    </Flex>
  );
}

/** Oldest timestamp in `evidence` → day-count relative to `now`. */
function staleAgeDays(snapshot: Snapshot): number {
  if (snapshot.evidence.length === 0) return 0;
  const oldest = snapshot.evidence.reduce((acc, ev) => (ev.timestamp < acc.timestamp ? ev : acc));
  const ms = Date.now() - oldest.timestamp.getTime();
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

/**
 * Extracts a human-readable degraded reason from the first evidence row,
 * or falls back to a generic message. V1 keeps this simple; later slices
 * can surface adapter-specific reasons.
 */
function degradedReason(snapshot: Snapshot): string {
  const first = snapshot.evidence[0];
  if (first && first.content.length > 0) return first.content;
  return "One or more sources returned partial data.";
}

export { SnapshotStateRenderer };
