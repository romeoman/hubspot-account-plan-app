import { Alert } from "@hubspot/ui-extensions";

/**
 * Warning-state banners surfaced above an eligible snapshot.
 *
 * Variant policy (HubSpot `Alert` accepts `info | warning | success | error
 * | danger | tip`):
 * - stale       → `warning` (time-based caution)
 * - degraded    → `danger`  (source failure / partial data)
 * - lowConf     → `warning` (trust score below threshold)
 *
 * Each warning is independent and may stack with the others.
 */

export function StaleWarning({ ageDays }: { ageDays: number }) {
  return (
    <Alert title="Stale evidence" variant="warning">
      Evidence is {ageDays} days old and may no longer be current.
    </Alert>
  );
}

export function DegradedWarning({ reason }: { reason: string }) {
  return (
    <Alert title="Degraded source" variant="danger">
      {reason}
    </Alert>
  );
}

export function LowConfidenceWarning({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  return (
    <Alert title="Low confidence" variant="warning">
      Trust score is {pct}% — treat the reason-to-contact with caution.
    </Alert>
  );
}
