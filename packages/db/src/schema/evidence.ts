import { boolean, index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { snapshots } from "./snapshots";
import { tenants } from "./tenants";

export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    confidence: numeric("confidence").notNull(),
    content: text("content").notNull(),
    isRestricted: boolean("is_restricted").notNull().default(false),
  },
  (table) => [index("evidence_tenant_timestamp_idx").on(table.tenantId, table.timestamp)],
);
