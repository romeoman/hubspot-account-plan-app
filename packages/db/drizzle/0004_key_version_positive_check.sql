-- Slice 2 review hardening (CodeRabbit M20 / M22).
--
-- Enforce `key_version > 0` at the DB level on both config tables. The
-- column drives the AES-GCM envelope's "v{N}:iv:tag:payload" format
-- (apps/api/src/lib/encryption.ts); a zero or negative key_version would
-- produce malformed envelopes or reference a KEY_VERSION constant that
-- doesn't exist, so a CHECK is a tiny guardrail with big downstream value.

ALTER TABLE "llm_config"
  ADD CONSTRAINT "llm_config_key_version_positive"
  CHECK ("key_version" > 0);
--> statement-breakpoint
ALTER TABLE "provider_config"
  ADD CONSTRAINT "provider_config_key_version_positive"
  CHECK ("key_version" > 0);
