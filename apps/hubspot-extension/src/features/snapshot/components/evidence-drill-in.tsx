import type { Evidence } from "@hap/config";
import {
  DescriptionList,
  DescriptionListItem,
  Flex,
  Modal,
  ModalBody,
  Text,
} from "@hubspot/ui-extensions";

/**
 * Per-evidence drill-in panel. Replaces the Slice 1 `EvidenceModal` at the
 * call sites in `eligible-view`. Shows four sections:
 *
 * 1. **Provenance** — source domain + provider prefix recovered from
 *    `evidence.id` (our adapters encode `"<provider>:<url>"`, e.g.
 *    `"exa:https://techcrunch.com/..."`).
 * 2. **Freshness** — human-readable age (hours / days / weeks / months) plus
 *    the absolute ISO timestamp.
 * 3. **Trust breakdown** — confidence score as a percentage.
 * 4. **Raw payload preview** — the evidence `content` string.
 *
 * ### Zero-leak invariant
 *
 * Renders **NOTHING** (returns `null`) when either:
 * - the top-level snapshot is restricted (`isRestricted` prop is `true`), or
 * - the evidence row itself is flagged restricted (`evidence.isRestricted`).
 *
 * This is the last UI-layer gate before any Evidence string is displayed. The
 * `evidence-drill-in.test.tsx` suite asserts this explicitly with string-search
 * assertions against the full rendered subtree — a regression that let
 * restricted content through would fail those tests.
 *
 * ### Accessibility
 *
 * The HubSpot `Modal` component dismisses on Escape natively and routes that
 * dismissal through `onClose`. Test helper `triggerEscape` in `test-utils.ts`
 * exercises exactly that contract.
 */
export type EvidenceDrillInProps = {
  evidence: Evidence;
  /**
   * Top-level restricted signal, typically `snapshot.stateFlags.restricted`.
   * Either this OR `evidence.isRestricted === true` suppresses the entire
   * render — no Modal is mounted, no Evidence fields are read.
   */
  isRestricted: boolean;
  onClose: () => void;
};

/**
 * Parse the `"<provider>:<url>"` convention the Slice 2 adapters use for
 * evidence IDs. Falls back to `{ provider: "unknown", url: null }` for any
 * id that doesn't match.
 */
function parseEvidenceId(id: string): { provider: string; url: string | null } {
  const colonIdx = id.indexOf(":");
  if (colonIdx === -1) return { provider: "unknown", url: null };
  const provider = id.slice(0, colonIdx);
  const rest = id.slice(colonIdx + 1);
  const url = rest.startsWith("http://") || rest.startsWith("https://") ? rest : null;
  return { provider, url };
}

/**
 * Human-readable age that picks the coarsest useful unit:
 *   < 1h           → "just now"
 *   1h .. <24h     → "N hour(s) ago"
 *   1d .. <7d      → "N day(s) ago"
 *   7d .. <30d     → "N week(s) ago"
 *   30d .. <365d   → "N month(s) ago"
 *   >= 365d        → "N year(s) ago"
 *
 * Sub-day boundaries matter for the freshness story: a 1-hour-old signal
 * should not render "0 days ago" — we explicitly switch to the hour unit.
 */
function humanAge(from: Date, now: Date = new Date()): string {
  const ms = now.getTime() - from.getTime();
  if (ms < 60 * 60 * 1000) return "just now";
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} ${months === 1 ? "month" : "months"} ago`;
  }
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

function formatConfidence(c: number): string {
  return `${Math.round(c * 100)}%`;
}

function formatTimestamp(ts: Date): string {
  return ts.toISOString().slice(0, 10);
}

export function EvidenceDrillIn({ evidence, isRestricted, onClose }: EvidenceDrillInProps) {
  // Zero-leak invariant: either gate trips → render nothing.
  if (isRestricted || evidence.isRestricted) return null;

  const { provider, url } = parseEvidenceId(evidence.id);
  const age = humanAge(evidence.timestamp);
  const confidencePct = formatConfidence(evidence.confidence);
  const absoluteTs = formatTimestamp(evidence.timestamp);

  return (
    <Modal
      id="evidence-drill-in"
      title="Evidence detail"
      onClose={onClose}
      aria-label="Evidence drill-in"
    >
      <ModalBody>
        <Flex direction="column" gap="md">
          <DescriptionList direction="column">
            <DescriptionListItem label="Source">
              <Text>{evidence.source}</Text>
            </DescriptionListItem>
            <DescriptionListItem label="Provider">
              <Text>{provider}</Text>
            </DescriptionListItem>
            {url ? (
              <DescriptionListItem label="URL">
                <Text>{url}</Text>
              </DescriptionListItem>
            ) : null}
            <DescriptionListItem label="Freshness">
              <Text>
                {age} ({absoluteTs})
              </Text>
            </DescriptionListItem>
            <DescriptionListItem label="Confidence">
              <Text>{confidencePct}</Text>
            </DescriptionListItem>
            <DescriptionListItem label="Raw payload">
              <Text>{evidence.content}</Text>
            </DescriptionListItem>
          </DescriptionList>
        </Flex>
      </ModalBody>
    </Modal>
  );
}
