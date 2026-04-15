/**
 * 8-state QA coverage for the snapshot assembler — post-Step-9.
 *
 * Each test drives assembleSnapshot() with a tailored ProviderAdapter +
 * thresholds + eligibility so that the resulting Snapshot.stateFlags match
 * the corresponding QA fixture family EXACTLY:
 *
 *  1. eligible-strong         → no flags
 *  2. eligible-fewer-contacts → people length in 1..2
 *  3. empty                   → stateFlags.empty=true
 *  4. stale                   → stateFlags.stale=true, ageDays in warnings
 *  5. degraded                → stateFlags.degraded=true, reason in warnings
 *  6. lowConfidence           → stateFlags.lowConfidence=true, score in warnings
 *  7. ineligible              → eligibilityState='ineligible', flags.ineligible=true
 *  8. restricted              → zero-leak empty shape (no evidence, people, reason, trustScore)
 *
 * Plus tenant-specific threshold tests: same Evidence → different flags for
 * lenient vs strict tenants.
 */

import { randomUUID } from "node:crypto";
import { createEvidence, type Evidence } from "@hap/config";
import { createDatabase, tenants } from "@hap/db";
import { like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ProviderAdapter } from "../../adapters/provider-adapter";
import type { CompanyPropertyFetcher } from "../eligibility";
import { clearEligibilityCache } from "../eligibility";
import type { ContactFetcher } from "../people-selector";
import { assembleSnapshot } from "../snapshot-assembler";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const db = createDatabase(DATABASE_URL);

const DAY_MS = 24 * 60 * 60 * 1000;
const PORTAL_PREFIX = `stateassemble-${randomUUID().slice(0, 8)}-`;

async function seedTenant(): Promise<string> {
  const [row] = await db
    .insert(tenants)
    .values({
      hubspotPortalId: `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`,
      name: "T",
    })
    .returning();
  if (!row) throw new Error("failed to seed tenant");
  return row.id;
}

const THRESHOLDS = { freshnessMaxDays: 30, minConfidence: 0.5 };
const ELIGIBLE: CompanyPropertyFetcher = async () => true;
const INELIGIBLE: CompanyPropertyFetcher = async () => false;

const threeContacts: ContactFetcher = async () => [
  { id: "c1", name: "Alice", title: "VP Engineering" },
  { id: "c2", name: "Bob", title: "CTO" },
  { id: "c3", name: "Carol", title: "Head of Platform" },
];
const oneContact: ContactFetcher = async () => [
  { id: "c1", name: "Alice", title: "VP Engineering" },
];

function adapterFromEvidence(rows: Evidence[]): ProviderAdapter {
  return {
    name: "test",
    async fetchSignals(tenantId: string): Promise<Evidence[]> {
      // Re-stamp tenantId to match assembler's isolation contract.
      return rows.map((r) => ({ ...r, tenantId }));
    },
  };
}

beforeEach(async () => {
  clearEligibilityCache();
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

afterAll(() => {
  // postgres.js cleans up on exit.
});

describe("assembleSnapshot — 8 QA states", () => {
  it("[1] eligible-strong: no suppression flags, full snapshot", async () => {
    const tenantId = await seedTenant();
    const now = new Date();
    const signals: Evidence[] = [
      createEvidence(tenantId, {
        id: "ev-s1",
        source: "hubspot",
        confidence: 0.92,
        content: "Engagement",
        timestamp: new Date(now.getTime() - 2 * DAY_MS),
      }),
    ];
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: adapterFromEvidence(signals),
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
        now,
      },
      { tenantId, companyId: "co-strong" },
    );
    expect(snap.eligibilityState).toBe("eligible");
    expect(snap.stateFlags.stale).toBe(false);
    expect(snap.stateFlags.degraded).toBe(false);
    expect(snap.stateFlags.lowConfidence).toBe(false);
    expect(snap.stateFlags.restricted).toBe(false);
    expect(snap.stateFlags.empty).toBe(false);
    expect(snap.stateFlags.ineligible).toBe(false);
    expect(snap.reasonToContact).toBeDefined();
    expect(snap.people.length).toBeGreaterThanOrEqual(1);
  });

  it("[2] eligible-fewer-contacts: people length in 1..2, no fabrication", async () => {
    const tenantId = await seedTenant();
    const now = new Date();
    const signals: Evidence[] = [
      createEvidence(tenantId, {
        id: "ev-fc",
        source: "news",
        confidence: 0.85,
        content: "Leadership change",
        timestamp: new Date(now.getTime() - 3 * DAY_MS),
      }),
    ];
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: adapterFromEvidence(signals),
        propertyFetcher: ELIGIBLE,
        contactFetcher: oneContact,
        thresholds: THRESHOLDS,
        now,
      },
      { tenantId, companyId: "co-fewer" },
    );
    expect(snap.eligibilityState).toBe("eligible");
    expect(snap.people.length).toBeGreaterThanOrEqual(1);
    expect(snap.people.length).toBeLessThanOrEqual(2);
  });

  it("[3] empty: stateFlags.empty=true, no people, no reason", async () => {
    const tenantId = await seedTenant();
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: adapterFromEvidence([]),
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-empty" },
    );
    expect(snap.eligibilityState).toBe("eligible");
    expect(snap.stateFlags.empty).toBe(true);
    expect(snap.people).toEqual([]);
    expect(snap.reasonToContact).toBeUndefined();
  });

  it("[4] stale: stateFlags.stale=true, evidence preserved", async () => {
    const tenantId = await seedTenant();
    const now = new Date();
    const signals: Evidence[] = [
      createEvidence(tenantId, {
        id: "ev-stale",
        source: "news",
        confidence: 0.9,
        content: "Old partnership",
        timestamp: new Date(now.getTime() - 120 * DAY_MS),
      }),
    ];
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: adapterFromEvidence(signals),
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
        now,
      },
      { tenantId, companyId: "co-stale" },
    );
    expect(snap.stateFlags.stale).toBe(true);
    expect(snap.evidence.length).toBeGreaterThan(0);
  });

  it("[5] degraded: stateFlags.degraded=true when source invalid", async () => {
    const tenantId = await seedTenant();
    const now = new Date();
    const signals: Evidence[] = [
      createEvidence(tenantId, {
        id: "ev-deg",
        source: "", // invalid source → degraded
        confidence: 0.9,
        content: "Data with broken source",
        timestamp: new Date(now.getTime() - 2 * DAY_MS),
      }),
    ];
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: adapterFromEvidence(signals),
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
        now,
      },
      { tenantId, companyId: "co-degraded" },
    );
    expect(snap.stateFlags.degraded).toBe(true);
  });

  it("[5b] degraded: stateFlags.degraded=true when adapter throws (transport error)", async () => {
    const tenantId = await seedTenant();
    const throwingAdapter: ProviderAdapter = {
      name: "throwing",
      async fetchSignals(): Promise<Evidence[]> {
        throw new Error("transport fail");
      },
    };
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: throwingAdapter,
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-degraded-transport" },
    );
    expect(snap.stateFlags.degraded).toBe(true);
  });

  it("[6] lowConfidence: stateFlags.lowConfidence=true", async () => {
    const tenantId = await seedTenant();
    const now = new Date();
    const signals: Evidence[] = [
      createEvidence(tenantId, {
        id: "ev-low",
        source: "news",
        confidence: 0.2,
        content: "Unverified rumor",
        timestamp: new Date(now.getTime() - 2 * DAY_MS),
      }),
    ];
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: adapterFromEvidence(signals),
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
        now,
      },
      { tenantId, companyId: "co-lowconf" },
    );
    expect(snap.stateFlags.lowConfidence).toBe(true);
    expect(snap.evidence.length).toBeGreaterThan(0);
  });

  it("[7] ineligible: eligibilityState='ineligible', stateFlags.ineligible=true, empty", async () => {
    const tenantId = await seedTenant();
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: adapterFromEvidence([]),
        propertyFetcher: INELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-ineligible" },
    );
    expect(snap.eligibilityState).toBe("ineligible");
    expect(snap.stateFlags.ineligible).toBe(true);
    expect(snap.people).toEqual([]);
    expect(snap.evidence).toEqual([]);
    expect(snap.reasonToContact).toBeUndefined();
  });

  it("[8] restricted: zero-leak — empty evidence/people/reason/trustScore", async () => {
    const tenantId = await seedTenant();
    const signals: Evidence[] = [
      createEvidence(tenantId, {
        id: "ev-secret",
        source: "internal-hr",
        confidence: 0.99,
        content: "HIGHLY CONFIDENTIAL EMPLOYEE NOTE — DO NOT LEAK",
        isRestricted: true,
      }),
    ];
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: adapterFromEvidence(signals),
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-restricted" },
    );

    expect(snap.eligibilityState).toBe("eligible");
    expect(snap.stateFlags.restricted).toBe(true);
    expect(snap.evidence).toEqual([]);
    expect(snap.people).toEqual([]);
    expect(snap.reasonToContact).toBeUndefined();
    expect(snap.trustScore).toBeUndefined();

    // Deep leak check — the entire serialized snapshot must NOT contain any
    // restricted content, source, or id.
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain("HIGHLY CONFIDENTIAL EMPLOYEE NOTE");
    expect(serialized).not.toContain("internal-hr");
    expect(serialized).not.toContain("ev-secret");
  });

  it("[8b] restricted mixed with ok evidence: restricted flag set AND restricted row filtered", async () => {
    const tenantId = await seedTenant();
    const now = new Date();
    const signals: Evidence[] = [
      createEvidence(tenantId, {
        id: "ev-sec",
        source: "internal",
        confidence: 0.99,
        content: "LEAK-TEST-SECRET",
        isRestricted: true,
        timestamp: new Date(now.getTime() - 1 * DAY_MS),
      }),
      createEvidence(tenantId, {
        id: "ev-ok",
        source: "hubspot",
        confidence: 0.9,
        content: "Public engagement",
        isRestricted: false,
        timestamp: new Date(now.getTime() - 1 * DAY_MS),
      }),
    ];
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: adapterFromEvidence(signals),
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
        now,
      },
      { tenantId, companyId: "co-restricted-mixed" },
    );

    expect(snap.stateFlags.restricted).toBe(true);
    // Restricted leak check must pass regardless of ok row presence.
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain("LEAK-TEST-SECRET");
    expect(serialized).not.toContain("ev-sec");
    // Only the non-restricted row survives.
    for (const ev of snap.evidence) {
      expect(ev.isRestricted).toBe(false);
    }
  });
});

describe("assembleSnapshot — tenant-specific thresholds change outcome", () => {
  it("lenient tenant: same evidence is clean; strict tenant: same evidence is stale+lowConf", async () => {
    const tenantId = await seedTenant();
    const now = new Date();
    const sharedSignals: Evidence[] = [
      createEvidence(tenantId, {
        id: "ev-shared",
        source: "hubspot",
        confidence: 0.4,
        content: "Shared engagement",
        timestamp: new Date(now.getTime() - 45 * DAY_MS),
      }),
    ];

    const lenient = await assembleSnapshot(
      {
        db,
        providerAdapter: adapterFromEvidence(sharedSignals),
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: { freshnessMaxDays: 365, minConfidence: 0.1 },
        now,
      },
      { tenantId, companyId: "co-lenient" },
    );

    const strict = await assembleSnapshot(
      {
        db,
        providerAdapter: adapterFromEvidence(sharedSignals),
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: { freshnessMaxDays: 7, minConfidence: 0.9 },
        now,
      },
      { tenantId, companyId: "co-strict" },
    );

    expect(lenient.stateFlags.stale).toBe(false);
    expect(lenient.stateFlags.lowConfidence).toBe(false);

    expect(strict.stateFlags.stale).toBe(true);
    expect(strict.stateFlags.lowConfidence).toBe(true);
  });
});
