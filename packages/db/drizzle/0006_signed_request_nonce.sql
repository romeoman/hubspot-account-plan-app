-- Slice 3 Task 2 — replay-nonce store for X-HubSpot-Signature-v3.
--
-- See packages/db/src/schema/signed-request-nonce.ts for design notes.
-- Key invariants:
--   * Composite PK (tenant_id, timestamp, body_hash). Tenant-scoped so two
--     tenants with identical (timestamp, body_hash) are independent.
--   * body_hash is bytea (raw 32-byte SHA-256 digest), not hex text.
--   * FK cascade purges nonces when a tenant is deleted.
--   * Index on created_at supports the TTL sweep (scripts/sweep-nonces.ts)
--     which drops rows older than the freshness window (10 min buffer).

CREATE TABLE IF NOT EXISTS "signed_request_nonce" (
	"tenant_id" uuid NOT NULL,
	"timestamp" bigint NOT NULL,
	"body_hash" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signed_request_nonce_pkey" PRIMARY KEY ("tenant_id","timestamp","body_hash")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signed_request_nonce" ADD CONSTRAINT "signed_request_nonce_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signed_request_nonce_created_at_idx" ON "signed_request_nonce" ("created_at");
