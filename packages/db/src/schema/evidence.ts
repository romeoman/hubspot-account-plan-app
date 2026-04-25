import { boolean, index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { snapshots } from "./snapshots.js";
import { tenants } from "./tenants.js";

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
    // mode:"number" — without it Drizzle returns the column as a string and
    // every numeric comparison downstream (`confidence >= minConfidence`)
    // silently coerces. The domain type is `number`, so be explicit.
    confidence: numeric("confidence", { mode: "number" }).notNull(),
    content: text("content").notNull(),
    isRestricted: boolean("is_restricted").notNull().default(false),
  },
  (table) => [
    index("evidence_tenant_timestamp_idx").on(table.tenantId, table.timestamp),
    // FK joins / cascade deletes on snapshotId go full table scan without this.
    index("evidence_snapshot_idx").on(table.snapshotId),
  ],
);
