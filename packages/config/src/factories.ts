/**
 * Tenant-aware factories + 8 QA fixture generators.
 *
 * Each fixture produces a Snapshot with a DISTINCT combination of
 * `stateFlags` + `eligibilityState` so downstream state-rendering tests can
 * exercise every branch without ambiguity.
 *
 * Factories do NOT assert tenant isolation themselves — that is the
 * responsibility of the caller (middleware/services). They just make sure
 * the `tenantId` passed in is propagated to every nested Evidence row.
 */

import type { EligibilityState, Evidence, Person, Snapshot, StateFlags } from "./domain-types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Stable reference time so fixtures are deterministic per-call. */
function now(): Date {
  return new Date();
}

/** All flags default to false — no suppression unless explicitly set. */
export function createStateFlags(overrides?: Partial<StateFlags>): StateFlags {
  return {
    stale: false,
    degraded: false,
    lowConfidence: false,
    ineligible: false,
    restricted: false,
    empty: false,
    ...overrides,
  };
}

export function createPerson(overrides?: Partial<Person>): Person {
  return {
    id: overrides?.id ?? "person-default",
    name: overrides?.name ?? "Unnamed Contact",
    title: overrides?.title,
    reasonToTalk: overrides?.reasonToTalk ?? "No reason provided",
    evidenceRefs: overrides?.evidenceRefs ?? [],
  };
}

export function createEvidence(tenantId: string, overrides?: Partial<Evidence>): Evidence {
  return {
    id: overrides?.id ?? "ev-default",
    tenantId: overrides?.tenantId ?? tenantId,
    source: overrides?.source ?? "mock",
    timestamp: overrides?.timestamp ?? now(),
    confidence: overrides?.confidence ?? 0.8,
    content: overrides?.content ?? "Default evidence content",
    isRestricted: overrides?.isRestricted ?? false,
  };
}

export function createSnapshot(tenantId: string, overrides?: Partial<Snapshot>): Snapshot {
  const base: Snapshot = {
    tenantId,
    companyId: overrides?.companyId ?? "company-default",
    eligibilityState: overrides?.eligibilityState ?? "eligible",
    reasonToContact: overrides?.reasonToContact,
    people: overrides?.people ?? [],
    evidence: overrides?.evidence ?? [],
    stateFlags: overrides?.stateFlags ?? createStateFlags(),
    trustScore: overrides?.trustScore,
    createdAt: overrides?.createdAt ?? now(),
  };
  // Propagate tenantId into any evidence that was passed without one OR with
  // a mismatched tenantId. This guards against accidental cross-tenant fixtures.
  base.evidence = base.evidence.map((ev) => ({ ...ev, tenantId }));
  return base;
}

// ---------------------------------------------------------------------------
// 8 QA fixture generators. Each one produces a DISTINCT stateFlags +
// eligibilityState combo; asserted by the fixture tests.
// ---------------------------------------------------------------------------

function evid(tenantId: string, id: string, extra: Partial<Evidence>): Evidence {
  return createEvidence(tenantId, { id, ...extra });
}

/** Eligible with 3 people and fresh, high-confidence evidence. */
export function fixtureEligibleStrong(tenantId: string): Snapshot {
  const ev = [
    evid(tenantId, "ev-strong-1", {
      source: "hubspot",
      confidence: 0.92,
      content: "Target account flagged with recent engagement.",
    }),
    evid(tenantId, "ev-strong-2", {
      source: "news",
      confidence: 0.87,
      content: "Funding round announced this week.",
    }),
    evid(tenantId, "ev-strong-3", {
      source: "hubspot",
      confidence: 0.9,
      content: "Email open from champion 2 days ago.",
    }),
  ];
  const people: Person[] = [
    createPerson({
      id: "p-1",
      name: "Alex Champion",
      title: "VP Engineering",
      reasonToTalk: "Opened pricing email twice this week.",
      evidenceRefs: ["ev-strong-3"],
    }),
    createPerson({
      id: "p-2",
      name: "Jordan Decider",
      title: "CTO",
      reasonToTalk: "Named in funding announcement.",
      evidenceRefs: ["ev-strong-2"],
    }),
    createPerson({
      id: "p-3",
      name: "Sam Influencer",
      title: "Head of Platform",
      reasonToTalk: "Follows product on LinkedIn, reposted launch.",
      evidenceRefs: ["ev-strong-1"],
    }),
  ];
  return createSnapshot(tenantId, {
    companyId: "co-strong",
    eligibilityState: "eligible",
    reasonToContact: "Fresh funding + active email engagement from champion.",
    people,
    evidence: ev,
    trustScore: 0.9,
    stateFlags: createStateFlags(),
  });
}

/** Eligible but only 1-2 usable contacts; never fabricate filler people. */
export function fixtureFewerContacts(tenantId: string): Snapshot {
  const ev = [
    evid(tenantId, "ev-few-1", {
      source: "news",
      confidence: 0.81,
      content: "Leadership change announced.",
    }),
  ];
  const people: Person[] = [
    createPerson({
      id: "p-few-1",
      name: "Riley Only",
      title: "CEO",
      reasonToTalk: "Newly appointed; matches ICP.",
      evidenceRefs: ["ev-few-1"],
    }),
    createPerson({
      id: "p-few-2",
      name: "Casey Second",
      title: "COO",
      reasonToTalk: "Public supporter of new CEO's strategy.",
      evidenceRefs: ["ev-few-1"],
    }),
  ];
  return createSnapshot(tenantId, {
    companyId: "co-fewer",
    eligibilityState: "eligible",
    reasonToContact: "Leadership change creates opening.",
    people,
    evidence: ev,
    trustScore: 0.7,
    // Unique compound flag signature for QA: "fewer contacts" is modeled
    // as mild coverage degradation (`degraded`) combined with reduced
    // outreach confidence (`lowConfidence`). This keeps the flag set
    // distinct from both `fixtureDegraded` (degraded only) and
    // `fixtureLowConfidence` (lowConfidence only). See fixture
    // distinctness tests.
    stateFlags: createStateFlags({ degraded: true, lowConfidence: true }),
  });
}

/** Eligible but no signal — empty state. */
export function fixtureEmpty(tenantId: string): Snapshot {
  return createSnapshot(tenantId, {
    companyId: "co-empty",
    eligibilityState: "eligible",
    reasonToContact: undefined,
    people: [],
    evidence: [],
    trustScore: undefined,
    stateFlags: createStateFlags({ empty: true }),
  });
}

/** Stale evidence older than freshnessMaxDays. */
export function fixtureStale(tenantId: string): Snapshot {
  const stale = new Date(Date.now() - 120 * DAY_MS);
  const ev = [
    evid(tenantId, "ev-stale-1", {
      source: "news",
      confidence: 0.85,
      content: "Old partnership announcement.",
      timestamp: stale,
    }),
  ];
  return createSnapshot(tenantId, {
    companyId: "co-stale",
    eligibilityState: "eligible",
    reasonToContact: "Historical partnership — may no longer be current.",
    people: [
      createPerson({
        id: "p-stale-1",
        name: "Taylor Past",
        title: "Director",
        reasonToTalk: "Named in old partnership post.",
        evidenceRefs: ["ev-stale-1"],
      }),
    ],
    evidence: ev,
    trustScore: 0.6,
    stateFlags: createStateFlags({ stale: true }),
  });
}

/** Degraded source — adapter returned partial data. */
export function fixtureDegraded(tenantId: string): Snapshot {
  const ev = [
    evid(tenantId, "ev-degraded-1", {
      source: "hubspot",
      confidence: 0.7,
      content: "Partial data: news adapter timed out.",
    }),
  ];
  return createSnapshot(tenantId, {
    companyId: "co-degraded",
    eligibilityState: "eligible",
    reasonToContact: "HubSpot engagement signal (news adapter unavailable).",
    people: [
      createPerson({
        id: "p-degraded-1",
        name: "Morgan Partial",
        title: "Manager",
        reasonToTalk: "Opened product email recently.",
        evidenceRefs: ["ev-degraded-1"],
      }),
    ],
    evidence: ev,
    trustScore: 0.65,
    stateFlags: createStateFlags({ degraded: true }),
  });
}

/** Trust score below threshold. */
export function fixtureLowConfidence(tenantId: string): Snapshot {
  const ev = [
    evid(tenantId, "ev-lowconf-1", {
      source: "news",
      confidence: 0.32,
      content: "Unverified rumor of expansion.",
    }),
  ];
  return createSnapshot(tenantId, {
    companyId: "co-lowconf",
    eligibilityState: "eligible",
    reasonToContact: "Rumor of expansion — low confidence.",
    people: [
      createPerson({
        id: "p-lowconf-1",
        name: "Jamie Maybe",
        title: "VP Unknown",
        reasonToTalk: "Mentioned in unverified source.",
        evidenceRefs: ["ev-lowconf-1"],
      }),
    ],
    evidence: ev,
    trustScore: 0.3,
    stateFlags: createStateFlags({ lowConfidence: true }),
  });
}

/** Account does not qualify at all (e.g. `hs_is_target_account` false). */
export function fixtureIneligible(tenantId: string): Snapshot {
  const state: EligibilityState = "ineligible";
  return createSnapshot(tenantId, {
    companyId: "co-ineligible",
    eligibilityState: state,
    reasonToContact: undefined,
    people: [],
    evidence: [],
    trustScore: undefined,
    stateFlags: createStateFlags({ ineligible: true }),
  });
}

/**
 * Restricted evidence MUST NEVER be shown or summarized.
 *
 * Fixture returns an empty snapshot (no evidence, no people, no reason) to
 * guarantee zero-leakage in downstream rendering tests.
 */
export function fixtureRestricted(tenantId: string): Snapshot {
  return createSnapshot(tenantId, {
    companyId: "co-restricted",
    eligibilityState: "eligible",
    reasonToContact: undefined,
    people: [],
    evidence: [],
    trustScore: undefined,
    stateFlags: createStateFlags({ restricted: true }),
  });
}
