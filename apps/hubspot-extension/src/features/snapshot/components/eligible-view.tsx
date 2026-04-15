import type { Snapshot } from "@hap/config";
import { Button, Flex, Heading, Text } from "@hubspot/ui-extensions";
import { useCallback, useMemo, useState } from "react";
import { EvidenceDrillIn } from "./evidence-drill-in";
import { NextMoveCard } from "./next-move-card";

/**
 * Renders an eligible snapshot: reason-to-contact heading + 0..3 clickable
 * people. Clicking a person opens the Slice 2 `EvidenceDrillIn` panel,
 * scoped to the first non-restricted evidence row referenced by that
 * person's `evidenceRefs`.
 *
 * Hard invariant: we render `snapshot.people.length` items, never more —
 * no filler / placeholder contacts.
 */
export function EligibleView({ snapshot }: { snapshot: Snapshot }) {
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);

  const evidenceById = useMemo(() => {
    const map = new Map<string, (typeof snapshot.evidence)[number]>();
    for (const ev of snapshot.evidence) {
      map.set(ev.id, ev);
    }
    return map;
  }, [snapshot.evidence]);

  const openPerson = openPersonId
    ? (snapshot.people.find((p) => p.id === openPersonId) ?? null)
    : null;
  // Defense in depth: backend assembler already strips restricted rows in the
  // restricted-state branch, but `EligibleView` runs only on non-restricted
  // snapshots where individual `isRestricted: true` rows must STILL be
  // suppressed. Filter both undefined refs AND restricted rows here so the
  // drill-in never sees them, even if a future code path slips one through.
  const visibleEvidence = openPerson
    ? openPerson.evidenceRefs
        .map((id) => evidenceById.get(id))
        .filter(
          (ev): ev is (typeof snapshot.evidence)[number] =>
            ev !== undefined && ev.isRestricted === false,
        )
    : [];

  // Slice 2 drill-in is per-evidence, not per-list. Pick the first visible
  // row; if none exist, the drill-in is not mounted at all.
  const openEvidence = visibleEvidence[0] ?? null;

  const handleClose = useCallback(() => setOpenPersonId(null), []);

  return (
    <Flex direction="column" gap="md">
      {snapshot.reasonToContact ? <Heading>{snapshot.reasonToContact}</Heading> : null}

      <Flex direction="column" gap="sm">
        {snapshot.people.map((person) => (
          <Button key={person.id} variant="secondary" onClick={() => setOpenPersonId(person.id)}>
            {person.name}
            {person.title ? ` — ${person.title}` : ""}: {person.reasonToTalk}
          </Button>
        ))}
      </Flex>

      {snapshot.people.length === 0 ? (
        <Text variant="microcopy">No contacts available for this reason.</Text>
      ) : null}

      <NextMoveCard snapshot={snapshot} />

      {openEvidence !== null ? (
        <EvidenceDrillIn
          evidence={openEvidence}
          isRestricted={snapshot.stateFlags.restricted}
          onClose={handleClose}
        />
      ) : null}
    </Flex>
  );
}
