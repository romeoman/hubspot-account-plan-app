import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../schema";
import { signedRequestNonce, tenantHubspotOauth, tenants } from "../../schema";

/**
 * Slice 3 Task 2 — verifies migrations 0005 (tenant_hubspot_oauth) and
 * 0006 (signed_request_nonce). RLS policies from 0007 are verified in
 * a separate rls.test.ts after the middleware + withTenantTxHandle land.
 *
 * Design invariants these tests enforce (see Slice 3 plan + SECURITY.md §16):
 *   - `tenant_hubspot_oauth.tenant_id` is the PRIMARY KEY (1:1 with tenants).
 *   - NO `hub_id` column exists on `tenant_hubspot_oauth` — portal identity
 *     lives exclusively on `tenants.hubspot_portal_id`.
 *   - `key_version` defaults to 1 and has a CHECK (> 0) constraint.
 *   - `signed_request_nonce` has composite PK (tenant_id, timestamp, body_hash).
 *   - FK cascades from `tenants` to both new tables.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const sql = postgres(DATABASE_URL, { max: 4 });
const db = drizzle(sql, { schema });

const PORTAL_PREFIX = `slice3mig-${randomUUID().slice(0, 8)}-`;

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
  // Cascade clears tenant_hubspot_oauth + signed_request_nonce rows via FK.
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

describe("slice3: tenant_hubspot_oauth", () => {
  it("inserts a row with the minimal required columns and defaults key_version=1", async () => {
    const [t] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "OAuth-Tenant-A" })
      .returning();
    const tenantId = required(t, "tenant").id;

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const [row] = await db
      .insert(tenantHubspotOauth)
      .values({
        tenantId,
        accessTokenEncrypted: "v1:iv:tag:ciphertext-placeholder",
        refreshTokenEncrypted: "v1:iv:tag:refresh-placeholder",
        expiresAt,
        scopes: ["crm.objects.companies.read", "crm.objects.contacts.read"],
      })
      .returning();

    expect(row?.tenantId).toBe(tenantId);
    expect(row?.keyVersion).toBe(1);
    expect(row?.scopes).toEqual(["crm.objects.companies.read", "crm.objects.contacts.read"]);
    expect(row?.accessTokenEncrypted).toBe("v1:iv:tag:ciphertext-placeholder");
    expect(row?.refreshTokenEncrypted).toBe("v1:iv:tag:refresh-placeholder");
    expect(row?.expiresAt).toEqual(expiresAt);
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it("rejects key_version <= 0 via CHECK constraint", async () => {
    const [t] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "OAuth-Tenant-B" })
      .returning();
    const tenantId = required(t, "tenant").id;

    await expect(
      db.insert(tenantHubspotOauth).values({
        tenantId,
        accessTokenEncrypted: "x",
        refreshTokenEncrypted: "y",
        expiresAt: new Date(),
        scopes: [],
        keyVersion: 0,
      }),
    ).rejects.toThrow();
  });

  it("enforces 1:1 relationship — second insert for same tenant_id conflicts", async () => {
    const [t] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "OAuth-Tenant-C" })
      .returning();
    const tenantId = required(t, "tenant").id;

    await db.insert(tenantHubspotOauth).values({
      tenantId,
      accessTokenEncrypted: "a1",
      refreshTokenEncrypted: "r1",
      expiresAt: new Date(),
      scopes: [],
    });

    await expect(
      db.insert(tenantHubspotOauth).values({
        tenantId,
        accessTokenEncrypted: "a2",
        refreshTokenEncrypted: "r2",
        expiresAt: new Date(),
        scopes: [],
      }),
    ).rejects.toThrow();
  });

  it("cascades on tenant delete", async () => {
    const [t] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "OAuth-Tenant-D" })
      .returning();
    const tenantId = required(t, "tenant").id;

    await db.insert(tenantHubspotOauth).values({
      tenantId,
      accessTokenEncrypted: "a",
      refreshTokenEncrypted: "r",
      expiresAt: new Date(),
      scopes: [],
    });

    await db.delete(tenants).where(eq(tenants.id, tenantId));

    const remaining = await db
      .select()
      .from(tenantHubspotOauth)
      .where(eq(tenantHubspotOauth.tenantId, tenantId));
    expect(remaining).toHaveLength(0);
  });

  it("does NOT have a hub_id column (portal identity lives on tenants.hubspot_portal_id)", async () => {
    const cols = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'tenant_hubspot_oauth'
    `;
    const names = cols.map((c) => c.column_name);
    expect(names).not.toContain("hub_id");
    expect(names).not.toContain("hubspot_portal_id");
  });
});

describe("slice3: signed_request_nonce", () => {
  it("inserts a nonce row and round-trips tenant_id, timestamp, body_hash", async () => {
    const [t] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "Nonce-Tenant-A" })
      .returning();
    const tenantId = required(t, "tenant").id;

    const timestamp = Date.now();
    const bodyHash = Buffer.from("a".repeat(32), "utf8");

    const [row] = await db
      .insert(signedRequestNonce)
      .values({ tenantId, timestamp, bodyHash })
      .returning();

    expect(row?.tenantId).toBe(tenantId);
    expect(row?.timestamp).toBe(timestamp);
    expect(Buffer.from(row?.bodyHash ?? []).equals(bodyHash)).toBe(true);
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it("rejects duplicate (tenant_id, timestamp, body_hash) via PK", async () => {
    const [t] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "Nonce-Tenant-B" })
      .returning();
    const tenantId = required(t, "tenant").id;

    const timestamp = Date.now();
    const bodyHash = Buffer.from("b".repeat(32), "utf8");

    await db.insert(signedRequestNonce).values({ tenantId, timestamp, bodyHash });

    await expect(
      db.insert(signedRequestNonce).values({ tenantId, timestamp, bodyHash }),
    ).rejects.toThrow();
  });

  it("allows two tenants to use identical (timestamp, body_hash) independently", async () => {
    const [tA] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "Nonce-Tenant-C" })
      .returning();
    const [tB] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "Nonce-Tenant-D" })
      .returning();
    const tenantA = required(tA, "tA").id;
    const tenantB = required(tB, "tB").id;

    const timestamp = Date.now();
    const bodyHash = Buffer.from("c".repeat(32), "utf8");

    await db.insert(signedRequestNonce).values({ tenantId: tenantA, timestamp, bodyHash });
    await db.insert(signedRequestNonce).values({ tenantId: tenantB, timestamp, bodyHash });

    const rows = await db
      .select()
      .from(signedRequestNonce)
      .where(
        and(eq(signedRequestNonce.timestamp, timestamp), eq(signedRequestNonce.bodyHash, bodyHash)),
      );
    expect(rows).toHaveLength(2);
  });

  it("cascades on tenant delete", async () => {
    const [t] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "Nonce-Tenant-E" })
      .returning();
    const tenantId = required(t, "tenant").id;

    await db.insert(signedRequestNonce).values({
      tenantId,
      timestamp: Date.now(),
      bodyHash: Buffer.from("d".repeat(32), "utf8"),
    });

    await db.delete(tenants).where(eq(tenants.id, tenantId));

    const remaining = await db
      .select()
      .from(signedRequestNonce)
      .where(eq(signedRequestNonce.tenantId, tenantId));
    expect(remaining).toHaveLength(0);
  });
});
