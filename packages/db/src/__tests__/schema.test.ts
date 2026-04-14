import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../schema";
import { evidence, llmConfig, people, providerConfig, snapshots, tenants } from "../schema";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const sql = postgres(DATABASE_URL, { max: 4 });
const db = drizzle(sql, { schema });

function portalId() {
  return `portal-${randomUUID().slice(0, 8)}`;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
}

beforeAll(async () => {
  // Sanity check connection
  await sql`SELECT 1`;
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

beforeEach(async () => {
  // Clean slate — cascade deletes children
  await sql`DELETE FROM tenants`;
});

describe("schema: tenants", () => {
  it("inserts and selects a tenant with settings jsonb", async () => {
    const [inserted] = await db
      .insert(tenants)
      .values({
        hubspotPortalId: portalId(),
        name: "Acme",
        settings: { region: "us" },
      })
      .returning();
    expect(inserted?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(inserted?.settings).toEqual({ region: "us" });
    expect(inserted?.isActive).toBe(true);
  });
});

describe("schema: tenant isolation + cascade", () => {
  it("cascade-deletes snapshots, evidence, and people when tenant is removed", async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "T1" })
      .returning();
    const tenantId = required(tenant, "tenant").id;

    const [snap] = await db
      .insert(snapshots)
      .values({
        tenantId,
        companyId: "company-1",
        eligibilityState: "eligible",
        stateFlags: {
          stale: false,
          degraded: false,
          lowConfidence: false,
          ineligible: false,
          restricted: false,
          empty: false,
        },
      })
      .returning();

    await db.insert(evidence).values({
      tenantId,
      snapshotId: required(snap, "snap").id,
      source: "mock",
      timestamp: new Date(),
      confidence: "0.9",
      content: "evidence content",
    });

    await db.insert(people).values({
      tenantId,
      snapshotId: required(snap, "snap").id,
      name: "Jane",
      title: "VP Eng",
      reasonToTalk: "Recent job change",
      evidenceRefs: [],
    });

    // Delete tenant — should cascade
    await db.delete(tenants).where(eq(tenants.id, tenantId));

    const remainingSnapshots = await db
      .select()
      .from(snapshots)
      .where(eq(snapshots.tenantId, tenantId));
    const remainingEvidence = await db
      .select()
      .from(evidence)
      .where(eq(evidence.tenantId, tenantId));
    const remainingPeople = await db.select().from(people).where(eq(people.tenantId, tenantId));

    expect(remainingSnapshots).toHaveLength(0);
    expect(remainingEvidence).toHaveLength(0);
    expect(remainingPeople).toHaveLength(0);
  });

  it("isolates queries by tenant_id (no cross-tenant leakage)", async () => {
    const [t1] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "A" })
      .returning();
    const [t2] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "B" })
      .returning();

    await db.insert(snapshots).values([
      {
        tenantId: required(t1, "t1").id,
        companyId: "co-a",
        eligibilityState: "eligible",
        stateFlags: {},
      },
      {
        tenantId: required(t2, "t2").id,
        companyId: "co-b",
        eligibilityState: "eligible",
        stateFlags: {},
      },
    ]);

    const t1Snaps = await db
      .select()
      .from(snapshots)
      .where(eq(snapshots.tenantId, required(t1, "t1").id));
    const t2Snaps = await db
      .select()
      .from(snapshots)
      .where(eq(snapshots.tenantId, required(t2, "t2").id));

    expect(t1Snaps).toHaveLength(1);
    expect(t1Snaps[0]?.companyId).toBe("co-a");
    expect(t2Snaps).toHaveLength(1);
    expect(t2Snaps[0]?.companyId).toBe("co-b");
  });

  it("rejects snapshot insert with non-existent tenant_id (FK violation)", async () => {
    let caught: unknown;
    try {
      await db.insert(snapshots).values({
        tenantId: randomUUID(),
        companyId: "co-x",
        eligibilityState: "eligible",
        stateFlags: {},
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    // postgres.js PostgresError SQLSTATE 23503 = foreign_key_violation
    const cause = (caught as { cause?: { code?: string } })?.cause;
    expect(cause?.code).toBe("23503");
  });
});

describe("schema: provider_config + llm_config unique constraints", () => {
  it("enforces unique (tenant_id, provider_name) on provider_config", async () => {
    const [t] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "U" })
      .returning();

    await db.insert(providerConfig).values({
      tenantId: required(t, "t").id,
      providerName: "exa",
      enabled: true,
    });

    let caught: unknown;
    try {
      await db.insert(providerConfig).values({
        tenantId: required(t, "t").id,
        providerName: "exa",
        enabled: false,
      });
    } catch (err) {
      caught = err;
    }
    // postgres.js PostgresError SQLSTATE 23505 = unique_violation
    expect((caught as { cause?: { code?: string } })?.cause?.code).toBe("23505");
  });

  it("enforces unique (tenant_id, provider_name) on llm_config", async () => {
    const [t] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "U2" })
      .returning();

    await db.insert(llmConfig).values({
      tenantId: required(t, "t").id,
      providerName: "anthropic",
      modelName: "claude-3-5-sonnet",
    });

    let caught: unknown;
    try {
      await db.insert(llmConfig).values({
        tenantId: required(t, "t").id,
        providerName: "anthropic",
        modelName: "claude-3-opus",
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as { cause?: { code?: string } })?.cause?.code).toBe("23505");
  });

  it("allows same provider_name across different tenants", async () => {
    const [t1] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "X" })
      .returning();
    const [t2] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "Y" })
      .returning();

    await db.insert(providerConfig).values({
      tenantId: required(t1, "t1").id,
      providerName: "exa",
      enabled: true,
    });
    await db.insert(providerConfig).values({
      tenantId: required(t2, "t2").id,
      providerName: "exa",
      enabled: true,
    });

    const rows = await db
      .select()
      .from(providerConfig)
      .where(and(eq(providerConfig.providerName, "exa")));
    expect(rows).toHaveLength(2);
  });
});
