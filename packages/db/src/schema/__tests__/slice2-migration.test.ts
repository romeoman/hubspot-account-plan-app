import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../schema";
import { llmConfig, providerConfig, tenants } from "../../schema";

/**
 * Slice 2 Step 2 — verifies the four new columns on provider_config and
 * llm_config: key_version, rate_limit_config, allow_list, block_list.
 *
 * The tests ALSO re-verify tenant isolation to confirm the migration did
 * not silently loosen row scoping.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const sql = postgres(DATABASE_URL, { max: 4 });
const db = drizzle(sql, { schema });

const PORTAL_PREFIX = `slice2mig-${randomUUID().slice(0, 8)}-`;

function portalId() {
  return `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
}

beforeAll(async () => {
  await sql`SELECT 1`;
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

beforeEach(async () => {
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

describe("slice2: provider_config new columns", () => {
  it("defaults key_version to 1 when omitted on insert", async () => {
    const [t] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "P1" })
      .returning();
    const tenantId = required(t, "t").id;

    const [row] = await db
      .insert(providerConfig)
      .values({ tenantId, providerName: "exa", enabled: true })
      .returning();

    expect(row?.keyVersion).toBe(1);
    expect(row?.rateLimitConfig).toBeNull();
    expect(row?.allowList).toBeNull();
    expect(row?.blockList).toBeNull();
  });

  it("roundtrips explicit key_version=2 and jsonb columns", async () => {
    const [t] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "P2" })
      .returning();
    const tenantId = required(t, "t").id;

    const [row] = await db
      .insert(providerConfig)
      .values({
        tenantId,
        providerName: "exa",
        enabled: true,
        keyVersion: 2,
        rateLimitConfig: { requestsPerMinute: 60 },
        allowList: ["exa.com"],
        blockList: ["blocked.example.com"],
      })
      .returning();

    expect(row?.keyVersion).toBe(2);
    expect(row?.rateLimitConfig).toEqual({ requestsPerMinute: 60 });
    expect(row?.allowList).toEqual(["exa.com"]);
    expect(row?.blockList).toEqual(["blocked.example.com"]);
  });
});

describe("slice2: llm_config new columns", () => {
  it("defaults key_version to 1 when omitted on insert", async () => {
    const [t] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "L1" })
      .returning();
    const tenantId = required(t, "t").id;

    const [row] = await db
      .insert(llmConfig)
      .values({
        tenantId,
        providerName: "anthropic",
        modelName: "claude-3-5-sonnet",
      })
      .returning();

    expect(row?.keyVersion).toBe(1);
    expect(row?.rateLimitConfig).toBeNull();
    expect(row?.allowList).toBeNull();
    expect(row?.blockList).toBeNull();
  });

  it("roundtrips jsonb rate/allow/block and explicit key_version", async () => {
    const [t] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "L2" })
      .returning();
    const tenantId = required(t, "t").id;

    const [row] = await db
      .insert(llmConfig)
      .values({
        tenantId,
        providerName: "anthropic",
        modelName: "claude-3-5-sonnet",
        keyVersion: 3,
        rateLimitConfig: { requestsPerMinute: 30, tokensPerMinute: 100_000 },
        allowList: ["api.anthropic.com"],
        blockList: ["evil.example.com"],
      })
      .returning();

    expect(row?.keyVersion).toBe(3);
    expect(row?.rateLimitConfig).toEqual({
      requestsPerMinute: 30,
      tokensPerMinute: 100_000,
    });
    expect(row?.allowList).toEqual(["api.anthropic.com"]);
    expect(row?.blockList).toEqual(["evil.example.com"]);
  });
});

describe("slice2: cross-tenant isolation still holds", () => {
  it("provider_config rows do not leak across tenants after migration", async () => {
    const [t1] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "I1" })
      .returning();
    const [t2] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "I2" })
      .returning();
    const t1Id = required(t1, "t1").id;
    const t2Id = required(t2, "t2").id;

    await db.insert(providerConfig).values({
      tenantId: t1Id,
      providerName: "exa",
      enabled: true,
      allowList: ["only-tenant-1.example.com"],
    });

    const t2View = await db
      .select()
      .from(providerConfig)
      .where(and(eq(providerConfig.tenantId, t2Id), eq(providerConfig.providerName, "exa")));

    expect(t2View).toHaveLength(0);

    const t1View = await db
      .select()
      .from(providerConfig)
      .where(and(eq(providerConfig.tenantId, t1Id), eq(providerConfig.providerName, "exa")));
    expect(t1View).toHaveLength(1);
    expect(t1View[0]?.allowList).toEqual(["only-tenant-1.example.com"]);
  });
});
