import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../../schema";

type TenantColumnRow = {
  column_name: string;
  is_nullable: "YES" | "NO";
  data_type: string;
};

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const sql = postgres(DATABASE_URL, { max: 2 });
drizzle(sql, { schema });

beforeAll(async () => {
  await sql`SELECT 1`;
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

describe("slice6: tenant lifecycle schema", () => {
  it("adds nullable deactivated_at and deactivation_reason columns to tenants", async () => {
    const rows = await sql<TenantColumnRow[]>`
      SELECT column_name, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tenants'
        AND column_name IN ('deactivated_at', 'deactivation_reason')
      ORDER BY column_name
    `;

    expect(rows).toEqual([
      {
        column_name: "deactivated_at",
        is_nullable: "YES",
        data_type: "timestamp with time zone",
      },
      {
        column_name: "deactivation_reason",
        is_nullable: "YES",
        data_type: "text",
      },
    ]);
  });
});
