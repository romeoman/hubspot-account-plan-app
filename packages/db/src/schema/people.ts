import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { snapshots } from "./snapshots.js";
import { tenants } from "./tenants.js";

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    title: text("title"),
    reasonToTalk: text("reason_to_talk").notNull(),
    // Use explicit SQL JSONB literal — Drizzle docs flag `.default([])` /
    // `.default({})` as fragile under drizzle-kit migrations because the
    // serializer can choke on JSON parsing.
    evidenceRefs: jsonb("evidence_refs").notNull().default(sql`'[]'::jsonb`),
  },
  (table) => [index("people_tenant_snapshot_idx").on(table.tenantId, table.snapshotId)],
);
