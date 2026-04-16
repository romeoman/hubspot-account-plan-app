import { randomUUID } from "node:crypto";
import { createDatabase, signedRequestNonce, tenants } from "@hap/db";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { computeBodyHash, recordNonce } from "../replay-nonce";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const db = createDatabase(DATABASE_URL);
const PORTAL_PREFIX = `nonce-${randomUUID().slice(0, 8)}-`;

function portalId() {
  return `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;
}

async function seedTenant(name: string) {
  const [row] = await db.insert(tenants).values({ hubspotPortalId: portalId(), name }).returning();
  if (!row) {
    throw new Error("failed to seed tenant");
  }
  return row;
}

beforeEach(async () => {
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

afterAll(async () => {
  // postgres.js pool closes on process exit
});

describe("computeBodyHash", () => {
  it("returns a deterministic SHA-256 buffer for the same body", () => {
    const body = JSON.stringify({ portalId: 123, action: "test" });
    const a = computeBodyHash(body);
    const b = computeBodyHash(body);

    expect(Buffer.isBuffer(a)).toBe(true);
    expect(a.equals(b)).toBe(true);
    expect(a.byteLength).toBe(32);
  });

  it("changes when the body content changes", () => {
    const a = computeBodyHash('{"portalId":123}');
    const b = computeBodyHash('{"portalId":124}');
    expect(a.equals(b)).toBe(false);
  });
});

describe("recordNonce", () => {
  it("returns duplicate=false on first insert", async () => {
    const tenant = await seedTenant("Tenant A");
    const timestamp = Date.now();
    const bodyHash = computeBodyHash('{"portalId":"a"}');

    const result = await recordNonce(db, {
      tenantId: tenant.id,
      timestamp,
      bodyHash,
    });

    expect(result).toEqual({ duplicate: false });

    const rows = await db
      .select()
      .from(signedRequestNonce)
      .where(eq(signedRequestNonce.tenantId, tenant.id));
    expect(rows).toHaveLength(1);
  });

  it("returns duplicate=true on the same tenant/timestamp/bodyHash tuple", async () => {
    const tenant = await seedTenant("Tenant A");
    const timestamp = Date.now();
    const bodyHash = computeBodyHash('{"portalId":"a"}');

    await recordNonce(db, {
      tenantId: tenant.id,
      timestamp,
      bodyHash,
    });

    const result = await recordNonce(db, {
      tenantId: tenant.id,
      timestamp,
      bodyHash,
    });

    expect(result).toEqual({ duplicate: true });
  });

  it("allows the same timestamp/bodyHash for a different tenant", async () => {
    const tenantA = await seedTenant("Tenant A");
    const tenantB = await seedTenant("Tenant B");
    const timestamp = Date.now();
    const bodyHash = computeBodyHash('{"portalId":"shared"}');

    const first = await recordNonce(db, {
      tenantId: tenantA.id,
      timestamp,
      bodyHash,
    });
    const second = await recordNonce(db, {
      tenantId: tenantB.id,
      timestamp,
      bodyHash,
    });

    expect(first).toEqual({ duplicate: false });
    expect(second).toEqual({ duplicate: false });
  });

  it("allows a different body hash for the same tenant and timestamp", async () => {
    const tenant = await seedTenant("Tenant A");
    const timestamp = Date.now();

    const first = await recordNonce(db, {
      tenantId: tenant.id,
      timestamp,
      bodyHash: computeBodyHash('{"portalId":"first"}'),
    });
    const second = await recordNonce(db, {
      tenantId: tenant.id,
      timestamp,
      bodyHash: computeBodyHash('{"portalId":"second"}'),
    });

    expect(first).toEqual({ duplicate: false });
    expect(second).toEqual({ duplicate: false });
  });
});
