-- Slice 3 Phase 3 Task 1 — Postgres RLS policies for tenant-scoped tables.
--
-- Official Postgres docs:
--   * ALTER TABLE ... ENABLE ROW LEVEL SECURITY turns RLS on.
--   * Table owners bypass RLS unless FORCE ROW LEVEL SECURITY is set.
--   * If RLS is enabled and no policy exists, access is default-deny.
--
-- The `tenants` table is deliberately excluded. It is the bootstrap lookup
-- used before `app.tenant_id` can be set by the request-scoped DB middleware.
--
-- We use current_setting('app.tenant_id', true) so callers outside a tenant
-- tx scope (migrations, health checks) get NULL instead of an exception.

ALTER TABLE "snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "snapshots" FORCE ROW LEVEL SECURITY;
CREATE POLICY "snapshots_tenant_select"
  ON "snapshots"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "snapshots_tenant_insert"
  ON "snapshots"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "evidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY "evidence_tenant_select"
  ON "evidence"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "evidence_tenant_insert"
  ON "evidence"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "people" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "people" FORCE ROW LEVEL SECURITY;
CREATE POLICY "people_tenant_select"
  ON "people"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "people_tenant_insert"
  ON "people"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "provider_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provider_config" FORCE ROW LEVEL SECURITY;
CREATE POLICY "provider_config_tenant_select"
  ON "provider_config"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "provider_config_tenant_insert"
  ON "provider_config"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "llm_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "llm_config" FORCE ROW LEVEL SECURITY;
CREATE POLICY "llm_config_tenant_select"
  ON "llm_config"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "llm_config_tenant_insert"
  ON "llm_config"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "tenant_hubspot_oauth" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_hubspot_oauth" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_hubspot_oauth_tenant_select"
  ON "tenant_hubspot_oauth"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "tenant_hubspot_oauth_tenant_insert"
  ON "tenant_hubspot_oauth"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "signed_request_nonce" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "signed_request_nonce" FORCE ROW LEVEL SECURITY;
CREATE POLICY "signed_request_nonce_tenant_select"
  ON "signed_request_nonce"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "signed_request_nonce_tenant_insert"
  ON "signed_request_nonce"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
