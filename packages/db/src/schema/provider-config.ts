import { boolean, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
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
  (table) => [
    unique("provider_config_tenant_provider_unique").on(table.tenantId, table.providerName),
  ],
);
