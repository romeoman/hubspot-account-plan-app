import type { Evidence } from "@hap/config";
import { Flex, Modal, ModalBody, Text } from "@hubspot/ui-extensions";

/**
 * @deprecated Slice 1 legacy. Superseded by `./evidence-drill-in.tsx`
 *   which exposes provenance, freshness, trust breakdown, and a redacted
 *   raw payload section. Retained here so the Slice 1 test suite keeps
 *   green; Slice 3 cleanup deletes this module once nothing imports it.
 *
 * Modal that lists evidence rows supporting a person's reason-to-talk.
 *
 * Accessibility: the HubSpot `Modal` component dismisses on Escape natively
 * and routes that dismissal through `onClose`. We pass `onClose` straight
 * through so the caller can unmount the modal.
 *
 * When `open` is false we render nothing — the consumer controls lifecycle
 * and does not need to hide the modal in the tree. This matches how the
 * `EligibleView` toggles the modal open on a person click.
 */
export type EvidenceModalProps = {
  evidence: Evidence[];
  open: boolean;
  onClose: () => void;
};

function formatTimestamp(ts: Date): string {
  // ISO date portion — sufficient for V1 QA and avoids timezone surprises.
  return ts.toISOString().slice(0, 10);
}

function formatConfidence(c: number): string {
  return `${Math.round(c * 100)}%`;
}

export function EvidenceModal({ evidence, open, onClose }: EvidenceModalProps) {
  if (!open) return null;

  // Last leak boundary: even if a caller slips a restricted row into the
  // `evidence` prop, the modal must not render its source / content / id.
  // Stripping here means a future regression (or test misuse) cannot leak
  // restricted material to the user.
  const visible = evidence.filter((ev) => ev.isRestricted === false);

  return (
    <Modal id="evidence-modal" title="Evidence" onClose={onClose} aria-label="Evidence details">
      <ModalBody>
        {visible.length === 0 ? (
          <Text>No evidence to display.</Text>
        ) : (
          <Flex direction="column" gap="sm">
            {visible.map((ev) => (
              <Flex key={ev.id} direction="column" gap="xs">
                <Text format={{ fontWeight: "bold" }}>{ev.source}</Text>
                <Text variant="microcopy">
                  {formatTimestamp(ev.timestamp)} · {formatConfidence(ev.confidence)}
                </Text>
                <Text>{ev.content}</Text>
              </Flex>
            ))}
          </Flex>
        )}
      </ModalBody>
    </Modal>
  );
}
