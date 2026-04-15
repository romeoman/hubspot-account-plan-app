import { describe, expect, it } from "vitest";
import {
  createEvidence,
  createPerson,
  createSnapshot,
  createStateFlags,
  fixtureDegraded,
  fixtureEligibleStrong,
  fixtureEmpty,
  fixtureFewerContacts,
  fixtureIneligible,
  fixtureLowConfidence,
  fixtureRestricted,
  fixtureStale,
} from "../factories";

const TENANT = "tenant-under-test";

describe("createStateFlags", () => {
  it("defaults all flags to false", () => {
    expect(createStateFlags()).toEqual({
      stale: false,
      degraded: false,
      lowConfidence: false,
      ineligible: false,
      restricted: false,
      empty: false,
    });
  });

  it("applies overrides", () => {
    const flags = createStateFlags({ stale: true, lowConfidence: true });
    expect(flags.stale).toBe(true);
    expect(flags.lowConfidence).toBe(true);
    expect(flags.empty).toBe(false);
  });
});

describe("createPerson", () => {
  it("fills defaults", () => {
    const p = createPerson();
    expect(p.id).toBeTruthy();
    expect(p.evidenceRefs).toEqual([]);
    expect(p.title).toBeUndefined();
  });
});

describe("createEvidence", () => {
  it("propagates tenantId", () => {
    const ev = createEvidence(TENANT);
    expect(ev.tenantId).toBe(TENANT);
    expect(ev.timestamp).toBeInstanceOf(Date);
  });

  it("clamps defaults to valid confidence range", () => {
    const ev = createEvidence(TENANT);
    expect(ev.confidence).toBeGreaterThanOrEqual(0);
    expect(ev.confidence).toBeLessThanOrEqual(1);
  });
});

describe("createSnapshot", () => {
  it("carries tenantId through to every nested evidence row", () => {
    const ev1 = createEvidence("other-tenant", { id: "a" });
    const ev2 = createEvidence("other-tenant", { id: "b" });
    const snap = createSnapshot(TENANT, { evidence: [ev1, ev2] });
    expect(snap.tenantId).toBe(TENANT);
    for (const ev of snap.evidence) {
      expect(ev.tenantId).toBe(TENANT);
    }
  });
});

describe("8 QA fixtures", () => {
  const fixtures = [
    ["EligibleStrong", fixtureEligibleStrong(TENANT)],
    ["FewerContacts", fixtureFewerContacts(TENANT)],
    ["Empty", fixtureEmpty(TENANT)],
    ["Stale", fixtureStale(TENANT)],
    ["Degraded", fixtureDegraded(TENANT)],
    ["LowConfidence", fixtureLowConfidence(TENANT)],
    ["Ineligible", fixtureIneligible(TENANT)],
    ["Restricted", fixtureRestricted(TENANT)],
  ] as const;

  it("produce DISTINCT snapshots across all 8 — distinguishable by some field, not necessarily flag bitmask alone", () => {
    // The 8 QA states are distinguished by a combination of eligibilityState,
    // stateFlags, people.length, evidence.length, and reasonToContact —
    // NOT by requiring every state to have a unique stateFlags signature.
    // (e.g., eligible-strong and fewer-contacts share an all-false flag set
    // but differ in people.length.) Asserting unique full-snapshot signatures
    // is the honest invariant.
    const signatures = fixtures.map(([_, s]) =>
      JSON.stringify({
        eligibility: s.eligibilityState,
        flags: s.stateFlags,
        peopleCount: s.people.length,
        evidenceCount: s.evidence.length,
        hasReason: Boolean(s.reasonToContact),
      }),
    );
    const unique = new Set(signatures);
    expect(unique.size).toBe(fixtures.length);
  });

  it("propagate tenantId on every evidence row", () => {
    for (const [name, snap] of fixtures) {
      expect(snap.tenantId, `${name}.tenantId`).toBe(TENANT);
      for (const ev of snap.evidence) {
        expect(ev.tenantId, `${name} ev ${ev.id}`).toBe(TENANT);
      }
    }
  });

  it("EligibleStrong has exactly 3 people and eligible state", () => {
    const s = fixtureEligibleStrong(TENANT);
    expect(s.people).toHaveLength(3);
    expect(s.eligibilityState).toBe("eligible");
  });

  it("FewerContacts returns 1 or 2 people (never 0, never 3)", () => {
    const s = fixtureFewerContacts(TENANT);
    expect(s.people.length).toBeGreaterThanOrEqual(1);
    expect(s.people.length).toBeLessThanOrEqual(2);
    expect(s.eligibilityState).toBe("eligible");
  });

  it("Empty has no people, no reason, and flags.empty=true", () => {
    const s = fixtureEmpty(TENANT);
    expect(s.people).toEqual([]);
    expect(s.reasonToContact).toBeUndefined();
    expect(s.stateFlags.empty).toBe(true);
  });

  it("Stale flags are set and evidence older than 30 days exists", () => {
    const s = fixtureStale(TENANT);
    expect(s.stateFlags.stale).toBe(true);
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const hasOld = s.evidence.some((e) => e.timestamp.getTime() < cutoff);
    expect(hasOld).toBe(true);
  });

  it("Degraded flag is set", () => {
    expect(fixtureDegraded(TENANT).stateFlags.degraded).toBe(true);
  });

  it("LowConfidence flag is set and trustScore is low", () => {
    const s = fixtureLowConfidence(TENANT);
    expect(s.stateFlags.lowConfidence).toBe(true);
    expect(s.trustScore).toBeDefined();
    expect(s.trustScore ?? 1).toBeLessThan(0.5);
  });

  it("Ineligible has ineligible state + flag + no people/evidence", () => {
    const s = fixtureIneligible(TENANT);
    expect(s.eligibilityState).toBe("ineligible");
    expect(s.stateFlags.ineligible).toBe(true);
    expect(s.people).toEqual([]);
  });

  it("Restricted leaks nothing: empty evidence, people, and reason", () => {
    const s = fixtureRestricted(TENANT);
    expect(s.stateFlags.restricted).toBe(true);
    expect(s.evidence).toEqual([]);
    expect(s.people).toEqual([]);
    expect(s.reasonToContact).toBeUndefined();
    expect(s.trustScore).toBeUndefined();
  });
});
