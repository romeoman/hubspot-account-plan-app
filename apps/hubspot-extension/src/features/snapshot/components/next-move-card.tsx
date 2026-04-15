import type { Snapshot } from "@hap/config";
import { Text, Tile } from "@hubspot/ui-extensions";

/**
 * Displays `snapshot.nextMove` inline on the eligible branch as a
 * "Suggested next move" tile (Slice 2 Step 13).
 *
 * Belt-and-braces guards: even though `SnapshotStateRenderer` routes
 * restricted / ineligible / unconfigured / empty snapshots away from
 * `EligibleView` (and therefore away from this component), we still gate
 * each of those conditions locally. A defense-in-depth second gate costs
 * one boolean check and guarantees the card cannot render under any
 * suppression state even if an upstream regression slips one through.
 */
export function NextMoveCard({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.stateFlags.restricted) return null;
  if (snapshot.stateFlags.ineligible) return null;
  if (snapshot.eligibilityState === "ineligible") return null;
  if (snapshot.stateFlags.empty) return null;

  const raw = snapshot.nextMove;
  if (typeof raw !== "string") return null;
  // Render the trimmed value so the gate decision and what users see
  // agree (CodeRabbit minor on next-move-card.tsx:27).
  const move = raw.trim();
  if (move.length === 0) return null;

  return (
    <Tile>
      <Text format={{ fontWeight: "bold" }}>Suggested next move</Text>
      <Text>{move}</Text>
    </Tile>
  );
}
