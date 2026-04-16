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

import { randomBytes, randomUUID } from "node:crypto";
import {
  fixtureEmpty,
  fixtureIneligible,
  fixtureRestricted,
  type LlmProviderConfig,
  type ProviderConfig as ProviderConfigDomain,
} from "@hap/config";
import {
  createDatabase,
  evidence as evidenceTable,
  llmConfig,
  people as peopleTable,
  providerConfig,
  snapshots as snapshotsTable,
  tenants,
} from "@hap/db";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createLlmAdapter, wrapWithGuards } from "../adapters/llm/factory";
import type { LlmAdapter } from "../adapters/llm-adapter";
import { createMockLlmAdapter } from "../adapters/mock-llm-adapter";
import type { ProviderAdapter } from "../adapters/provider-adapter";
import { createSignalAdapter, wrapSignalWithGuards } from "../adapters/signal/factory";
import {
  clearConfigResolverCache,
  getLlmConfigByProvider,
  getProviderConfig,
  invalidateTenantConfig,
} from "../lib/config-resolver";
import { decryptProviderKey, encryptProviderKey } from "../lib/encryption";
import { deriveTenantKek } from "../lib/kek";
import { __setLogSinkForTests, withObservability } from "../lib/observability";
import { createRateLimiter } from "../lib/rate-limiter";
import {
  checkEligibility,
  clearEligibilityCache,
  DEFAULT_ELIGIBILITY_PROPERTY,
} from "../services/eligibility";
import { generateNextMove } from "../services/next-move";
import { assembleSnapshot } from "../services/snapshot-assembler";
import { createTrustEvaluator } from "../services/trust";

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

    // Slice 2: cross-tenant decrypt fails the AES-GCM auth tag check.
    expect(() => decryptProviderKey(tA.id, ctForB)).toThrow(/authentication failed/);
  });

  it("each tenant can decrypt only its own ciphertext", async () => {
    const tA = await seedTenant("A");
    const tB = await seedTenant("B");
    const ctA = encryptProviderKey(tA.id, "secret-A");
    const ctB = encryptProviderKey(tB.id, "secret-B");

    expect(decryptProviderKey(tA.id, ctA)).toBe("secret-A");
    expect(decryptProviderKey(tB.id, ctB)).toBe("secret-B");
    expect(() => decryptProviderKey(tA.id, ctB)).toThrow(/authentication failed/);
    expect(() => decryptProviderKey(tB.id, ctA)).toThrow(/authentication failed/);
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
          // 1 hour ago — must be strictly in the past so the assembler's
          // earlier `now` capture doesn't see this as "future-dated" (which
          // the trust evaluator + dominant-signal filter now reject).
          timestamp: new Date(Date.now() - 60 * 60 * 1000),
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

// ===========================================================================
// SLICE 2 ASSERTIONS — every new surface must preserve tenant isolation.
// ===========================================================================

// ---------------------------------------------------------------------------
// (a) Encryption / KEK isolation — Step 3
// ---------------------------------------------------------------------------

describe("cross-tenant slice-2: encryption + KEK", () => {
  it("tenant A encrypts → tenant B decrypt throws AES-GCM auth failure", async () => {
    const tA = await seedTenant("A");
    const tB = await seedTenant("B");

    const ct = encryptProviderKey(tA.id, "plaintext-A");
    // Cross-tenant decrypt MUST fail the GCM auth tag check. The collapsed
    // error message carries no tenantId, plaintext, or ciphertext fragment.
    expect(() => decryptProviderKey(tB.id, ct)).toThrow(/authentication failed/);
    // And A can still decrypt its own ciphertext.
    expect(decryptProviderKey(tA.id, ct)).toBe("plaintext-A");
  });

  it("same plaintext + same tenant encrypted twice produces different ciphertexts (random IV)", async () => {
    const tA = await seedTenant("A");
    const c1 = encryptProviderKey(tA.id, "same-secret");
    const c2 = encryptProviderKey(tA.id, "same-secret");
    expect(c1).not.toBe(c2);
    // Both must still decrypt to the same plaintext.
    expect(decryptProviderKey(tA.id, c1)).toBe("same-secret");
    expect(decryptProviderKey(tA.id, c2)).toBe("same-secret");
    // The IV segment (parts[1]) should differ.
    const iv1 = c1.split(":")[1];
    const iv2 = c2.split(":")[1];
    expect(iv1).not.toBe(iv2);
  });

  it("deriveTenantKek produces distinct 32-byte keys for different tenantIds", () => {
    const rootKek = randomBytes(32);
    const kekA = deriveTenantKek(rootKek, "tenant-a");
    const kekB = deriveTenantKek(rootKek, "tenant-b");
    expect(kekA.length).toBe(32);
    expect(kekB.length).toBe(32);
    expect(kekA.equals(kekB)).toBe(false);
    // Deterministic for same inputs (required — else we can't decrypt old CT).
    const kekA2 = deriveTenantKek(rootKek, "tenant-a");
    expect(kekA.equals(kekA2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (b) LLM factory isolation — Step 8
// ---------------------------------------------------------------------------

describe("cross-tenant slice-2: LLM factory", () => {
  it("createLlmAdapter wires different decrypted keys per tenant (same provider)", async () => {
    const tA = await seedTenant("A");
    const tB = await seedTenant("B");

    // Seed per-tenant llm_config rows with distinct encrypted keys for the
    // SAME provider — the riskiest cross-tenant collision case.
    await db.insert(llmConfig).values({
      tenantId: tA.id,
      providerName: "openai",
      modelName: "gpt-4o-mini",
      apiKeyEncrypted: encryptProviderKey(tA.id, "sk-tenantA-key"),
    });
    await db.insert(llmConfig).values({
      tenantId: tB.id,
      providerName: "openai",
      modelName: "gpt-4o-mini",
      apiKeyEncrypted: encryptProviderKey(tB.id, "sk-tenantB-key"),
    });

    const cfgA = await getLlmConfigByProvider({ db }, { tenantId: tA.id, provider: "openai" });
    const cfgB = await getLlmConfigByProvider({ db }, { tenantId: tB.id, provider: "openai" });

    expect(cfgA?.apiKeyRef).toBe("sk-tenantA-key");
    expect(cfgB?.apiKeyRef).toBe("sk-tenantB-key");
    expect(cfgA?.apiKeyRef).not.toBe(cfgB?.apiKeyRef);

    // The factory consumes the already-decrypted config — each adapter must
    // carry its tenant's key. We confirm structurally: the factory closure
    // itself is tenant-agnostic, so passing cfgA vs cfgB yields adapters
    // whose internal apiKey matches their input.
    const adapterA = createLlmAdapter(cfgA as LlmProviderConfig);
    const adapterB = createLlmAdapter(cfgB as LlmProviderConfig);
    expect(adapterA.provider).toBe("openai");
    expect(adapterB.provider).toBe("openai");
    // Adapters are DIFFERENT instances (no accidental singleton).
    expect(adapterA).not.toBe(adapterB);
  });

  it("getLlmConfigByProvider: tenant A cached config does not leak to tenant B", async () => {
    const tA = await seedTenant("A");
    const tB = await seedTenant("B");

    await db.insert(llmConfig).values({
      tenantId: tA.id,
      providerName: "openai",
      modelName: "gpt-4o-mini",
      apiKeyEncrypted: encryptProviderKey(tA.id, "sk-A"),
    });

    // Warm A's cache for openai.
    const a1 = await getLlmConfigByProvider({ db }, { tenantId: tA.id, provider: "openai" });
    expect(a1?.apiKeyRef).toBe("sk-A");

    // Tenant B has no openai row — must NOT see A's cached value.
    const b1 = await getLlmConfigByProvider({ db }, { tenantId: tB.id, provider: "openai" });
    expect(b1).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (c) Signal factory isolation — Step 9
// ---------------------------------------------------------------------------

describe("cross-tenant slice-2: signal factory", () => {
  it("createSignalAdapter wires different decrypted keys per tenant (same provider)", async () => {
    const tA = await seedTenant("A");
    const tB = await seedTenant("B");

    await db.insert(providerConfig).values({
      tenantId: tA.id,
      providerName: "exa",
      enabled: true,
      apiKeyEncrypted: encryptProviderKey(tA.id, "exa-A"),
      thresholds: {},
      settings: {},
    });
    await db.insert(providerConfig).values({
      tenantId: tB.id,
      providerName: "exa",
      enabled: true,
      apiKeyEncrypted: encryptProviderKey(tB.id, "exa-B"),
      thresholds: {},
      settings: {},
    });

    const cfgA = await getProviderConfig({ db }, { tenantId: tA.id, providerName: "exa" });
    const cfgB = await getProviderConfig({ db }, { tenantId: tB.id, providerName: "exa" });

    expect(cfgA?.apiKeyRef).toBe("exa-A");
    expect(cfgB?.apiKeyRef).toBe("exa-B");
    expect(cfgA?.apiKeyRef).not.toBe(cfgB?.apiKeyRef);

    const adapterA = createSignalAdapter(cfgA as ProviderConfigDomain);
    const adapterB = createSignalAdapter(cfgB as ProviderConfigDomain);
    expect(adapterA.name).toBe("exa");
    expect(adapterB.name).toBe("exa");
    expect(adapterA).not.toBe(adapterB);
  });

  it("applyAllowBlockLists is per-tenant: A's block list does NOT affect B's filtering", () => {
    // Build two evidence batches under two tenant IDs. Apply tenant-A's lists
    // ONLY to tenant-A's evidence, and tenant-B's lists ONLY to tenant-B's
    // — the function is pure + list-scoped, so the test is structural: A's
    // block list cannot see B's evidence because nothing passes it there.
    const trust = createTrustEvaluator();
    const tenantAEvidence = [
      {
        id: "ev-a-1",
        tenantId: "tenant-a",
        source: "blocked-by-a.com",
        timestamp: new Date(),
        confidence: 0.8,
        content: "A's signal",
        isRestricted: false,
      },
    ];
    const tenantBEvidence = [
      {
        id: "ev-b-1",
        tenantId: "tenant-b",
        source: "blocked-by-a.com", // Same domain — B does NOT block it.
        timestamp: new Date(),
        confidence: 0.8,
        content: "B's signal",
        isRestricted: false,
      },
    ];

    const afterA = trust.applyAllowBlockLists(tenantAEvidence, {
      block: ["blocked-by-a.com"],
    });
    const afterB = trust.applyAllowBlockLists(tenantBEvidence, {
      // B has its own — unrelated — block list. Not affected by A's.
      block: ["different-domain.com"],
    });

    expect(afterA.length).toBe(0); // A's block list rejected A's evidence.
    expect(afterB.length).toBe(1); // B's evidence survived (A's block list is not applied).
    expect(afterB[0]?.tenantId).toBe("tenant-b");
  });
});

// ---------------------------------------------------------------------------
// (d) Rate limiter isolation — Step 7
// ---------------------------------------------------------------------------

describe("cross-tenant slice-2: rate limiter", () => {
  it("exhausting (tenantA, exa) does NOT affect (tenantA, openai)", async () => {
    const limiter = createRateLimiter();
    const cfg = { capacity: 2, refillRatePerSec: 0.001 };

    // Drain tenant-a's exa bucket to zero.
    expect((await limiter.acquire("tenant-a", "exa", cfg)).allowed).toBe(true);
    expect((await limiter.acquire("tenant-a", "exa", cfg)).allowed).toBe(true);
    expect((await limiter.acquire("tenant-a", "exa", cfg)).allowed).toBe(false);

    // openai bucket for the SAME tenant is independent.
    expect((await limiter.acquire("tenant-a", "openai", cfg)).allowed).toBe(true);
    expect((await limiter.acquire("tenant-a", "openai", cfg)).allowed).toBe(true);
  });

  it("exhausting (tenantA, exa) does NOT affect (tenantB, exa)", async () => {
    const limiter = createRateLimiter();
    const cfg = { capacity: 2, refillRatePerSec: 0.001 };

    expect((await limiter.acquire("tenant-a", "exa", cfg)).allowed).toBe(true);
    expect((await limiter.acquire("tenant-a", "exa", cfg)).allowed).toBe(true);
    expect((await limiter.acquire("tenant-a", "exa", cfg)).allowed).toBe(false);

    // Tenant B's bucket has its full capacity.
    expect((await limiter.acquire("tenant-b", "exa", cfg)).allowed).toBe(true);
    expect((await limiter.acquire("tenant-b", "exa", cfg)).allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (e) Observability redaction — Step 7
// ---------------------------------------------------------------------------

describe("cross-tenant slice-2: observability redaction", () => {
  // Allow-list schema: exactly these fields are permitted in any log line.
  const ALLOWED_FIELDS = new Set([
    "correlationId",
    "tenantId",
    "provider",
    "operation",
    "phase",
    "latencyMs",
    "outcome",
    "errorClass",
    "tokenUsage",
  ]);

  it("withObservability emits only allow-listed fields; never leaks inner-fn payloads", async () => {
    const captured: Array<Record<string, unknown>> = [];
    __setLogSinkForTests((line) => captured.push(line));
    try {
      const successVal = { secretPayload: "THIS-MUST-NEVER-APPEAR-IN-LOGS" };
      await withObservability(async () => successVal, {
        tenantId: "tenant-a",
        provider: "exa",
        operation: "signal.fetch",
      });

      await expect(
        withObservability(
          async () => {
            throw new Error("provider error with SECRET_URL_IN_MESSAGE");
          },
          {
            tenantId: "tenant-a",
            provider: "exa",
            operation: "signal.fetch",
          },
        ),
      ).rejects.toThrow(/SECRET_URL_IN_MESSAGE/);

      expect(captured.length).toBeGreaterThanOrEqual(3);
      for (const line of captured) {
        // Schema: every field name MUST be in the allow-list.
        for (const key of Object.keys(line)) {
          expect(ALLOWED_FIELDS.has(key), `unexpected field in log line: ${key}`).toBe(true);
        }
        // Tenant belongs to this request.
        expect(line.tenantId).toBe("tenant-a");
      }
      // Serialize all captured lines and assert no payload / error message leakage.
      const all = JSON.stringify(captured);
      expect(all).not.toContain("THIS-MUST-NEVER-APPEAR-IN-LOGS");
      expect(all).not.toContain("SECRET_URL_IN_MESSAGE");
      expect(all).not.toContain("secretPayload");
    } finally {
      __setLogSinkForTests(null);
    }
  });

  it("consecutive requests for tenant A then B do not cross-leak identifiers", async () => {
    const captured: Array<Record<string, unknown>> = [];
    __setLogSinkForTests((line) => captured.push(line));
    try {
      await withObservability(async () => "ok-a", {
        tenantId: "tenant-a",
        provider: "openai",
        operation: "llm.complete",
      });
      const splitIdx = captured.length;
      await withObservability(async () => "ok-b", {
        tenantId: "tenant-b",
        provider: "openai",
        operation: "llm.complete",
      });

      const aLines = captured.slice(0, splitIdx);
      const bLines = captured.slice(splitIdx);
      expect(aLines.length).toBeGreaterThan(0);
      expect(bLines.length).toBeGreaterThan(0);

      for (const line of aLines) {
        expect(line.tenantId).toBe("tenant-a");
        expect(line.tenantId).not.toBe("tenant-b");
      }
      for (const line of bLines) {
        expect(line.tenantId).toBe("tenant-b");
        expect(line.tenantId).not.toBe("tenant-a");
        // B's log lines must not contain A's correlationId either.
        const aCorrIds = new Set(aLines.map((l) => l.correlationId as string));
        expect(aCorrIds.has(line.correlationId as string)).toBe(false);
      }
    } finally {
      __setLogSinkForTests(null);
    }
  });
});

// ---------------------------------------------------------------------------
// (f) Next-move zero-leak end-to-end — Step 13
// ---------------------------------------------------------------------------

describe("cross-tenant slice-2: next-move zero-leak short-circuit", () => {
  function spyAdapter(): LlmAdapter & { complete: ReturnType<typeof vi.fn> } {
    const adapter = {
      provider: "openai",
      complete: vi.fn(async () => ({
        content: "SHOULD NEVER BE RETURNED",
        usage: { inputTokens: 0, outputTokens: 0 },
      })),
    };
    return adapter;
  }

  it("restricted snapshot → returns null AND LLM NEVER invoked", async () => {
    const adapter = spyAdapter();
    const snap = fixtureRestricted("tenant-a");
    const out = await generateNextMove({ snapshot: snap, llmAdapter: adapter });
    expect(out).toBeNull();
    expect(adapter.complete).toHaveBeenCalledTimes(0);
  });

  it("ineligible snapshot → returns null AND LLM NEVER invoked", async () => {
    const adapter = spyAdapter();
    const snap = fixtureIneligible("tenant-a");
    const out = await generateNextMove({ snapshot: snap, llmAdapter: adapter });
    expect(out).toBeNull();
    expect(adapter.complete).toHaveBeenCalledTimes(0);
  });

  it("empty snapshot → returns null AND LLM NEVER invoked", async () => {
    const adapter = spyAdapter();
    const snap = fixtureEmpty("tenant-a");
    const out = await generateNextMove({ snapshot: snap, llmAdapter: adapter });
    expect(out).toBeNull();
    expect(adapter.complete).toHaveBeenCalledTimes(0);
  });

  it("no-reason snapshot (whitespace-only reasonToContact) → returns null AND LLM NEVER invoked", async () => {
    const adapter = spyAdapter();
    const snap = fixtureEmpty("tenant-a");
    // Override: simulate an eligible-shaped snapshot whose reason is "   ".
    const mutated = {
      ...snap,
      reasonToContact: "   ",
      stateFlags: { ...snap.stateFlags, empty: false },
    };
    const out = await generateNextMove({
      snapshot: mutated,
      llmAdapter: adapter,
    });
    expect(out).toBeNull();
    expect(adapter.complete).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// (g) Cache key / tag isolation — Step 6
// ---------------------------------------------------------------------------

describe("cross-tenant slice-2: cache key isolation", () => {
  it("invalidateTenantConfig(A) flushes only A's entries; B's cached configs survive", async () => {
    const tA = await seedTenant("A");
    const tB = await seedTenant("B");

    await db.insert(providerConfig).values({
      tenantId: tA.id,
      providerName: "exa",
      enabled: true,
      apiKeyEncrypted: encryptProviderKey(tA.id, "exa-A"),
      thresholds: {},
      settings: {},
    });
    await db.insert(providerConfig).values({
      tenantId: tB.id,
      providerName: "exa",
      enabled: true,
      apiKeyEncrypted: encryptProviderKey(tB.id, "exa-B"),
      thresholds: {},
      settings: {},
    });

    // Warm both caches.
    const a1 = await getProviderConfig({ db }, { tenantId: tA.id, providerName: "exa" });
    const b1 = await getProviderConfig({ db }, { tenantId: tB.id, providerName: "exa" });
    expect(a1?.apiKeyRef).toBe("exa-A");
    expect(b1?.apiKeyRef).toBe("exa-B");

    // Flip A's DB row to a new key, then invalidate ONLY A.
    await db
      .update(providerConfig)
      .set({ apiKeyEncrypted: encryptProviderKey(tA.id, "exa-A-rotated") })
      .where(and(eq(providerConfig.tenantId, tA.id), eq(providerConfig.providerName, "exa")));
    await db
      .update(providerConfig)
      .set({ apiKeyEncrypted: encryptProviderKey(tB.id, "exa-B-rotated") })
      .where(and(eq(providerConfig.tenantId, tB.id), eq(providerConfig.providerName, "exa")));

    invalidateTenantConfig(tA.id);

    // A re-reads and gets the rotated key.
    const a2 = await getProviderConfig({ db }, { tenantId: tA.id, providerName: "exa" });
    expect(a2?.apiKeyRef).toBe("exa-A-rotated");

    // B's cached entry was NOT flushed — still returns the pre-rotation value.
    const b2 = await getProviderConfig({ db }, { tenantId: tB.id, providerName: "exa" });
    expect(b2?.apiKeyRef).toBe("exa-B"); // still cached; NOT B-rotated.
  });
});

// ---------------------------------------------------------------------------
// (h) Guard-wrapper end-to-end cross-tenant sanity (rate limiter + observability)
// ---------------------------------------------------------------------------

describe("cross-tenant slice-2: guard-wrapper cross-leak check", () => {
  it("wrapWithGuards + wrapSignalWithGuards keep tenants' rate-limit buckets independent", async () => {
    const limiter = createRateLimiter();
    const cfg = { capacity: 1, refillRatePerSec: 0.001 };

    // Build identical inner adapters for both tenants.
    const makeInner = (): LlmAdapter => ({
      provider: "openai",
      complete: vi.fn(async () => ({
        content: "ok",
        usage: { inputTokens: 1, outputTokens: 1 },
      })),
    });

    const wrappedA = wrapWithGuards(makeInner(), {
      tenantId: "tenant-a",
      rateLimiter: limiter,
      rateLimitConfig: cfg,
    });
    const wrappedB = wrapWithGuards(makeInner(), {
      tenantId: "tenant-b",
      rateLimiter: limiter,
      rateLimitConfig: cfg,
    });

    // Silence log output for this check.
    __setLogSinkForTests(() => {});
    try {
      // A spends its 1-token capacity.
      await wrappedA.complete("hi");
      // A is now rate-limited — next call throws.
      await expect(wrappedA.complete("hi")).rejects.toThrow(/rate-limited/);
      // B is unaffected.
      await expect(wrappedB.complete("hi")).resolves.toBeDefined();

      // Same for signal side.
      const innerSignalA: ProviderAdapter = {
        name: "exa",
        fetchSignals: vi.fn(async () => []),
      };
      const innerSignalB: ProviderAdapter = {
        name: "exa",
        fetchSignals: vi.fn(async () => []),
      };
      const wSignalA = wrapSignalWithGuards(innerSignalA, {
        tenantId: "tenant-a",
        rateLimiter: limiter,
        rateLimitConfig: cfg,
      });
      const wSignalB = wrapSignalWithGuards(innerSignalB, {
        tenantId: "tenant-b",
        rateLimiter: limiter,
        rateLimitConfig: cfg,
      });

      await wSignalA.fetchSignals("tenant-a", { companyId: "co-acme", companyName: "Acme" });
      await expect(
        wSignalA.fetchSignals("tenant-a", { companyId: "co-acme", companyName: "Acme" }),
      ).rejects.toThrow(/rate-limited/);
      await expect(
        wSignalB.fetchSignals("tenant-b", { companyId: "co-acme", companyName: "Acme" }),
      ).resolves.toBeDefined();
    } finally {
      __setLogSinkForTests(null);
    }
  });
});
