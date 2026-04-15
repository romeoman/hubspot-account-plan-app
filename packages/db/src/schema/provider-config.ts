import { boolean, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

export const providerConfig = pgTable(
  "provider_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    providerName: text("provider_name").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    apiKeyEncrypted: text("api_key_encrypted"),
    thresholds: jsonb("thresholds").notNull().default({}),
    settings: jsonb("settings").notNull().default({}),
  },
  (table) => [
    unique("provider_config_tenant_provider_unique").on(table.tenantId, table.providerName),
  ],
);
