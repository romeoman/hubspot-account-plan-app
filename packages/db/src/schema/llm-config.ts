import { integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

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
    /**
     * Slice 2: key-rotation version for the AES-256-GCM envelope stored in
     * `api_key_encrypted` ("v{N}:iv:tag:payload"). Defaults to 1.
     */
    keyVersion: integer("key_version").notNull().default(1),
    /** Slice 2: optional per-tenant rate-limit config (shape owned by caller). */
    rateLimitConfig: jsonb("rate_limit_config").$type<Record<string, unknown>>(),
    /** Slice 2: optional allow-list of hostnames / identifiers. */
    allowList: jsonb("allow_list").$type<string[]>(),
    /** Slice 2: optional block-list of hostnames / identifiers. */
    blockList: jsonb("block_list").$type<string[]>(),
  },
  (table) => [unique("llm_config_tenant_provider_unique").on(table.tenantId, table.providerName)],
);
