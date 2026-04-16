import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../../schema";

/**
 * Slice 3 Phase 3 Task 1 — verifies migration 0007 enables and forces
 * RLS on every tenant-scoped table while leaving `tenants` outside RLS.
 *
 * Official Postgres docs confirm:
 *   - `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` turns RLS on
 *   - table owners bypass RLS unless `FORCE ROW LEVEL SECURITY` is set
 *   - without policies, enabled RLS is default-deny
 *
 * This test only verifies catalog state for migration 0007.
 * Behavioral cross-tenant enforcement is covered later by rls.test.ts.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const sql = postgres(DATABASE_URL, { max: 2 });
drizzle(sql, { schema });

const RLS_TABLES = [
  "snapshots",
  "evidence",
  "people",
  "provider_config",
  "llm_config",
  "tenant_hubspot_oauth",
  "signed_request_nonce",
] as const;
const rlsTableListSql = sql.unsafe(RLS_TABLES.map((tableName) => `'${tableName}'`).join(", "));

type RlsCatalogRow = {
  relname: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
};

type PolicyRow = {
  tablename: string;
  policyname: string;
  cmd: string;
  qual: string | null;
  with_check: string | null;
};

beforeAll(async () => {
  await sql`SELECT 1`;
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

describe("slice3 phase3: migration 0007 RLS catalog state", () => {
  it("enables and forces row level security on the 7 tenant-scoped tables only", async () => {
    const rows = await sql<RlsCatalogRow[]>`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      INNER JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN (${rlsTableListSql})
      ORDER BY c.relname
    `;

    expect(rows).toHaveLength(RLS_TABLES.length);
    expect(rows.map((row) => row.relname)).toEqual([...RLS_TABLES].sort());

    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} should have RLS enabled`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} should force RLS for owner`).toBe(true);
    }
  });

  it("does not put the bootstrap tenants table under RLS", async () => {
    const rows = await sql<RlsCatalogRow[]>`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      INNER JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'tenants'
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.relrowsecurity).toBe(false);
    expect(rows[0]?.relforcerowsecurity).toBe(false);
  });

  it("creates select-all and insert policies for every tenant-scoped table", async () => {
    const rows = await sql<PolicyRow[]>`
      SELECT tablename, policyname, cmd, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN (${rlsTableListSql})
      ORDER BY tablename, policyname
    `;

    expect(rows).toHaveLength(RLS_TABLES.length * 2);

    for (const tableName of RLS_TABLES) {
      const tablePolicies = rows.filter((row) => row.tablename === tableName);
      expect(tablePolicies).toHaveLength(2);

      const commands = tablePolicies.map((row) => row.cmd).sort();
      expect(commands).toEqual(["ALL", "INSERT"]);

      for (const policy of tablePolicies) {
        if (policy.cmd === "ALL") {
          expect(policy.qual).toContain("current_setting('app.tenant_id'");
        }

        if (policy.cmd === "INSERT") {
          expect(policy.with_check).toContain("current_setting('app.tenant_id'");
        }
      }
    }
  });
});
