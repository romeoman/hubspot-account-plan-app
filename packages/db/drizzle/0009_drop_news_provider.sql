-- Drop the separate 'news' signal provider slot.
--
-- Background: the NewsAdapter has always shared Exa's API key at the
-- adapter layer. The settings surface still treated News as a distinct
-- provider with its own key input, which was cosmetic and misleading.
-- The wire contract now drops `news` from `SettingsSignalProviders` and
-- the factory drives NewsAdapter from the Exa provider row + a JSONB
-- sub-flag `settings.newsEnabled`.
--
-- Migration rules (Plan §Acceptance Criteria #9):
--   1. Tenants with BOTH 'news' and 'exa' rows: fold `news.enabled` into
--      `exa.settings.newsEnabled` and delete the news row.
--   2. Tenants with ONLY 'exa': no-op (default `newsEnabled` = on is
--      the runtime default; do not write the column unless needed).
--   3. Tenants with ONLY 'news' (no matching 'exa'): DO NOT silently
--      delete the row. Preserve it for manual follow-up. There is no
--      CHECK constraint on `provider_name` so the row remains valid
--      storage-wise; the adapter factory will simply never read it.
--
-- All operations are wrapped in a single transaction so a partial
-- failure leaves the DB consistent.

BEGIN;

-- Step 1: for tenants that have BOTH rows, fold news.enabled into the
-- Exa row's settings.newsEnabled. We use jsonb_set so any other keys
-- already stored under Exa's `settings` are preserved.
UPDATE provider_config AS exa_row
SET settings = jsonb_set(
    COALESCE(exa_row.settings, '{}'::jsonb),
    '{newsEnabled}',
    to_jsonb(news_row.enabled),
    true
  )
FROM provider_config AS news_row
WHERE
  exa_row.provider_name = 'exa'
  AND news_row.provider_name = 'news'
  AND exa_row.tenant_id = news_row.tenant_id;

-- Step 2: delete news rows only when a matching Exa row exists (step 1
-- already folded the enabled value). Orphan 'news'-only tenants are
-- intentionally left in place for manual follow-up.
DELETE FROM provider_config AS news_row
USING provider_config AS exa_row
WHERE
  news_row.provider_name = 'news'
  AND exa_row.provider_name = 'exa'
  AND news_row.tenant_id = exa_row.tenant_id;

COMMIT;
