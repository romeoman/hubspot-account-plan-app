import { randomUUID } from "node:crypto";
import { createDatabase, tenants } from "@hap/db";
import { like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createMockLlmAdapter } from "../../adapters/mock-llm-adapter";
import { createMockSignalAdapter } from "../../adapters/mock-signal-adapter";
import type { CompanyPropertyFetcher } from "../eligibility";
import { clearEligibilityCache } from "../eligibility";
import type { ContactFetcher } from "../people-selector";
import { assembleSnapshot } from "../snapshot-assembler";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const db = createDatabase(DATABASE_URL);

const PORTAL_PREFIX = `assembletest-${randomUUID().slice(0, 8)}-`;

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
const UNCONFIGURED: CompanyPropertyFetcher = async () => null;

const threeContacts: ContactFetcher = async () => [
  { id: "c1", name: "Alice", title: "VP Engineering" },
  { id: "c2", name: "Bob", title: "CTO" },
  { id: "c3", name: "Carol", title: "Head of Platform" },
];
const zeroContacts: ContactFetcher = async () => [];

beforeEach(async () => {
  clearEligibilityCache();
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

afterAll(() => {
  // postgres.js cleans up on process exit
});

describe("assembleSnapshot", () => {
  it("returns ineligible snapshot when eligibility=ineligible", async () => {
    const tenantId = await seedTenant();
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: createMockSignalAdapter({ fixture: "strong" }),
        llmAdapter: createMockLlmAdapter(),
        propertyFetcher: INELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-x" },
    );
    expect(snap.eligibilityState).toBe("ineligible");
    expect(snap.people).toEqual([]);
    expect(snap.evidence).toEqual([]);
    expect(snap.stateFlags.ineligible).toBe(true);
    expect(snap.tenantId).toBe(tenantId);
    expect(snap.companyId).toBe("co-x");
    expect(snap.reasonToContact).toBeUndefined();
  });

  it("returns unconfigured snapshot when eligibility=unconfigured", async () => {
    const tenantId = await seedTenant();
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: createMockSignalAdapter({ fixture: "strong" }),
        propertyFetcher: UNCONFIGURED,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-y" },
    );
    expect(snap.eligibilityState).toBe("unconfigured");
    expect(snap.people).toEqual([]);
    expect(snap.evidence).toEqual([]);
    expect(snap.reasonToContact).toBeUndefined();
    expect(snap.tenantId).toBe(tenantId);
  });

  it("returns empty-state snapshot when eligible but no dominant signal", async () => {
    const tenantId = await seedTenant();
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: createMockSignalAdapter({ fixture: "empty" }),
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
    expect(snap.tenantId).toBe(tenantId);
  });

  it("returns full snapshot for eligible + strong signal + 3 contacts", async () => {
    const tenantId = await seedTenant();
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: createMockSignalAdapter({ fixture: "strong" }),
        llmAdapter: createMockLlmAdapter(),
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-full" },
    );
    expect(snap.eligibilityState).toBe("eligible");
    expect(snap.stateFlags.empty).toBe(false);
    expect(snap.stateFlags.ineligible).toBe(false);
    expect(snap.reasonToContact).toBeDefined();
    expect(snap.people.length).toBeGreaterThan(0);
    expect(snap.people.length).toBeLessThanOrEqual(3);
    expect(snap.evidence.length).toBeGreaterThan(0);
    expect(snap.tenantId).toBe(tenantId);
    // Every evidence row stamped with caller tenantId.
    for (const ev of snap.evidence) {
      expect(ev.tenantId).toBe(tenantId);
    }
  });

  it("returns reason with empty people when signal exists but 0 contacts", async () => {
    const tenantId = await seedTenant();
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: createMockSignalAdapter({ fixture: "strong" }),
        propertyFetcher: ELIGIBLE,
        contactFetcher: zeroContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-nocontacts" },
    );
    expect(snap.eligibilityState).toBe("eligible");
    expect(snap.reasonToContact).toBeDefined();
    expect(snap.people).toEqual([]);
    expect(snap.tenantId).toBe(tenantId);
  });

  it("never leaks tenantId — uses caller arg, never anything else", async () => {
    const tenantId = await seedTenant();
    // A signal adapter whose internal fixture uses a different tenantId baked in
    // should still return rows stamped with the caller's tenantId because the
    // mock adapter always overrides. Assembler must preserve that.
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: createMockSignalAdapter({ fixture: "strong" }),
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-iso" },
    );
    for (const ev of snap.evidence) {
      expect(ev.tenantId).toBe(tenantId);
    }
  });
});
