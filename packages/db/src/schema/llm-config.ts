import { jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

export const llmConfig = pgTable(
  "llm_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    providerName: text("provider_name").notNull(),
    modelName: text("model_name").notNull(),
    apiKeyEncrypted: text("api_key_encrypted"),
    endpointUrl: text("endpoint_url"),
    settings: jsonb("settings").notNull().default({}),
  },
  (table) => [unique("llm_config_tenant_provider_unique").on(table.tenantId, table.providerName)],
);
