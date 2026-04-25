import { index, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

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
    // mode:"number" — domain type is `number | undefined`. Without this,
    // Drizzle hands back a string and downstream Zod validation drifts.
    trustScore: numeric("trust_score", { mode: "number" }),
    stateFlags: jsonb("state_flags").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("snapshots_tenant_company_idx").on(table.tenantId, table.companyId)],
);
