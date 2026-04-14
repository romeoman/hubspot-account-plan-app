CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"source" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"confidence" numeric NOT NULL,
	"content" text NOT NULL,
	"is_restricted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider_name" text NOT NULL,
	"model_name" text NOT NULL,
	"api_key_encrypted" text,
	"endpoint_url" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "llm_config_tenant_provider_unique" UNIQUE("tenant_id","provider_name")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"reason_to_talk" text NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider_name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"api_key_encrypted" text,
	"thresholds" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "provider_config_tenant_provider_unique" UNIQUE("tenant_id","provider_name")
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" text NOT NULL,
	"eligibility_state" text NOT NULL,
	"reason_to_contact" text,
	"trust_score" numeric,
	"state_flags" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_config" ADD CONSTRAINT "llm_config_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_config" ADD CONSTRAINT "provider_config_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_tenant_timestamp_idx" ON "evidence" USING btree ("tenant_id","timestamp");--> statement-breakpoint
CREATE INDEX "people_tenant_snapshot_idx" ON "people" USING btree ("tenant_id","snapshot_id");--> statement-breakpoint
CREATE INDEX "snapshots_tenant_company_idx" ON "snapshots" USING btree ("tenant_id","company_id");