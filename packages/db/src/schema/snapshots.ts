import { index, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

export const snapshots = pgTable(
  "snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull(),
    eligibilityState: text("eligibility_state").notNull(),
    reasonToContact: text("reason_to_contact"),
    trustScore: numeric("trust_score"),
    stateFlags: jsonb("state_flags").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("snapshots_tenant_company_idx").on(table.tenantId, table.companyId)],
);
