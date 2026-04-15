/**
 * People selection service.
 *
 * Responsibilities:
 *  1. {@link fetchContacts}: call an injected {@link ContactFetcher}. Never
 *     throws — transport errors collapse to `[]` so the caller renders the
 *     empty state instead of bluffing.
 *  2. {@link rankContacts}: score contacts by signal relevance + recency.
 *  3. {@link selectPeople}: pick top-N (0..3) and build `Person` rows whose
 *     `reasonToTalk` is grounded in the dominant signal.
 *
 * V1 rules:
 *  - NEVER fabricate. Empty input → empty output. Always.
 *  - No signal? `reasonToTalk` must not invent one.
 *  - Score floor is 0; callers may tighten via a higher floor if needed.
 */

import type { Evidence, Person } from "@hap/config";

export type RawContact = {
  id: string;
  name: string;
  title?: string;
  lastActivityAt?: Date;
};

export type ContactFetcher = (tenantId: string, companyId: string) => Promise<RawContact[]>;

export type RankedContact = RawContact & { score: number };

const RECENCY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

/** Keywords that commonly appear in decision-maker / champion titles. */
const TITLE_DECISION_TERMS = [
  "chief",
  "ceo",
  "cto",
  "cfo",
  "coo",
  "cmo",
  "cro",
  "vp",
  "vice president",
  "head",
  "director",
  "founder",
  "president",
  "owner",
];

/**
 * Fetch raw contacts. Transport errors never bubble; return `[]` on failure so
 * the caller sees the empty state and we never fabricate filler.
 */
export async function fetchContacts(
  deps: { fetcher: ContactFetcher },
  args: { tenantId: string; companyId: string },
): Promise<RawContact[]> {
  try {
    return await deps.fetcher(args.tenantId, args.companyId);
  } catch (err) {
    // Empty-state preferred over bluffing, but the failure itself must be
    // visible in logs. No contact content is echoed — only tenant + company
    // + error message so the silent `[]` path is diagnosable.
    console.warn("people_selector.contact_fetcher_failed", {
      tenantId: args.tenantId,
      companyId: args.companyId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** Extract lowercase word tokens of length >= 3 from a string. */
function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

/**
 * Score a single contact against the dominant signal + recency.
 *
 * - Title decision-maker terms: +3 each
 * - Title token overlap with signal content: +2 each
 * - Name token overlap with signal content: +1 each
 * - Recency: +2 if active within the recency window, scaled by freshness
 *
 * When `signal` is null we only apply the recency boost.
 */
function scoreContact(contact: RawContact, signal: Evidence | null): number {
  let score = 0;

  const title = contact.title?.toLowerCase() ?? "";
  if (title) {
    for (const term of TITLE_DECISION_TERMS) {
      if (title.includes(term)) score += 3;
    }
  }

  if (signal) {
    const sigTokens = new Set(tokens(signal.content));
    if (title) {
      const titleTokens = tokens(title);
      for (const t of titleTokens) {
        if (sigTokens.has(t)) score += 2;
      }
    }
    const nameTokens = tokens(contact.name);
    for (const t of nameTokens) {
      if (sigTokens.has(t)) score += 1;
    }
  }

  if (contact.lastActivityAt) {
    const ageMs = Date.now() - contact.lastActivityAt.getTime();
    if (ageMs <= RECENCY_WINDOW_MS) {
      const ratio = 1 - ageMs / RECENCY_WINDOW_MS;
      score += 2 * ratio;
    }
  }

  return score;
}

/**
 * Rank contacts by relevance to the dominant signal (or recency-only when
 * no signal). Stable within equal scores via insertion order.
 */
export function rankContacts(
  contacts: RawContact[],
  dominantSignal: Evidence | null,
): RankedContact[] {
  const scored: RankedContact[] = contacts.map((c) => ({
    ...c,
    score: scoreContact(c, dominantSignal),
  }));
  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Build a grounded `reasonToTalk` for a contact. Always references the signal
 * content when present; never invents content when signal is null.
 */
function buildReasonToTalk(contact: RankedContact, signal: Evidence | null): string {
  if (!signal) {
    // With no signal we have nothing grounded to say about this contact.
    // Keep it neutral and honest — callers should generally not be surfacing
    // people at all in this branch, but if they do we do not fabricate.
    return contact.title
      ? `${contact.title} at this account — no specific signal available.`
      : "No specific signal available for this contact.";
  }
  const roleFragment = contact.title ? `${contact.title}` : "Contact";
  return `${roleFragment} — ${signal.content}`;
}

/**
 * Select up to `maxCount` (default 3) people from a ranked list. NEVER
 * fabricates: empty in → empty out. Floor of 0 by default; tighten via
 * `scoreFloor` if needed.
 */
export function selectPeople(
  ranked: RankedContact[],
  dominantSignal: Evidence | null,
  maxCount = 3,
  scoreFloor = 0,
): Person[] {
  if (maxCount <= 0) return [];
  const qualifying = ranked.filter((r) => r.score >= scoreFloor);
  return qualifying.slice(0, maxCount).map<Person>((c) => ({
    id: c.id,
    name: c.name,
    title: c.title,
    reasonToTalk: buildReasonToTalk(c, dominantSignal),
    evidenceRefs: dominantSignal ? [dominantSignal.id] : [],
  }));
}
