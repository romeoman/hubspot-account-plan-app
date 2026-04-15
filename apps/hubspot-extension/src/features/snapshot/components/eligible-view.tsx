import type { Snapshot } from "@hap/config";
import { Button, Flex, Heading, Text } from "@hubspot/ui-extensions";
import { useCallback, useMemo, useState } from "react";
import { EvidenceModal } from "./evidence-modal";

/**
 * Renders an eligible snapshot: reason-to-contact heading + 0..3 clickable
 * people. Clicking a person opens the `EvidenceModal` filtered to the
 * evidence rows referenced by that person's `evidenceRefs`.
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
  const openEvidence = openPerson
    ? openPerson.evidenceRefs
        .map((id) => evidenceById.get(id))
        .filter((ev): ev is (typeof snapshot.evidence)[number] => ev !== undefined)
    : [];

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

      <EvidenceModal evidence={openEvidence} open={openPerson !== null} onClose={handleClose} />
    </Flex>
  );
}
