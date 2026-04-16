import { Text } from "@hubspot/ui-extensions";

/**
 * Empty-state render components for the HubSpot account workspace.
 *
 * Each renders a single, distinct, accessible `Text` message — intentionally
 * plain because the point is to suppress any bluffing UI when we have nothing
 * credible to say.
 */

/** No credible reason to contact this account right now. */
export function EmptyState() {
  return <Text>No credible reason to contact at this time.</Text>;
}

/** Account does not qualify (e.g. `hs_is_target_account` is false). */
export function IneligibleState() {
  return <Text>This account is not eligible for outreach.</Text>;
}

/** Tenant has not finished provider/threshold setup. */
export function UnconfiguredState() {
  return (
    <Text>
      This workspace is not configured yet. In HubSpot, open Connected apps, choose this app, then
      use the Settings tab to finish setup.
    </Text>
  );
}

/**
 * Restricted evidence must NEVER be shown or summarized. We render a
 * deliberately-generic placeholder that reveals nothing about what exists
 * beneath it — no counts, no sources, no timestamps, no trust scores.
 *
 * Upstream callers MUST NOT pass restricted evidence into any other view.
 */
export function RestrictedState() {
  return <Text>No data available for this account.</Text>;
}
