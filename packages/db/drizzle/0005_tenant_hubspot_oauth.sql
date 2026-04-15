-- Slice 3 Task 2 — per-tenant HubSpot OAuth tokens.
--
-- See packages/db/src/schema/tenant-hubspot-oauth.ts for design notes.
-- Key invariants:
--   * tenant_id is PRIMARY KEY (1:1 with tenants).
--   * NO hub_id column — portal identity lives on tenants.hubspot_portal_id.
--   * key_version CHECK (> 0) matches the llm_config / provider_config pattern
--     from migrations 0003 + 0004.
--   * FK cascade purges token rows when a tenant is deleted.

CREATE TABLE IF NOT EXISTS "tenant_hubspot_oauth" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"scopes" text[] NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_hubspot_oauth_key_version_positive" CHECK ("key_version" > 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_hubspot_oauth" ADD CONSTRAINT "tenant_hubspot_oauth_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
