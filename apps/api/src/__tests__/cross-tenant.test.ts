/**
 * Cross-tenant integration tests — Slice 1, Step 12.
 *
 * Proves tenant isolation at every boundary the project `CLAUDE.md` tenant
 * rule forbids crossing:
 *   - DB queries (snapshots, evidence, people, provider_config)
 *   - Encryption stub (tenant-bound ciphertext)
 *   - Eligibility cache (in-memory, tenant-scoped key)
 *   - Config-resolver cache (in-memory, tenant-scoped key)
 *   - Snapshot route (tenantId sourced from middleware, not request body)
 *   - Restricted-state response (no leak, per-tenant)
 *
 * Each test seeds its own tenants under a unique portal prefix so parallel
 * test files never interact. FK cascades + the portal-prefix scoped DELETE in
 * `beforeEach` keep the DB clean.
 */

import { randomUUID } from "node:crypto";
import {
  createDatabase,
  evidence as evidenceTable,
  people as peopleTable,
  providerConfig,
  snapshots as snapshotsTable,
  tenants,
} from "@hap/db";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createMockLlmAdapter } from "../adapters/mock-llm-adapter";
import type { ProviderAdapter } from "../adapters/provider-adapter";
import { clearConfigResolverCache, getProviderConfig } from "../lib/config-resolver";
import { decryptProviderKey, encryptProviderKey } from "../lib/encryption";
import {
  checkEligibility,
  clearEligibilityCache,
  DEFAULT_ELIGIBILITY_PROPERTY,
} from "../services/eligibility";
import { assembleSnapshot } from "../services/snapshot-assembler";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";
const db = createDatabase(DATABASE_URL);

const PORTAL_PREFIX = `xtenant-${randomUUID().slice(0, 8)}-`;
function portalId() {
  return `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;
}

async function seedTenant(name: string) {
  const [row] = await db.insert(tenants).values({ hubspotPortalId: portalId(), name }).returning();
  if (!row) throw new Error("seed tenant failed");
  return row;
}

beforeEach(async () => {
  clearEligibilityCache();
  clearConfigResolverCache();
  // FK cascade removes snapshots/evidence/people/provider_config/llm_config
  // belonging to our test tenants, scoped by portal prefix.
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

afterAll(() => {
  // postgres.js cleans up on process exit
});

const THRESHOLDS = { freshnessMaxDays: 30, minConfidence: 0.5 };

// ---------------------------------------------------------------------------
// DB-layer isolation
// ---------------------------------------------------------------------------

describe("cross-tenant: DB layer", () => {
  it("snapshots scoped by tenant A never return tenant B rows", async () => {
    const tA = await seedTenant("A");
    const tB = await seedTenant("B");

    const [snapA] = await db
      .insert(snapshotsTable)
      .values({
        tenantId: tA.id,
        companyId: "co-A",
        eligibilityState: "eligible",
        stateFlags: {},
      })
      .returning();
    const [snapB] = await db
      .insert(snapshotsTable)
      .values({
        tenantId: tB.id,
        companyId: "co-B",
        eligibilityState: "eligible",
        stateFlags: {},
      })
      .returning();

    const rowsA = await db.select().from(snapshotsTable).where(eq(snapshotsTable.tenantId, tA.id));
    const rowsB = await db.select().from(snapshotsTable).where(eq(snapshotsTable.tenantId, tB.id));

    expect(rowsA.map((r) => r.id)).toEqual([snapA?.id]);
    expect(rowsB.map((r) => r.id)).toEqual([snapB?.id]);
    expect(rowsA.every((r) => r.tenantId === tA.id)).toBe(true);
    expect(rowsB.every((r) => r.tenantId === tB.id)).toBe(true);
  });

  it("evidence + people scoped by tenant A never return tenant B rows", async () => {
    const tA = await seedTenant("A");
    const tB = await seedTenant("B");

    const [snapA] = await db
      .insert(snapshotsTable)
      .values({
        tenantId: tA.id,
        companyId: "co-A",
        eligibilityState: "eligible",
        stateFlags: {},
      })
      .returning();
    const [snapB] = await db
      .insert(snapshotsTable)
      .values({
        tenantId: tB.id,
        companyId: "co-B",
        eligibilityState: "eligible",
        stateFlags: {},
      })
      .returning();
    if (!snapA || !snapB) throw new Error("snapshot insert failed");

    await db.insert(evidenceTable).values({
      tenantId: tA.id,
      snapshotId: snapA.id,
      source: "hubspot",
      timestamp: new Date(),
      confidence: 0.9,
      content: "A-only evidence",
      isRestricted: false,
    });
    await db.insert(evidenceTable).values({
      tenantId: tB.id,
      snapshotId: snapB.id,
      source: "hubspot",
      timestamp: new Date(),
      confidence: 0.9,
      content: "B-only evidence",
      isRestricted: false,
    });
    await db.insert(peopleTable).values({
      tenantId: tA.id,
      snapshotId: snapA.id,
      name: "A Contact",
      reasonToTalk: "A reason",
      evidenceRefs: [],
    });
    await db.insert(peopleTable).values({
      tenantId: tB.id,
      snapshotId: snapB.id,
      name: "B Contact",
      reasonToTalk: "B reason",
      evidenceRefs: [],
    });

    const evA = await db.select().from(evidenceTable).where(eq(evidenceTable.tenantId, tA.id));
    const pplA = await db.select().from(peopleTable).where(eq(peopleTable.tenantId, tA.id));

    expect(evA.length).toBe(1);
    expect(evA[0]?.content).toBe("A-only evidence");
    expect(pplA.length).toBe(1);
    expect(pplA[0]?.name).toBe("A Contact");
    expect(evA.every((r) => r.tenantId === tA.id)).toBe(true);
    expect(pplA.every((r) => r.tenantId === tA.id)).toBe(true);
  });

  it("provider_config scoped by tenant A never returns tenant B rows", async () => {
    const tA = await seedTenant("A");
    const tB = await seedTenant("B");

    await db.insert(providerConfig).values({
      tenantId: tA.id,
      providerName: "exa",
      enabled: true,
      apiKeyEncrypted: encryptProviderKey(tA.id, "key-A"),
      thresholds: {},
      settings: {},
    });
    await db.insert(providerConfig).values({
      tenantId: tB.id,
      providerName: "exa",
      enabled: true,
      apiKeyEncrypted: encryptProviderKey(tB.id, "key-B"),
      thresholds: {},
      settings: {},
    });

    const rowsA = await db
      .select()
      .from(providerConfig)
      .where(and(eq(providerConfig.tenantId, tA.id), eq(providerConfig.providerName, "exa")));

    expect(rowsA.length).toBe(1);
    expect(rowsA[0]?.tenantId).toBe(tA.id);
    // Decrypt with tenant A -> returns A's plaintext
    const plain = decryptProviderKey(tA.id, rowsA[0]?.apiKeyEncrypted ?? "");
    expect(plain).toBe("key-A");
  });
});

// ---------------------------------------------------------------------------
// Encryption stub — tenant-bound ciphertext
// ---------------------------------------------------------------------------

describe("cross-tenant: encryption", () => {
  it("decryptProviderKey(tenantA, ciphertextForB) throws tenant mismatch", async () => {
    const tA = await seedTenant("A");
    const tB = await seedTenant("B");
    const ctForB = encryptProviderKey(tB.id, "tenant-B-secret");

    expect(() => decryptProviderKey(tA.id, ctForB)).toThrow(/tenant mismatch/);
  });

  it("each tenant can decrypt only its own ciphertext", async () => {
    const tA = await seedTenant("A");
    const tB = await seedTenant("B");
    const ctA = encryptProviderKey(tA.id, "secret-A");
    const ctB = encryptProviderKey(tB.id, "secret-B");

    expect(decryptProviderKey(tA.id, ctA)).toBe("secret-A");
    expect(decryptProviderKey(tB.id, ctB)).toBe("secret-B");
    expect(() => decryptProviderKey(tA.id, ctB)).toThrow(/tenant mismatch/);
    expect(() => decryptProviderKey(tB.id, ctA)).toThrow(/tenant mismatch/);
  });
});

// ---------------------------------------------------------------------------
// Eligibility cache isolation
// ---------------------------------------------------------------------------

describe("cross-tenant: eligibility cache", () => {
  it("eligibility cache for A is never returned for B (same companyId)", async () => {
    const tA = await seedTenant("A");
    const tB = await seedTenant("B");

    // Warm A's cache with an "eligible" result.
    const resultA = await checkEligibility(
      {
        db,
        fetcher: async (tid, _cid, prop) => {
          expect(tid).toBe(tA.id);
          expect(prop).toBe(DEFAULT_ELIGIBILITY_PROPERTY);
          return true;
        },
      },
      { tenantId: tA.id, companyId: "shared-company" },
    );
    expect(resultA).toEqual({ eligible: true, reason: "eligible" });

    // Now check B with a fetcher that returns the OPPOSITE. If A's cache
    // leaked, B would receive A's "eligible" result; instead B must see its
    // own fetcher result.
    const fetchCountB = { count: 0 };
    const resultB = await checkEligibility(
      {
        db,
        fetcher: async () => {
          fetchCountB.count += 1;
          return false;
        },
      },
      { tenantId: tB.id, companyId: "shared-company" },
    );
    expect(resultB).toEqual({ eligible: false, reason: "ineligible" });
    expect(fetchCountB.count).toBe(1);

    // And A's cache is still A's.
    const resultA2 = await checkEligibility(
      {
        db,
        fetcher: async () => {
          // If this fires, A's cache was invalidated by B's call -> also a bug.
          throw new Error("unexpected fetcher call for tenant A");
        },
      },
      { tenantId: tA.id, companyId: "shared-company" },
    );
    expect(resultA2).toEqual({ eligible: true, reason: "eligible" });
  });
});

// ---------------------------------------------------------------------------
// Config-resolver cache isolation
// ---------------------------------------------------------------------------

describe("cross-tenant: config-resolver cache", () => {
  it("provider-config cache for A is never returned for B", async () => {
    const tA = await seedTenant("A");
    const tB = await seedTenant("B");

    // A has an exa row; B does NOT.
    await db.insert(providerConfig).values({
      tenantId: tA.id,
      providerName: "exa",
      enabled: true,
      apiKeyEncrypted: encryptProviderKey(tA.id, "key-A"),
      thresholds: { freshnessMaxDays: 10, minConfidence: 0.5 },
      settings: {},
    });

    const a1 = await getProviderConfig({ db }, { tenantId: tA.id, providerName: "exa" });
    expect(a1?.name).toBe("exa");
    expect(a1?.apiKeyRef).toBe("key-A");

    // B must NOT see A's cached row. Expected result: null.
    const b1 = await getProviderConfig({ db }, { tenantId: tB.id, providerName: "exa" });
    expect(b1).toBeNull();

    // Now give B its own distinct row and assert B gets its own — not A's cached value.
    await db.insert(providerConfig).values({
      tenantId: tB.id,
      providerName: "exa",
      enabled: true,
      apiKeyEncrypted: encryptProviderKey(tB.id, "key-B"),
      thresholds: { freshnessMaxDays: 60, minConfidence: 0.8 },
      settings: {},
    });

    // Clear cache to force a re-read now that B has its own row (A's cached
    // null for B would otherwise mask it; the key we care about is that
    // cache keys are tenant-scoped, which we re-verify by clearing + reading).
    clearConfigResolverCache();
    const b2 = await getProviderConfig({ db }, { tenantId: tB.id, providerName: "exa" });
    expect(b2?.apiKeyRef).toBe("key-B");
    expect(b2?.apiKeyRef).not.toBe("key-A");

    // And A still gets its own config after B's read.
    const a2 = await getProviderConfig({ db }, { tenantId: tA.id, providerName: "exa" });
    expect(a2?.apiKeyRef).toBe("key-A");
  });
});

// ---------------------------------------------------------------------------
// Route layer — tenantId from middleware, not body
// ---------------------------------------------------------------------------

describe("cross-tenant: snapshot route", () => {
  it("response tenantId is middleware-resolved and body-spoofed tenantId is ignored", async () => {
    // Restore env after the test so we don't bleed state into siblings.
    const prevNode = process.env.NODE_ENV;
    const prevDb = process.env.DATABASE_URL;
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = DATABASE_URL;
    try {
      const tA = await seedTenant("A");
      const tB = await seedTenant("B");

      // Fresh module import so env is picked up.
      const mod = await import("../index");
      const app = mod.default;

      const resA = await app.request("/api/snapshot/co-xyz", {
        method: "POST",
        headers: {
          Authorization: "Bearer anything",
          "x-test-portal-id": tA.hubspotPortalId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tenantId: tB.id, companyId: "co-xyz" }),
      });
      expect(resA.status).toBe(200);
      const bodyA = (await resA.json()) as {
        tenantId: string;
        evidence: Array<{ tenantId: string }>;
      };
      expect(bodyA.tenantId).toBe(tA.id);
      expect(bodyA.tenantId).not.toBe(tB.id);
      for (const ev of bodyA.evidence) {
        expect(ev.tenantId).toBe(tA.id);
      }

      // And tenant B gets its own response with B's id — not a cached A result.
      const resB = await app.request("/api/snapshot/co-xyz", {
        method: "POST",
        headers: {
          Authorization: "Bearer anything",
          "x-test-portal-id": tB.hubspotPortalId,
          "Content-Type": "application/json",
        },
      });
      expect(resB.status).toBe(200);
      const bodyB = (await resB.json()) as {
        tenantId: string;
        evidence: Array<{ tenantId: string }>;
      };
      expect(bodyB.tenantId).toBe(tB.id);
      expect(bodyB.tenantId).not.toBe(tA.id);
      for (const ev of bodyB.evidence) {
        expect(ev.tenantId).toBe(tB.id);
      }
    } finally {
      // Restore original env so sibling test files aren't tainted.
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevDb;
    }
  });
});

// ---------------------------------------------------------------------------
// Restricted suppression — cross-tenant isolation, zero leak
// ---------------------------------------------------------------------------

/**
 * Build a provider adapter that returns restricted evidence only for a
 * specific tenantId. Every row's tenantId is stamped from the caller so the
 * adapter contract (tenant-bound) is honored.
 */
function restrictedForTenant(target: string): ProviderAdapter {
  return {
    name: "test-restricted",
    async fetchSignals(tenantId: string) {
      if (tenantId !== target) return [];
      return [
        {
          id: "ev-restricted-1",
          tenantId,
          source: "internal",
          timestamp: new Date(),
          confidence: 0.95,
          content: "should-never-leak",
          isRestricted: true,
        },
      ];
    },
  };
}

function cleanForTenant(target: string): ProviderAdapter {
  return {
    name: "test-clean",
    async fetchSignals(tenantId: string) {
      if (tenantId !== target) return [];
      return [
        {
          id: "ev-clean-1",
          tenantId,
          source: "hubspot",
          timestamp: new Date(),
          confidence: 0.9,
          content: "B's normal signal",
          isRestricted: false,
        },
      ];
    },
  };
}

describe("cross-tenant: restricted suppression isolation", () => {
  it("tenant A restricted response is empty and carries A's tenantId; tenant B gets its own non-empty snapshot (no cache leak)", async () => {
    const tA = await seedTenant("A");
    const tB = await seedTenant("B");

    // Tenant A has a restricted-only fixture. Tenant B has a clean fixture.
    // Both run through the same assembler with independent adapters — if any
    // cache or memo leaks across tenants, one of the assertions below breaks.
    const snapA = await assembleSnapshot(
      {
        db,
        providerAdapter: restrictedForTenant(tA.id),
        llmAdapter: createMockLlmAdapter({ style: "short" }),
        propertyFetcher: async () => true,
        contactFetcher: async () => [{ id: "c-A-1", name: "Alex A", title: "VP" }],
        thresholds: THRESHOLDS,
      },
      { tenantId: tA.id, companyId: "co-shared" },
    );

    // Zero-leak contract: no evidence, no people, no reason, no trustScore.
    expect(snapA.tenantId).toBe(tA.id);
    expect(snapA.stateFlags.restricted).toBe(true);
    expect(snapA.evidence).toEqual([]);
    expect(snapA.people).toEqual([]);
    expect(snapA.reasonToContact).toBeUndefined();
    expect(snapA.trustScore).toBeUndefined();
    // And crucially, no bit of the restricted evidence content or id leaked.
    const serialized = JSON.stringify(snapA);
    expect(serialized).not.toContain("should-never-leak");
    expect(serialized).not.toContain("ev-restricted-1");

    const snapB = await assembleSnapshot(
      {
        db,
        providerAdapter: cleanForTenant(tB.id),
        llmAdapter: createMockLlmAdapter({ style: "short" }),
        propertyFetcher: async () => true,
        contactFetcher: async () => [{ id: "c-B-1", name: "Blake B", title: "CTO" }],
        thresholds: THRESHOLDS,
      },
      { tenantId: tB.id, companyId: "co-shared" },
    );

    // Tenant B gets its OWN snapshot — not A's empty-restricted.
    expect(snapB.tenantId).toBe(tB.id);
    expect(snapB.stateFlags.restricted).toBe(false);
    expect(snapB.evidence.length).toBeGreaterThan(0);
    for (const ev of snapB.evidence) {
      expect(ev.tenantId).toBe(tB.id);
    }
    expect(snapB.people.length).toBeGreaterThan(0);
    expect(snapB.reasonToContact).toBeDefined();
    // And B's serialized output must not contain A's restricted content.
    const serializedB = JSON.stringify(snapB);
    expect(serializedB).not.toContain("should-never-leak");
  });
});
