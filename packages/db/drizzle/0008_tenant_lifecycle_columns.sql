ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "deactivated_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "deactivation_reason" text;
