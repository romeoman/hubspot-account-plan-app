import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * Slice 3 Task 2 — per-tenant HubSpot OAuth tokens.
 *
 * Stores the access/refresh tokens granted when a HubSpot portal installs
 * the app via the OAuth flow in `apps/api/src/routes/oauth.ts`. Keyed 1:1
 * with `tenants.id` so the table is a natural extension of the tenant row
 * rather than a history log. Token rotation mutates the existing row.
 *
 * Design invariants (see Slice 3 plan + SECURITY.md §16):
 *   - `tenant_id` is the PRIMARY KEY — exactly one active token set per tenant.
 *   - NO `hub_id` column. Portal identity lives on `tenants.hubspot_portal_id`
 *     (text, unique). Duplicating it here would create a drift surface.
 *   - `access_token_encrypted` + `refresh_token_encrypted` use the Slice 2
 *     AES-256-GCM envelope format (`v{N}:iv:tag:ciphertext`). `key_version`
 *     tracks rotation; CHECK (> 0) prevents 0/negative poisoning.
 *   - `scopes` is a text[] (Postgres native) — simpler than jsonb for a
 *     flat list of HubSpot scope strings.
 *   - FK cascade: deleting the tenant removes the token row atomically.
 */
export const tenantHubspotOauth = pgTable(
  "tenant_hubspot_oauth",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade" }),
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    scopes: text("scopes").array().notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("tenant_hubspot_oauth_key_version_positive", sql`${table.keyVersion} > 0`)],
);
