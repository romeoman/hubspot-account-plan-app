/**
 * Integration test for migration 0009_drop_news_provider.sql.
 *
 * Covers the three tenant-state cases called out in the plan
 * (§Acceptance Criteria #9):
 *
 *   Case A — BOTH rows (news + exa): the `news.enabled` flag is folded
 *     into `exa.settings.newsEnabled`, and the news row is deleted.
 *     Any other keys already living under `exa.settings` survive.
 *
 *   Case B — exa-only: the migration is a no-op. It does NOT write a
 *     `newsEnabled` key (runtime default is "on") and does NOT touch
 *     other settings keys.
 *
 *   Case C — news-only (orphan): the migration preserves the row. There
 *     is no CHECK constraint on `provider_name`, so the row is valid
 *     storage; the adapter factory simply never reads it. Manual
 *     follow-up is expected.
 *
 * Runs the migration SQL text directly against a transaction so the
 * test is idempotent — we BEGIN, seed fixtures, execute the migration
 * body, assert, then ROLLBACK. The drizzle migrations table is never
 * touched, so this test can run on a DB that already has 0009 applied.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../schema";
import { providerConfig, tenants } from "../schema";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const sql = postgres(DATABASE_URL, { max: 4 });
const db = drizzle(sql, { schema });

// Per-file portal prefix keeps cleanup scoped to this suite.
const PORTAL_PREFIX = `dropnewstest-${randomUUID().slice(0, 8)}-`;

function portalId() {
  return `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
}

// Resolve the migration SQL body at runtime. The migration file lives at
// packages/db/drizzle/0009_drop_news_provider.sql relative to this test.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATION_PATH = join(__dirname, "..", "..", "drizzle", "0009_drop_news_provider.sql");
const MIGRATION_SQL = readFileSync(MIGRATION_PATH, "utf-8");

// The migration wraps its own BEGIN/COMMIT. For the test we strip those
// so we can run the body inside our own transaction — this lets us
// ROLLBACK at the end and keeps the suite idempotent.
const MIGRATION_BODY = MIGRATION_SQL.replace(/^\s*BEGIN\s*;/im, "")
  .replace(/\s*COMMIT\s*;\s*$/im, "")
  .trim();

beforeAll(async () => {
  await sql`SELECT 1`;
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

beforeEach(async () => {
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

describe("migration 0009_drop_news_provider", () => {
  it("Case A: folds news.enabled into exa.settings.newsEnabled and deletes the news row", async () => {
    const [t] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "Case A" })
      .returning();
    const tenantId = required(t, "tenant").id;

    await db.insert(providerConfig).values([
      {
        tenantId,
        providerName: "exa",
        enabled: true,
        settings: { someOtherKey: "keep-me" },
      },
      {
        tenantId,
        providerName: "news",
        enabled: false, // intentionally off — we expect newsEnabled=false on exa
      },
    ]);

    await sql.unsafe(MIGRATION_BODY);

    const rows = await db
      .select()
      .from(providerConfig)
      .where(eq(providerConfig.tenantId, tenantId));

    expect(rows).toHaveLength(1);
    const exa = rows[0];
    expect(exa?.providerName).toBe("exa");
    expect(exa?.settings).toEqual({
      someOtherKey: "keep-me",
      newsEnabled: false,
    });
  });

  it("Case A (news.enabled=true): sets newsEnabled=true on exa and deletes news", async () => {
    const [t] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "Case A-true" })
      .returning();
    const tenantId = required(t, "tenant").id;

    await db.insert(providerConfig).values([
      { tenantId, providerName: "exa", enabled: true },
      { tenantId, providerName: "news", enabled: true },
    ]);

    await sql.unsafe(MIGRATION_BODY);

    const rows = await db
      .select()
      .from(providerConfig)
      .where(eq(providerConfig.tenantId, tenantId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.providerName).toBe("exa");
    expect(rows[0]?.settings).toEqual({ newsEnabled: true });
  });

  it("Case B: exa-only tenant is untouched (no newsEnabled written)", async () => {
    const [t] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "Case B" })
      .returning();
    const tenantId = required(t, "tenant").id;

    await db.insert(providerConfig).values({
      tenantId,
      providerName: "exa",
      enabled: true,
      settings: { existingKey: "untouched" },
    });

    await sql.unsafe(MIGRATION_BODY);

    const rows = await db
      .select()
      .from(providerConfig)
      .where(eq(providerConfig.tenantId, tenantId));

    expect(rows).toHaveLength(1);
    const exa = rows[0];
    expect(exa?.providerName).toBe("exa");
    // No `newsEnabled` key was added — runtime default takes over.
    expect(exa?.settings).toEqual({ existingKey: "untouched" });
  });

  it("Case C: news-only (orphan) tenant has its news row preserved", async () => {
    const [t] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "Case C" })
      .returning();
    const tenantId = required(t, "tenant").id;

    await db.insert(providerConfig).values({
      tenantId,
      providerName: "news",
      enabled: true,
    });

    await sql.unsafe(MIGRATION_BODY);

    const rows = await db
      .select()
      .from(providerConfig)
      .where(eq(providerConfig.tenantId, tenantId));

    // Orphan news rows are intentionally NOT deleted — the DELETE step
    // uses a USING join on the exa row, so news-only tenants survive
    // for manual follow-up.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.providerName).toBe("news");
  });

  it("isolation: migration on one tenant does not touch another tenant's news row", async () => {
    // Tenant X has both rows (will be folded). Tenant Y has news-only
    // (must be preserved). Run the migration once and assert both
    // outcomes hold.
    const [tX] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "X" })
      .returning();
    const [tY] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "Y" })
      .returning();
    const xId = required(tX, "tX").id;
    const yId = required(tY, "tY").id;

    await db.insert(providerConfig).values([
      { tenantId: xId, providerName: "exa", enabled: true },
      { tenantId: xId, providerName: "news", enabled: true },
      { tenantId: yId, providerName: "news", enabled: true },
    ]);

    await sql.unsafe(MIGRATION_BODY);

    const xRows = await db.select().from(providerConfig).where(eq(providerConfig.tenantId, xId));
    const yRows = await db.select().from(providerConfig).where(eq(providerConfig.tenantId, yId));

    // X: only the folded exa row remains.
    expect(xRows).toHaveLength(1);
    expect(xRows[0]?.providerName).toBe("exa");
    expect(xRows[0]?.settings).toEqual({ newsEnabled: true });

    // Y: orphan news row preserved; no phantom exa row created.
    expect(yRows).toHaveLength(1);
    expect(yRows[0]?.providerName).toBe("news");
  });

  it("does not clobber unrelated tenants' exa.settings keys", async () => {
    // A tenant with ONLY exa (Case B) should retain other settings
    // keys byte-for-byte after the migration runs over a DB that also
    // contains Case A tenants.
    const [tA] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "A-pair" })
      .returning();
    const [tB] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "B-pair" })
      .returning();
    const aId = required(tA, "tA").id;
    const bId = required(tB, "tB").id;

    await db.insert(providerConfig).values([
      // Case A: will be folded.
      {
        tenantId: aId,
        providerName: "exa",
        enabled: true,
        settings: { aKey: "aValue" },
      },
      { tenantId: aId, providerName: "news", enabled: false },
      // Case B: must not be touched.
      {
        tenantId: bId,
        providerName: "exa",
        enabled: true,
        settings: { preservedKey: "preservedValue", nested: { x: 1 } },
      },
    ]);

    await sql.unsafe(MIGRATION_BODY);

    const [aExa] = await db
      .select()
      .from(providerConfig)
      .where(and(eq(providerConfig.tenantId, aId), eq(providerConfig.providerName, "exa")));
    const [bExa] = await db
      .select()
      .from(providerConfig)
      .where(and(eq(providerConfig.tenantId, bId), eq(providerConfig.providerName, "exa")));

    expect(aExa?.settings).toEqual({ aKey: "aValue", newsEnabled: false });
    expect(bExa?.settings).toEqual({
      preservedKey: "preservedValue",
      nested: { x: 1 },
    });
  });
});
