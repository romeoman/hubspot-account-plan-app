import { randomUUID } from "node:crypto";
import { createDatabase, type Database, sql as drizzleSql, snapshots, tenants } from "@hap/db";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withTenantTx, withTenantTxHandle } from "../tenant-tx";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const db = createDatabase(DATABASE_URL);
const PORTAL_PREFIX = `tenanttx-${randomUUID().slice(0, 8)}-`;
const TEST_RLS_ROLE = "hap_rls_test";

function portalId() {
  return `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;
}

function requireRow<T>(row: T | undefined, label: string): T {
  if (!row) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return row;
}

type CurrentSettingRow = { tenant_id: string | null };
type TenantTxHandle = Database & {
  release(): Promise<void>;
  abort(error?: Error): Promise<void>;
};

async function seedTenant(name: string) {
  const [row] = await db.insert(tenants).values({ hubspotPortalId: portalId(), name }).returning();
  return requireRow(row, "tenant");
}

beforeAll(async () => {
  await db.execute(
    drizzleSql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${TEST_RLS_ROLE}') THEN
        CREATE ROLE ${TEST_RLS_ROLE} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
      END IF;
    END
    $$;
  `),
  );

  await db.execute(drizzleSql.raw(`GRANT USAGE ON SCHEMA public TO ${TEST_RLS_ROLE};`));
  await db.execute(
    drizzleSql.raw(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${TEST_RLS_ROLE};`,
    ),
  );
});

beforeEach(async () => {
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

afterAll(async () => {
  // Keep the helper role for repeated local runs. The beforeAll block is
  // idempotent, and dropping a granted role requires extra revoke cleanup
  // that adds noise without improving the behavior we are testing.
});

describe("withTenantTx", () => {
  it("sets app.tenant_id inside the transaction", async () => {
    const tenant = await seedTenant("Tenant A");

    const tenantId = await withTenantTx(db, tenant.id, async (tx) => {
      const rows = await tx.execute<CurrentSettingRow>(
        drizzleSql`select current_setting('app.tenant_id', true) as tenant_id`,
      );
      return rows[0]?.tenant_id ?? null;
    });

    expect(tenantId).toBe(tenant.id);
  });
});

describe("withTenantTxHandle", () => {
  it("returns a handle that only sees the active tenant's rows", async () => {
    const tenantA = await seedTenant("Tenant A");
    const tenantB = await seedTenant("Tenant B");
    const companyA = `co-a-${randomUUID().slice(0, 8)}`;
    const companyB = `co-b-${randomUUID().slice(0, 8)}`;

    await withTenantTx(db, tenantA.id, async (tx) => {
      await tx.insert(snapshots).values({
        tenantId: tenantA.id,
        companyId: companyA,
        eligibilityState: "eligible",
        stateFlags: {},
      });
    });

    await withTenantTx(db, tenantB.id, async (tx) => {
      await tx.insert(snapshots).values({
        tenantId: tenantB.id,
        companyId: companyB,
        eligibilityState: "eligible",
        stateFlags: {},
      });
    });

    const handle = (await withTenantTxHandle(db, tenantB.id)) as TenantTxHandle;
    try {
      await handle.execute(drizzleSql.raw(`set local role ${TEST_RLS_ROLE}`));
      const rows = await handle.select().from(snapshots).where(eq(snapshots.companyId, companyB));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenantId).toBe(tenantB.id);
      expect(rows[0]?.companyId).toBe(companyB);
    } finally {
      await handle.release();
    }
  });

  it("uses the tenant-scoped setting for raw current_setting reads on the reserved handle", async () => {
    const tenant = await seedTenant("Tenant C");

    const handle = (await withTenantTxHandle(db, tenant.id)) as TenantTxHandle;
    try {
      const rows = await handle.execute<CurrentSettingRow>(
        drizzleSql`select current_setting('app.tenant_id', true) as tenant_id`,
      );
      expect(rows[0]?.tenant_id).toBe(tenant.id);
    } finally {
      await handle.release();
    }
  });

  it("does not leak tenant A rows when selecting through tenant B's handle", async () => {
    const tenantA = await seedTenant("Tenant A");
    const tenantB = await seedTenant("Tenant B");
    const sharedCompanyId = `shared-company-${randomUUID().slice(0, 8)}`;

    await withTenantTx(db, tenantA.id, async (tx) => {
      await tx.insert(snapshots).values({
        tenantId: tenantA.id,
        companyId: sharedCompanyId,
        eligibilityState: "eligible",
        stateFlags: {},
      });
    });

    const handle = (await withTenantTxHandle(db, tenantB.id)) as TenantTxHandle;
    try {
      await handle.execute(drizzleSql.raw(`set local role ${TEST_RLS_ROLE}`));
      const rows = await handle
        .select()
        .from(snapshots)
        .where(eq(snapshots.companyId, sharedCompanyId));
      expect(rows).toHaveLength(0);
    } finally {
      await handle.release();
    }
  });

  it("rolls back writes when the reserved handle is aborted after an error", async () => {
    const tenant = await seedTenant("Tenant Rollback");
    const companyId = `rollback-${randomUUID().slice(0, 8)}`;

    const handle = (await withTenantTxHandle(db, tenant.id)) as TenantTxHandle;
    const expectedError = new Error("request failed");

    await handle.insert(snapshots).values({
      tenantId: tenant.id,
      companyId,
      eligibilityState: "eligible",
      stateFlags: {},
    });

    await expect(handle.abort(expectedError)).rejects.toThrow("request failed");

    const rows = await withTenantTx(db, tenant.id, async (tx) =>
      tx.select().from(snapshots).where(eq(snapshots.companyId, companyId)),
    );
    expect(rows).toHaveLength(0);
  });
});
