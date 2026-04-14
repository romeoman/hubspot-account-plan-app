import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { snapshots } from "./snapshots";
import { tenants } from "./tenants";

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
    evidenceRefs: jsonb("evidence_refs").notNull().default([]),
  },
  (table) => [index("people_tenant_snapshot_idx").on(table.tenantId, table.snapshotId)],
);
