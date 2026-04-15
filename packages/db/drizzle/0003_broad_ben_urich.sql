ALTER TABLE "llm_config" ADD COLUMN "key_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_config" ADD COLUMN "rate_limit_config" jsonb;--> statement-breakpoint
ALTER TABLE "llm_config" ADD COLUMN "allow_list" jsonb;--> statement-breakpoint
ALTER TABLE "llm_config" ADD COLUMN "block_list" jsonb;--> statement-breakpoint
ALTER TABLE "provider_config" ADD COLUMN "key_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_config" ADD COLUMN "rate_limit_config" jsonb;--> statement-breakpoint
ALTER TABLE "provider_config" ADD COLUMN "allow_list" jsonb;--> statement-breakpoint
ALTER TABLE "provider_config" ADD COLUMN "block_list" jsonb;