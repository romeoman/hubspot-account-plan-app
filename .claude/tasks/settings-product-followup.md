# Plan: Settings & product follow-up (post-issue-#17)

## Task Description

Issue #17 (HubSpot settings extension rendering failure) landed on
`codex/issue-17-settings-crash` at commit `c49e239`. The lane proved the
settings surface renders; Romeo then flagged a cluster of product/UX issues
that were previously invisible because the page couldn't load. This plan
scopes that backlog.

Requested items:

1. rename card title `Account Signal` → `Account Planning`
2. fold the separate "News" provider into the Exa surface (the adapter
   already uses Exa; only the settings UI still treats News as its own
   provider with its own key input)
3. redesign the HubSpot enrichment block around tenant-specific OAuth scopes
   instead of a fake API-key input
4. research and recommend the best additional HubSpot scopes for stronger
   enrichment (deals, owners, engagements, schemas, etc.)
5. redesign the LLM settings surface so a provider dropdown drives the model
   options and the raw endpoint URL is hidden (except for `custom`)
6. ship a curated model catalog covering: major premium models, OpenRouter
   top models, DeepSeek, MiniMax, and 3 open-source/free options
7. confirm API keys are encrypted at rest, masked in the UI, and never
   re-exposed after save
8. add tooltips for "Freshness max days" and "Minimum confidence"
9. display minimum confidence as a percent (`0.65 → 65%`) instead of the raw
   decimal

Issue #19 (lifecycle subscription delivery) remains explicitly out of scope.

## Objective

Deliver two shippable, independently verifiable issues:

- **Issue A (`settings-ux-polish`)** — immediate UX cleanup with no wire or
  schema changes. Card rename, tooltips, percent display, small text fixes.
  No HubSpot re-auth required.
- **Issue B (`settings-surface-redesign`)** — settings surface refactor
  covering: drop the separate News provider (still Exa-backed at adapter
  level), remove the fake HubSpot-enrichment API-key input, redesign LLM
  settings with provider→model cascade and curated catalog, key masking &
  clear flow. Wire-contract + validator + DB-settings changes; no HubSpot
  scope change, no re-auth required.

A third larger lane is explicitly deferred and tracked as a separate issue:

- **Issue C (`hubspot-enrichment-scope-expansion`) — deferred.** Expand
  OAuth scopes and enrichment adapter to read deals, owners, engagements,
  schemas. Marketplace-listing change + forced re-install/re-auth for
  existing tenants. Must not ride with A or B.

## Prerequisite Gate

Before any implementation work starts in this worktree, merge or rebase in
the verified `#17` fix branch so the settings surface remains live during
development:

- source branch: `codex/issue-17-settings-crash`
- required commit: `c49e239`

This worktree currently points at `e8adc0b` and does **not** yet contain
`c49e239`. Do not start Issue A or B on the pre-#17 base, or portal
verification will regress back to the old broken settings surface and muddy
every later result.

## Problem Statement

- The card is labeled `Account Signal` in the record tab, but the rest of
  the product now calls this surface "Account Planning". Inconsistent brand.
- The settings page shows **three** signal providers — Exa, News, HubSpot
  enrichment — but News is really just Exa's news vertical (`category:
"news"` against `api.exa.ai/search`), driven by the same API key. Users
  are asked for a "News API key" that will never be used as a distinct
  credential, which is actively misleading.
- The HubSpot-enrichment block has an API-key `Input` with `type="password"`
  that does nothing: the factory branch for `hubspot-enrichment` constructs
  a `HubSpotClient` from the tenant's OAuth tokens and ignores
  `config.apiKeyRef` entirely. The input is cosmetic and misleading.
- LLM settings expose an `endpointUrl` text box unconditionally, a free-text
  "Model" input, and no curated model catalog. Users can select `openai` +
  `gemini-2.5-pro` + `https://wrong.example` and the form will accept it.
  The wire contract allows `custom` for OpenAI-compatible endpoints — that
  is the only case where the endpoint field should be visible.
- Minimum confidence is shown as a raw decimal (`0.65`) with no tooltip.
  Non-technical operators type `65` and lock themselves out of snapshots.
- Freshness/confidence have no in-surface explanation; there is no tooltip
  component in play.
- Current scopes (`oauth`, `crm.objects.companies.read`,
  `crm.objects.contacts.read`) give HubSpot enrichment very little to read.
  Stronger enrichment needs additional scopes, which requires a marketplace
  listing update and forced re-auth for every existing tenant.

## Solution Approach

Slice the work into three lanes and ship A + B. Gate C on explicit operator
approval because it forces re-install on production tenants.

**Issue A — settings-ux-polish (small, no wire change):**

- `apps/hubspot-project/src/app/cards/card-hsmeta.json`: rename
  `config.name` from `Account Signal` to `Account Planning`.
- `apps/hubspot-extension/src/settings/settings-page.tsx`: attach HubSpot
  `tooltip` prop to `NumberInput` for Freshness max days and Minimum
  confidence. Use `@hubspot/ui-extensions` `NumberInput` `tooltip` prop
  (confirm via Context7 `/hubspot/ui-extensions` docs at execution time).
- Add explicit percent formatting for Minimum confidence: on read, multiply
  by 100 and append `%` suffix; on write, divide by 100 back into the
  decimal wire format. Keep the wire contract a 0..1 decimal — do NOT
  change the validator bounds or DB field.
- Copy review pass on all settings labels ("Account Planning" language,
  honest descriptions for each provider).
- Add a small regression test that asserts the wire payload for `0.65` is
  still `0.65` after round-tripping through the percent-formatted input.

**Issue B — settings-surface-redesign (moderate, wire change):**

Four atomic sub-changes that must land together because they share the
same wire contract and validator file:

_B1 — Drop separate News provider from wire + UI:_

- Remove `news` from `SettingsSignalProviders` / `SettingsSignalProviderUpdates`
  in `packages/config/src/domain-types.ts`.
- Remove `news` from `packages/validators/src/settings.ts` (both
  `settingsResponseSchema` and `settingsUpdateSchema`).
- Remove the "Enable News" toggle and "News API key" input from
  `settings-page.tsx`.
- Keep the `NewsAdapter` code path intact. Change the adapter factory:
  the Exa provider config now drives the `news` adapter too (both use the
  same API key). In `apps/api/src/adapters/signal/factory.ts`, construct
  `NewsAdapter` from the `exa` provider config rather than a separate
  `news` row when the `exa` provider is enabled.
- DB migration: fold any existing `provider_config` row with
  `provider_name='news'` into the Exa row's `settings` JSONB (e.g.
  `settings.newsEnabled=true`) or drop it outright if no tenant depends on
  it. Preflight: inspect production; if no `news` rows exist, the
  migration is a schema cleanup only. If rows exist, merge then delete.
- Update `apps/api/src/lib/settings-service.ts` to stop reading/writing
  the `news` slot. Consumers of `SettingsSignalProviders.news` elsewhere:
  grep and fix.

_B2 — Remove fake HubSpot-enrichment API key input:_

- Drop `hubspotEnrichmentApiKey` / `hubspotEnrichment.apiKey` from the
  draft state and the rendered form in `settings-page.tsx`.
- Keep the `hubspotEnrichment.enabled` toggle (that is honest).
- Add copy: "HubSpot enrichment uses your OAuth connection. No API key
  required."
- Remove the `apiKey` branch from `hubspotEnrichment` in
  `settingsUpdateSchema`. Add an explicit Zod `.strict()` (or equivalent)
  so future wire drift fails validation.
- Backend: ensure `updateSettings` rejects `hubspotEnrichment.apiKey` with
  a 400 rather than silently ignoring it.

_B3 — LLM settings redesign + curated catalog:_

- Provider dropdown (unchanged options: none, OpenAI, Anthropic, Gemini,
  OpenRouter, Custom) drives a second dropdown: **Model**.
- Model dropdown is populated from a curated catalog per provider. Catalog
  lives in `packages/config/src/llm-catalog.ts` (new file) keyed by
  provider. The catalog is the source of truth for valid model IDs in the
  UI; the backend still accepts any string so a customer on a fast-moving
  provider (OpenAI, Anthropic) isn't locked out if Anthropic ships a new
  model before we update the catalog. The catalog offers a final
  `Other (type manually)` option that reveals a free-text `Input`.
- Endpoint URL field is hidden unless `provider === "custom"`.
- API key field stays masked (`type="password"`). When `hasApiKey: true`
  is returned by the API, display "Stored key on file" and add a "Clear
  key" button which sends `clearApiKey: true` in the update payload
  (already supported by the wire contract).
- Curated catalog (initial content, to be confirmed via Context7 at
  implementation time):
  - **OpenAI:** `gpt-5`, `gpt-4.1`, `gpt-4o`, `gpt-4o-mini`,
    `o3`, `o4-mini`
  - **Anthropic:** `claude-sonnet-4.5`, `claude-opus-4.5`,
    `claude-haiku-4.5`
  - **Gemini:** `gemini-2.5-pro`, `gemini-2.5-flash`,
    `gemini-2.5-flash-lite`
  - **OpenRouter (curated top):** `anthropic/claude-sonnet-4.5`,
    `openai/gpt-5`, `google/gemini-2.5-pro`,
    `deepseek/deepseek-v3.2`, `deepseek/deepseek-r1`,
    `minimax/minimax-m2`, `qwen/qwen-3-235b-instruct`,
    `meta-llama/llama-3.3-70b-instruct:free`,
    `mistralai/mixtral-8x22b-instruct:free`,
    `nousresearch/hermes-4-405b:free`
  - **DeepSeek (direct, `provider=openrouter`):** `deepseek-v3.2`,
    `deepseek-r1`
  - **MiniMax (direct, `provider=openrouter`):** `minimax-m2`,
    `minimax-abab-7-chat`
  - **Open-source / free (via OpenRouter):**
    `meta-llama/llama-3.3-70b-instruct:free`,
    `mistralai/mixtral-8x22b-instruct:free`,
    `nousresearch/hermes-4-405b:free`
  - All model IDs MUST be re-verified against live docs at build time
    (OpenAI models, Anthropic models, Gemini models, OpenRouter catalog)
    via Context7 `/openai`, `/anthropics/claude-docs`, `/google-gemini`,
    `/openrouter` resolves-to-latest. Do not freeze the list on the
    contents above if docs disagree. Record the verification snapshot in
    the commit message.
- Catalog schema:
  ```ts
  export type LlmCatalogEntry = {
    value: string; // wire value (model id)
    label: string; // UI label
    tier?: "premium" | "standard" | "free";
  };
  export const LLM_CATALOG: Record<LlmProviderType, LlmCatalogEntry[]>;
  ```
- Add a regression test that locks the shape of `LLM_CATALOG` (provider
  keys, non-empty arrays, no duplicate `value` within a provider).

_B4 — Provider connection testing (`Test connection` flow):_

Operators currently find out their LLM or Exa credentials are wrong via
a silently empty snapshot. The redesign must ship an explicit
verification path so invalid credentials fail loud at save time, not
hours later in production.

- New backend endpoint: `POST /settings/test-connection`. Tenant-scoped.
  Zod-validated body is a discriminated union:
  ```ts
  type TestConnectionBody =
    | {
        target: "llm";
        provider: LlmProviderType;
        model: string;
        // Exactly one of the following:
        apiKey?: string; // draft (unsaved) key
        useSavedKey?: true; // resolve ciphertext from provider_config
        endpointUrl?: string; // required when provider === "custom"
      }
    | {
        target: "exa";
        apiKey?: string;
        useSavedKey?: true;
      };
  ```
  Response is a narrow status:
  ```ts
  type TestConnectionResponse =
    | { ok: true; latencyMs: number; providerEcho?: { model?: string } }
    | {
        ok: false;
        code:
          | "auth"
          | "model"
          | "endpoint"
          | "network"
          | "rate_limit"
          | "unknown";
        message: string;
      };
  ```
- Per-provider test logic owned by a new backend service
  (`apps/api/src/lib/settings-connection-test.ts`):
  - **OpenAI:** cheapest check is `GET /v1/models` (auth-only, no billed
    tokens); verify the selected `model` id appears in the list.
  - **Anthropic:** `POST /v1/messages` with `max_tokens: 1` and a
    single-char prompt using the selected model id.
  - **Gemini:** `GET /v1beta/models/{model}` or a 1-token
    `generateContent` — whichever is cheaper at implementation time;
    confirm via Context7 `/google-gemini` at build time.
  - **OpenRouter:** `GET /api/v1/models` + filter by model slug for
    existence; optionally a 1-token completion to confirm the key has
    that model enabled.
  - **Custom (OpenAI-compatible):** `GET {endpointUrl}/models` with the
    draft/saved key, validate response is JSON and contains the model
    id.
  - **Exa:** `POST https://api.exa.ai/search` with `query: "test"`,
    `numResults: 1`.
- Saved-key path: server loads ciphertext from `provider_config` for the
  current tenant, decrypts in-process, passes to the vendor call, and
  discards. The plaintext key MUST NOT leave the process memory, MUST
  NOT be written to logs, and MUST NOT appear in error responses.
- Draft-key path: request-body key is used for the vendor call, then
  discarded. Never stored. Never echoed.
- Frontend: one `Test connection` button per target (LLM block, Exa
  block). Button uses draft key if the password input has any value,
  otherwise sends `useSavedKey: true`. Disabled when neither a draft
  key nor a stored key is present. Inline status component renders
  success (green check + latency) or failure (red + error code + short
  human message from the response). Never auto-fires on keystroke.
- Rate limiting: per-tenant token-bucket, e.g. 5 tests/min, to prevent
  the test path from becoming a free-tier DoS vector.
- SSRF guard: when `provider === "custom"` or `target === "exa"` is
  ever parameterized with user-supplied URLs, the backend must reject
  loopback / link-local / private-range / cloud-metadata hosts; HTTPS
  only.
- No vendor error body is returned verbatim to the client. The backend
  maps vendor errors to the narrow `code` union and a short sanitized
  `message`. Vendor HTTP status is logged server-side (no key leakage)
  for observability.
- Failing-first tests (backend): route rejects missing discriminator
  (400), route rejects both `apiKey` and `useSavedKey` set together
  (400), service maps a 401 from the vendor mock to `{ ok: false, code:
"auth" }`, service never logs the key (assert against a captured
  logger spy), cross-tenant isolation (tenant A cannot test tenant B's
  saved key).
- Failing-first tests (frontend): button disabled when no key and no
  stored key; clicking with draft key sends `apiKey` (never
  `useSavedKey`); clicking with stored key sends `useSavedKey: true`
  (never the masked placeholder); success state renders latency;
  failure state renders the error code.

**Issue C — hubspot-enrichment-scope-expansion (DEFERRED):**

Research-backed scope recommendation (must be re-verified against
`https://developers.hubspot.com/docs/guides/apps/authentication/scopes` at
implementation time):

| Scope                        | Why                                             |
| ---------------------------- | ----------------------------------------------- |
| `crm.objects.deals.read`     | Open pipeline deals are a top reason-to-contact |
| `crm.objects.owners.read`    | Account owner context / reason-to-talk routing  |
| `crm.schemas.companies.read` | Property metadata for safe field reads          |
| `crm.schemas.contacts.read`  | Ditto for contacts                              |
| `crm.objects.notes.read`     | Recent human context on the account             |
| `sales-email-read`           | Historical outbound context (evaluate vs v3)    |
| `tickets`                    | Support-driven reasons (evaluate demand)        |
| `crm.lists.read`             | Segmentation, target-account lists              |

The engagement-oriented reads (notes/tasks/meetings/emails/calls) use the
v3 Engagements API, which in 2026 is gated under
`crm.objects.*_engagements.read`-style scopes — verify current names via
Context7 before committing to the list. Add `optionalScopes` entries where
the UX can degrade gracefully; require only what the critical path needs.

Issue C must:

- Update `apps/hubspot-project/src/app/app-hsmeta.json` `requiredScopes` /
  `optionalScopes`.
- Extend `HubSpotClient` with the new reads.
- Extend `HubSpotEnrichmentAdapter` to emit richer evidence (deals,
  owners, engagements).
- Coordinate marketplace listing update + migration path (document the
  forced re-install for every tenant).
- NEVER ride with Issue A or B.

## Relevant Files

Use these files to complete the task (Issues A + B only):

- `apps/hubspot-project/src/app/cards/card-hsmeta.json` — card rename
  (Issue A).
- `apps/hubspot-extension/src/settings/settings-page.tsx` — main UI
  surface. All A + B UI changes land here. Currently renders three
  toggles + three password inputs + LLM block with free-text model and
  unconditional endpoint URL.
- `apps/hubspot-extension/src/settings/use-settings.ts` — read/save hook;
  wire-format change (percent, dropped news, dropped enrichment key) must
  flow through here.
- `apps/hubspot-extension/src/settings/api-fetcher.ts` — JSON fetch
  shapes; re-align with new wire contract.
- `packages/config/src/domain-types.ts` — wire contract for
  `SettingsSignalProviders`, `SettingsUpdate.llm`. Drop `news`, drop
  enrichment `apiKey`.
- `packages/validators/src/settings.ts` — Zod schemas mirroring the wire
  contract. Drop `news`, drop enrichment `apiKey`, add strict object
  mode.
- `apps/api/src/lib/settings-service.ts` — read/write path. Drop news
  slot. Reject enrichment `apiKey`.
- `apps/api/src/routes/settings.ts` — stable; only runs the new
  validators.
- `apps/api/src/adapters/signal/factory.ts` — rewire `news` branch to
  build from the Exa provider config + exa API key. Keep the adapter.
- `apps/api/src/adapters/signal/news.ts` — adapter itself unchanged.
- `packages/db/src/schema/provider-config.ts` — no schema column change.
  Data migration for any existing `provider_name='news'` row.
- `packages/db/drizzle/<next-migration>.sql` — new migration file for the
  news-row cleanup (see New Files).
- Tests:
  - `apps/hubspot-extension/src/settings/settings-entry.test.tsx`
  - `apps/hubspot-extension/src/settings/__tests__/settings-page.test.tsx`
  - `apps/hubspot-extension/src/settings/__tests__/use-settings.test.tsx`
  - `apps/api/src/routes/__tests__/settings.test.ts`
  - `apps/api/src/lib/__tests__/settings-service.test.ts`
  - `apps/api/src/adapters/signal/__tests__/factory.test.ts`

B4 (connection testing) adds:

- `apps/api/src/routes/settings-test-connection.ts` — narrow route.
- `apps/api/src/lib/settings-connection-test.ts` — per-provider + Exa
  test service.
- `packages/validators/src/settings.ts` — extend with
  `testConnectionBodySchema` + `testConnectionResponseSchema`.
- `packages/config/src/domain-types.ts` — extend with
  `TestConnectionBody` + `TestConnectionResponse` wire types.
- `apps/hubspot-extension/src/settings/connection-test-status.tsx` —
  tiny inline status component (success/failure rendering).
- `apps/hubspot-extension/src/settings/use-settings.ts` — add
  `testConnection()` helper that wraps the fetch.

### New Files

- `packages/config/src/llm-catalog.ts` — curated model catalog keyed by
  `LlmProviderType`.
- `packages/config/src/__tests__/llm-catalog.test.ts` — locks the catalog
  shape.
- `packages/db/drizzle/<timestamp>_drop-news-provider.sql` — data
  migration to merge/delete any `provider_name='news'` rows.
- `apps/hubspot-extension/src/settings/percent-format.ts` — small helper
  - unit tests for the percent ↔ decimal conversion.
- `apps/api/src/routes/settings-test-connection.ts` + test — B4 route.
- `apps/api/src/routes/__tests__/settings-test-connection.test.ts` — B4
  route integration tests (draft key, saved key, cross-tenant, SSRF
  guard, rate limit, sanitized errors).
- `apps/api/src/lib/settings-connection-test.ts` + test — B4 service.
- `apps/api/src/lib/__tests__/settings-connection-test.test.ts` —
  per-provider unit tests with mocked vendor fetches.
- `apps/hubspot-extension/src/settings/connection-test-status.tsx` +
  test — B4 inline status component.
- `apps/hubspot-extension/src/settings/__tests__/connection-test-status.test.tsx`
  — button-disabled, draft-vs-saved dispatch, success/failure render.

## Implementation Phases

### Phase 1: Foundation

- Merge `codex/issue-17-settings-crash` (`c49e239`) into this branch
  before delegating any implementation tasks. Treat this as a hard gate,
  not an optional note.
- Verify current `@hubspot/ui-extensions` `NumberInput` / `Select` APIs
  support tooltips + provider-dropdown layout via Context7
  (`/hubspot/ui-extensions`, resolve-latest). Lock any API surprises
  here, not mid-implementation.
- Re-verify the curated model catalog against live docs:
  OpenAI, Anthropic, Gemini, OpenRouter. Record the verification
  snapshot in the PR body.
- Confirm (via DB inspection in local + staging if available) whether
  any tenant has a `provider_name='news'` row. Drives whether the
  migration is delete-only or merge-then-delete.

### Phase 2: Core Implementation

- Land Issue A on its own branch (`codex/settings-ux-polish`). Ship and
  verify in portal before starting Issue B.
- Start Issue B on a new branch (`codex/settings-surface-redesign`).
  Order inside B:
  B2 first (remove fake enrichment key — smallest wire delta),
  B3 next (LLM redesign + catalog),
  B1 (drop news — largest wire + DB delta),
  B4 last (connection testing — depends on the finalized wire +
  settings-page so the button wiring has a stable surface).
- Every sub-change follows red → green TDD discipline per
  `AI_CODING_RULES_AND_STANDARDS.md`.

### Phase 3: Integration & Polish

- Full portal smoke: save/reload settings, confirm masked keys, confirm
  percent display, confirm model dropdown switches, confirm endpoint URL
  appears only under `custom`.
- Confirm zero snapshot regressions (`snapshot-assembler` + adapter
  tests still green).
- Ship Issue A PR first, then Issue B.

## Team Orchestration

- You operate as the team lead and orchestrate the team to execute the plan.
- You're responsible for deploying the right team members with the right context to execute the plan.
- IMPORTANT: You NEVER operate directly on the codebase. You use `Task` and `Task*` tools to deploy team members to the building, validating, testing, deploying, and other tasks.
  - This is critical. Your job is to act as a high level director of the team, not a builder.
  - Your role is to validate all work is going well and make sure the team is on track to complete the plan.
  - You'll orchestrate this by using the Task\* Tools to manage coordination between the team members.
  - Communication is paramount. You'll use the Task\* Tools to communicate with the team members and ensure they're on track to complete the plan.
- Take note of the session id of each team member. This is how you'll reference them.

### Team Members

- Specialist
  - Name: `builder-ux-polish`
  - Role: Issue A. Card rename, tooltips, percent-display helper, all
    within `apps/hubspot-extension/src/settings/` and
    `apps/hubspot-project/src/app/cards/card-hsmeta.json`. TDD: failing
    percent-format test first, green after.
  - Agent Type: `frontend-specialist`
  - Resume: true
- Specialist
  - Name: `builder-wire-contract`
  - Role: Issue B wire + validator + domain-types changes
    (`packages/config`, `packages/validators`). Drops `news`, drops
    enrichment `apiKey`, adds the LLM catalog module + shape test.
  - Agent Type: `backend-engineer`
  - Resume: true
- Specialist
  - Name: `builder-settings-backend`
  - Role: Issue B backend. `apps/api/src/lib/settings-service.ts`,
    `apps/api/src/routes/settings.ts`, adapter factory wiring so the
    `news` adapter is driven by the Exa provider row. DB migration to
    merge/drop existing `news` provider rows.
  - Agent Type: `backend-engineer`
  - Resume: true
- Specialist
  - Name: `builder-settings-frontend`
  - Role: Issue B frontend. Rewrite `settings-page.tsx` for the new
    surface: provider→model cascade, curated catalog, conditional
    endpoint URL, key masking + clear, enrichment OAuth copy, single
    Exa toggle.
  - Agent Type: `frontend-specialist`
  - Resume: true
- Security Reviewer
  - Name: `security-review`
  - Role: Confirm AES-256-GCM envelope path still in force, masked
    inputs + `hasApiKey` boolean are the only surfaces, `clearApiKey`
    path verified, no accidental plaintext leakage in logs or error
    bodies.
  - Agent Type: `security-auditor`
  - Resume: false
- Quality Engineer (Validator)
  - Name: `validator`
  - Role: Validate completed work against acceptance criteria
    (read-only inspection mode). Runs every validation command, records
    pass/fail, confirms no out-of-scope files touched.
  - Agent Type: quality-engineer
  - Resume: false

## Step by Step Tasks

- IMPORTANT: Execute every step in order, top to bottom. Each task maps directly to a `TaskCreate` call.
- Before you start, run `TaskCreate` to create the initial task list that all team members can see and execute.

### 0. Preflight: merge the verified #17 fix first

- **Task ID**: `merge-issue-17-base`
- **Depends On**: none
- **Assigned To**: team lead / operator
- **Parallel**: false
- Merge or rebase `codex/issue-17-settings-crash` into
  `codex/settings-product-followup` so commit `c49e239` is reachable from
  `HEAD` before starting any delegated work.
- Verify with:
  - `git merge-base --is-ancestor c49e239 HEAD`
  - exit code must be `0`
- If this preflight is not satisfied, stop. Do not delegate Issue A or B.

### 1. Research: HubSpot UI-extensions tooltip & Select APIs

- **Task ID**: `research-ui-extension-apis`
- **Depends On**: none
- **Assigned To**: `builder-ux-polish`
- **Agent Type**: `frontend-specialist`
- **Parallel**: true
- Use Context7 (`/hubspot/ui-extensions` — resolve latest) to confirm:
  - `NumberInput` supports `tooltip` prop (or the equivalent).
  - `Select` supports a reactive re-render when options change.
- Capture the verified API surface in a short note in the PR body.

### 2. Research: curated LLM model catalog verification

- **Task ID**: `research-llm-catalog`
- **Depends On**: none
- **Assigned To**: `builder-wire-contract`
- **Agent Type**: `backend-engineer`
- **Parallel**: true
- Verify each model ID against live docs via Context7:
  `/openai` OpenAI platform, `/anthropics/claude-docs` Anthropic,
  `/google-gemini` Gemini, `/openrouter` OpenRouter.
- Produce the final model list per provider (update the catalog list in
  this plan's Phase 1 section if any ID is wrong or missing).
- Record the verification snapshot (library id + topic + date) in the
  commit message.

### 3. Issue A: card rename

- **Task ID**: `rename-card-account-planning`
- **Depends On**: `research-ui-extension-apis`
- **Assigned To**: `builder-ux-polish`
- **Agent Type**: `frontend-specialist`
- **Parallel**: false
- Change `apps/hubspot-project/src/app/cards/card-hsmeta.json`
  `config.name` from `"Account Signal"` to `"Account Planning"`.
- Grep the repo for other user-facing `"Account Signal"` copy; change
  those too (e.g., docs, PR templates), but scope strictly to
  user-facing strings — do not rename code identifiers.
- Rebuild via `pnpm tsx scripts/bundle-hubspot-card-cli.ts`; verify the
  rebuilt card bundle still externalizes React.

### 4. Issue A: percent-format helper + test (red → green)

- **Task ID**: `percent-format-helper`
- **Depends On**: `research-ui-extension-apis`
- **Assigned To**: `builder-ux-polish`
- **Agent Type**: `frontend-specialist`
- **Parallel**: true (with task 3)
- Create
  `apps/hubspot-extension/src/settings/percent-format.ts` with
  `decimalToPercent(n: number): number` (multiply by 100, round to 1
  decimal) and `percentToDecimal(n: number): number` (divide by 100,
  clamp 0..1).
- Create `__tests__/percent-format.test.ts` asserting round-trip for
  `0`, `0.65`, `1`, boundary rounding, and NaN-rejection.
- Confirm red first, then green.

### 5. Issue A: tooltips + percent display in settings page

- **Task ID**: `tooltips-and-percent`
- **Depends On**: `percent-format-helper`, `research-ui-extension-apis`
- **Assigned To**: `builder-ux-polish`
- **Agent Type**: `frontend-specialist`
- **Parallel**: false
- In `settings-page.tsx`:
  - Attach `tooltip` prop to the two `NumberInput` controls:
    - Freshness max days: "Evidence older than this is treated as stale
      and won't feed the reason-to-contact."
    - Minimum confidence: "Evidence below this confidence (0–100%) is
      dropped before it reaches the UI."
  - Wrap the min-confidence NumberInput with the percent helpers so the
    user sees `65` / `65%` while the wire payload stays `0.65`.
- Update
  `apps/hubspot-extension/src/settings/__tests__/settings-page.test.tsx`
  to assert the percent round-trip and that the tooltip prop is set.

### 6. Issue A: Release Issue A

- **Task ID**: `ship-issue-a`
- **Depends On**: `rename-card-account-planning`, `tooltips-and-percent`
- **Assigned To**: `builder-ux-polish`
- **Agent Type**: `frontend-specialist`
- **Parallel**: false
- Run the focused validation commands (see Validation Commands).
- Rebuild bundles; operator smoke-tests the portal.
- Open PR for Issue A. Do not start Issue B work until A is merged (or
  Romeo explicitly greenlights parallel work).

### 7. Issue B: pre-migration DB inspection

- **Task ID**: `inspect-news-rows`
- **Depends On**: `ship-issue-a`
- **Assigned To**: `builder-settings-backend`
- **Agent Type**: `backend-engineer`
- **Parallel**: false
- Query local + staging for
  `SELECT tenant_id, enabled FROM provider_config WHERE provider_name = 'news';`
- Record findings. Drives migration strategy (merge/delete vs preserve
  for manual follow-up in the `news`-only case).

### 8. Issue B: wire contract + validators update

- **Task ID**: `wire-drop-news-and-enrichment-key`
- **Depends On**: `ship-issue-a`, `research-llm-catalog`
- **Assigned To**: `builder-wire-contract`
- **Agent Type**: `backend-engineer`
- **Parallel**: true (with task 7)
- Remove `news` from `SettingsSignalProviders` and
  `SettingsSignalProviderUpdates` in
  `packages/config/src/domain-types.ts`.
- Remove `apiKey` from the `hubspotEnrichment` update leaf.
- Remove both from `packages/validators/src/settings.ts`. Add `.strict()`
  to the signal-providers object schema (or equivalent) so unknown keys
  fail validation.
- Create `packages/config/src/llm-catalog.ts` with the curated catalog
  finalized in task 2.
- Add `packages/config/src/__tests__/llm-catalog.test.ts` locking the
  catalog shape.
- Red-first: add a failing test asserting the new wire shape, watch it
  fail, then apply the change.

### 9. Issue B: settings-service backend update

- **Task ID**: `settings-service-drop-news`
- **Depends On**: `wire-drop-news-and-enrichment-key`,
  `inspect-news-rows`
- **Assigned To**: `builder-settings-backend`
- **Agent Type**: `backend-engineer`
- **Parallel**: false
- `apps/api/src/lib/settings-service.ts`: stop reading/writing the
  `news` slot. Reject `hubspotEnrichment.apiKey` explicitly (defense in
  depth — validator should already catch it, but a 400 guard is cheap).
- Add failing unit tests in
  `apps/api/src/lib/__tests__/settings-service.test.ts` (reject
  enrichment apiKey, no news slot).
- Add failing route test in
  `apps/api/src/routes/__tests__/settings.test.ts` (POST with news field
  returns 400).

### 10. Issue B: signal adapter factory rewire

- **Task ID**: `factory-news-from-exa`
- **Depends On**: `settings-service-drop-news`
- **Assigned To**: `builder-settings-backend`
- **Agent Type**: `backend-engineer`
- **Parallel**: false
- In `apps/api/src/adapters/signal/factory.ts`: when building the `news`
  adapter, source the API key from the Exa provider config instead of a
  separate `news` row. Keep both adapters running (Exa news vertical
  remains a distinct evidence source; we just share a single credential).
- Decide gating: `NewsAdapter` runs only if Exa is enabled. Add a
  settings-JSONB flag on the Exa row (`settings.newsEnabled: boolean`,
  default true) so operators can still turn off news specifically
  without disabling Exa.
- Update `apps/api/src/adapters/signal/__tests__/factory.test.ts` to
  cover: Exa row → builds both adapters; Exa disabled → neither runs;
  `settings.newsEnabled=false` → only Exa main runs.

### 11. Issue B: DB migration for news rows

- **Task ID**: `db-migrate-drop-news`
- **Depends On**: `factory-news-from-exa`
- **Assigned To**: `builder-settings-backend`
- **Agent Type**: `backend-engineer`
- **Parallel**: false
- Write a new migration `<timestamp>_drop-news-provider.sql` that:
  - For each tenant with both `news` and `exa` rows: set Exa's
    `settings.newsEnabled` to (news.enabled) and delete the news row.
  - For each tenant with only a `news` row and no `exa` row: leave the
    news row but log a warning in the migration script (no tenant data
    loss).
  - For tenants with neither: no-op.
- Add an integration test that boots the migration against a fixture DB
  with all three cases.

### 12. Issue B: frontend settings-page rewrite

- **Task ID**: `settings-page-rewrite`
- **Depends On**: `wire-drop-news-and-enrichment-key`
- **Assigned To**: `builder-settings-frontend`
- **Agent Type**: `frontend-specialist`
- **Parallel**: false
- Rewrite `settings-page.tsx` per the Solution Approach:
  - Single Exa provider section (rename label to "Web research (Exa)"
    or similar — lock exact copy via task 1 research).
  - Remove News toggle + News key input.
  - Remove HubSpot enrichment API key input. Keep toggle. Add OAuth
    explainer copy.
  - LLM section: Provider dropdown → Model dropdown from
    `LLM_CATALOG`. Conditional Endpoint URL field for `provider ===
"custom"`. Clear-key button when `hasApiKey` is true (sends
    `clearApiKey: true`).
  - Wire the percent-format helper from Issue A into Minimum confidence.
- Update `__tests__/settings-page.test.tsx` to cover:
  - Only Exa + HubSpot enrichment sections render.
  - No News-related controls exist.
  - No HubSpot enrichment API key input exists.
  - Endpoint URL only appears for Custom.
  - Model dropdown switches when Provider switches.
  - Clear-key button sends the right payload.

### 12a. Issue B (B4): test-connection endpoint scaffold

- **Task ID**: `test-connection-endpoint-scaffold`
- **Depends On**: `wire-drop-news-and-enrichment-key`
- **Assigned To**: `builder-settings-backend`
- **Agent Type**: `backend-engineer`
- **Parallel**: true (with `settings-page-rewrite`)
- Extend `packages/config/src/domain-types.ts` with
  `TestConnectionBody` and `TestConnectionResponse` wire types per the
  Solution Approach B4 spec (discriminated union on `target`).
- Extend `packages/validators/src/settings.ts` with
  `testConnectionBodySchema` + `testConnectionResponseSchema`.
  `.strict()` on every object; refine to reject `apiKey` + `useSavedKey`
  present together (XOR).
- Add a new Hono route at `apps/api/src/routes/settings-test-connection.ts`
  mounted under the existing settings router. Enforce tenant auth
  middleware (reuse whatever `routes/settings.ts` already uses). Dispatch
  to the service layer by discriminator. Sanitize all vendor errors to
  the narrow `code` union.
- Wire a per-tenant rate limiter (5 req/min default). Pick the existing
  rate-limit primitive in the codebase if one exists; otherwise add a
  minimal in-memory token-bucket keyed by `tenant_id`.
- Red-first: add failing tests in
  `apps/api/src/routes/__tests__/settings-test-connection.test.ts`:
  - 400 on missing `target`
  - 400 when `apiKey` and `useSavedKey` both set
  - 400 when `custom` provider lacks `endpointUrl`
  - 401/403 for untenanted request
  - cross-tenant isolation: tenant A cannot hit tenant B's saved key
  - rate limit triggers 429 after N calls
  - success response shape matches the schema (type-check test)

### 12b. Issue B (B4): LLM connection-test service

- **Task ID**: `llm-connection-test-service`
- **Depends On**: `test-connection-endpoint-scaffold`
- **Assigned To**: `builder-settings-backend`
- **Agent Type**: `backend-engineer`
- **Parallel**: true (with `exa-connection-test-service`)
- In `apps/api/src/lib/settings-connection-test.ts`, add
  `testLlmConnection(tenantId, body)` covering all 5 provider branches:
  - OpenAI → `GET /v1/models`
  - Anthropic → `POST /v1/messages` `max_tokens: 1`
  - Gemini → cheapest verified endpoint (confirm via Context7 at build
    time)
  - OpenRouter → `GET /api/v1/models` + slug filter
  - Custom → `GET {endpointUrl}/models` with SSRF guard
- Saved-key path: load ciphertext via the existing encryption helper,
  decrypt in-process, never log, never echo.
- Red-first tests (unit level with mocked fetch):
  - each provider maps 401 → `{ ok: false, code: "auth" }`
  - each provider maps 404-on-model → `{ ok: false, code: "model" }`
  - custom provider rejects http://localhost/, 169.254.169.254, 10.x,
    172.16.x, 192.168.x URLs with `code: "endpoint"`
  - custom provider rejects non-HTTPS with `code: "endpoint"`
  - success returns `latencyMs > 0` and `providerEcho.model`
  - logger spy receives no plaintext key fragment

### 12c. Issue B (B4): Exa connection-test service

- **Task ID**: `exa-connection-test-service`
- **Depends On**: `test-connection-endpoint-scaffold`
- **Assigned To**: `builder-settings-backend`
- **Agent Type**: `backend-engineer`
- **Parallel**: true (with `llm-connection-test-service`)
- In the same `settings-connection-test.ts` module, add
  `testExaConnection(tenantId, body)`:
  - POST `https://api.exa.ai/search` with a trivial query + `numResults:
1` using draft-or-saved key.
  - Map 401/403 → `code: "auth"`; 429 → `code: "rate_limit"`;
    network/5xx → `code: "network"`.
- Red-first tests (same test file):
  - 401 → `code: "auth"`
  - 429 → `code: "rate_limit"`
  - success returns `latencyMs > 0`
  - logger spy receives no plaintext key fragment
  - saved-key path loads ciphertext for the correct tenant only

### 12d. Issue B (B4): Test-connection UI

- **Task ID**: `test-connection-ui`
- **Depends On**: `settings-page-rewrite`, `llm-connection-test-service`,
  `exa-connection-test-service`
- **Assigned To**: `builder-settings-frontend`
- **Agent Type**: `frontend-specialist`
- **Parallel**: false
- Add `apps/hubspot-extension/src/settings/connection-test-status.tsx`
  — tiny component rendering one of: idle, loading (spinner), success
  (green check + `{latencyMs}ms`), failure (red + `{code}: {message}`).
- Add a `testConnection()` helper to
  `apps/hubspot-extension/src/settings/use-settings.ts`.
- Add a `Test connection` button to the LLM block AND the Exa block in
  `settings-page.tsx`:
  - Disabled when no draft key AND no `hasApiKey` on file.
  - Uses draft key if the password input has a value, otherwise sends
    `useSavedKey: true`. Never sends the masked placeholder.
  - Never auto-fires on keystroke. Only on click.
  - Renders `connection-test-status.tsx` inline directly below the
    button.
- Red-first tests in
  `apps/hubspot-extension/src/settings/__tests__/connection-test-status.test.tsx`
  and
  `apps/hubspot-extension/src/settings/__tests__/settings-page.test.tsx`:
  - button disabled when neither draft nor saved key exists
  - click with draft key sends `apiKey`, never `useSavedKey`
  - click with stored key only sends `useSavedKey: true`
  - success status renders latency
  - failure status renders `code` and `message`
  - status component does NOT auto-fire on input change

### 13. Issue B: security review

- **Task ID**: `issue-b-security-review`
- **Depends On**: `settings-page-rewrite`, `db-migrate-drop-news`
- **Assigned To**: `security-review`
- **Agent Type**: `security-auditor`
- **Parallel**: false
- Confirm AES-256-GCM envelope is still used for Exa + LLM key
  persistence, `keyVersion` path intact, masked inputs (`type=password`),
  no plaintext in server logs or error bodies, `clearApiKey` clears both
  ciphertext and key version correctly, multi-tenant isolation on the
  affected queries.
- Operates in read-only review mode; report findings, do not modify
  files.

### 14. Issue B: final validation

- **Task ID**: `validate-all`
- **Depends On**: `settings-page-rewrite`, `db-migrate-drop-news`,
  `issue-b-security-review`
- **Assigned To**: `validator`
- **Agent Type**: `quality-engineer`
- **Parallel**: false
- Run all Validation Commands.
- Verify acceptance criteria met (every bullet in the Acceptance Criteria
  section).
- Operate in validation mode: inspect and report only, do not modify
  files.
- Confirm zero changes to lifecycle code (issue #19), Taskmaster state,
  `apps/hubspot-project/src/app/app-hsmeta.json` (no scope changes —
  scope work is Issue C).

### 15. Issue B: PR + operator verification

- **Task ID**: `ship-issue-b`
- **Depends On**: `validate-all`
- **Assigned To**: `builder-settings-frontend`
- **Agent Type**: `frontend-specialist`
- **Parallel**: false
- Open PR for Issue B.
- Operator runs `pnpm tsx scripts/hs-project-upload.ts --profile local`
  and verifies the portal surface.
- Issue C remains deferred; do NOT start it in this lane.

## Acceptance Criteria

Issue A:

1. `apps/hubspot-project/src/app/cards/card-hsmeta.json` `config.name`
   reads `Account Planning`.
2. Freshness max days and Minimum confidence both have tooltips
   rendered in the HubSpot settings page.
3. Minimum confidence is displayed to the operator as a percent
   (`0.65 ↔ 65%`), but the wire/DB value is still the raw decimal
   `0.65`. Round-trip test locks this invariant.
4. Existing settings behavior unchanged otherwise.
5. No scope changes, no wire contract changes, no DB changes.

Issue B:

6. `SettingsSignalProviders` and `SettingsSignalProviderUpdates` no
   longer expose `news`.
7. `SettingsUpdate.llm` no longer accepts an `apiKey` field on
   `hubspotEnrichment`. The validator rejects it (400).
8. `NewsAdapter` still runs and produces evidence, now driven by the
   Exa provider's API key; disabling Exa disables News; Exa-row
   `settings.newsEnabled=false` disables News only.
9. DB migration handles all three tenant states truthfully:
   - both `news` + `exa` rows: merge into Exa and delete the news row
   - `exa`-only: no-op
   - `news`-only: do **not** silently delete tenant data; either preserve
     the row for manual follow-up or convert it safely via an explicit
     migration rule proved by test
10. Settings page renders: one Exa section (no separate News), HubSpot
    enrichment section with OAuth copy and NO API key input, LLM
    section with provider dropdown → model dropdown, endpoint URL field
    appears only for `provider === "custom"`, API key field is masked,
    Clear-key button posts `clearApiKey: true`.
11. `packages/config/src/llm-catalog.ts` exists and is covered by a
    shape test; catalog includes OpenAI, Anthropic, Gemini, OpenRouter
    curated top models, DeepSeek, MiniMax, and at least 3 open-source /
    free options.
12. AES-256-GCM envelope still used for Exa + LLM keys; `hasApiKey`
    boolean is the only exposure; security review signs off.
13. No changes to `apps/hubspot-project/src/app/app-hsmeta.json` scopes.
14. No changes to lifecycle files (issue #19), no Taskmaster changes,
    no changes outside the Relevant Files list.
15. All focused tests green; portal smoke passes.

Issue B — B4 (connection testing):

16. `POST /settings/test-connection` exists, is tenant-scoped, and
    validates the discriminated-union body. Missing or ambiguous body
    fields return 400.
17. LLM test path verifies (a) API key accepted by the provider, (b)
    selected model is callable, and (c) for `provider === "custom"` the
    endpoint URL is valid (HTTPS, non-private, non-metadata). Failures
    are mapped to `code ∈ { auth, model, endpoint, network, rate_limit,
unknown }` with a sanitized `message`.
18. Exa test path verifies the Exa API key by performing a minimal
    `api.exa.ai/search` call with a trivial query.
19. Both paths support a draft (unsaved) key via `apiKey` in the request
    body AND a saved key via `useSavedKey: true`. Draft and saved are
    mutually exclusive (XOR enforced by validator).
20. Plaintext keys NEVER appear in HTTP responses, server logs, or
    error bodies. Logger-spy tests assert no key fragment leaks.
21. Tenants cannot test another tenant's saved key — cross-tenant
    isolation test green.
22. Per-tenant rate limit returns 429 after threshold (default 5/min)
    and the limiter is covered by a test.
23. Frontend renders a `Test connection` button in the LLM block AND
    the Exa block. Button is disabled when no draft key and no
    `hasApiKey` on file. Button never auto-fires on keystroke.
24. Inline status UI renders idle / loading / success (latency) /
    failure (code + message). No automatic retest on input change.
25. No plaintext key value is passed to the status component or stored
    in frontend state beyond the single in-flight request body.

## Validation Commands

Execute these commands to validate the task is complete:

Issue A:

- `git merge-base --is-ancestor c49e239 HEAD` — expect exit code `0`
  before any other command in this lane.
- `pnpm exec vitest run apps/hubspot-extension/src/settings` — settings
  UI and percent-format tests.
- `API_ORIGIN=https://hap.mandigital.dev pnpm tsx scripts/bundle-hubspot-card-cli.ts`
  — rebuild bundles with a real origin.
- `grep -c "Account Signal" apps/hubspot-project/src/app/cards/card-hsmeta.json`
  — expect 0.
- Operator portal smoke: open the company record, confirm card title is
  "Account Planning"; open Connected Apps → HAP Signal Workspace →
  Settings, confirm tooltips appear and minimum confidence shows `%`.

Issue B:

- `git merge-base --is-ancestor c49e239 HEAD` — expect exit code `0`
  before any Issue B work begins.
- `pnpm exec vitest run packages/config packages/validators` — wire +
  validator + catalog tests.
- `pnpm exec vitest run apps/api/src/lib/__tests__/settings-service.test.ts apps/api/src/routes/__tests__/settings.test.ts`
  — backend settings tests.
- `pnpm exec vitest run apps/api/src/adapters/signal/__tests__/factory.test.ts`
  — signal factory rewire.
- `pnpm exec vitest run apps/hubspot-extension/src/settings` — frontend
  settings tests.
- Run the DB migration against a local fixture DB with all three
  tenant-state cases (news-only, exa-only, both) and verify the
  resulting rows.
- Operator portal smoke: save the settings page with a new Exa key,
  reload, confirm "Stored key on file"; swap providers in the LLM
  dropdown and confirm the model dropdown updates; select Custom and
  confirm Endpoint URL appears.

Issue B — B4 (connection testing):

- `pnpm exec vitest run apps/api/src/routes/__tests__/settings-test-connection.test.ts`
  — route scaffold, 400/401/403/429 paths, XOR enforcement, cross-tenant
  isolation.
- `pnpm exec vitest run apps/api/src/lib/__tests__/settings-connection-test.test.ts`
  — per-provider mapping (OpenAI/Anthropic/Gemini/OpenRouter/Custom/Exa),
  SSRF guard, logger-spy leak check, saved-key tenant scoping.
- `pnpm exec vitest run apps/hubspot-extension/src/settings/__tests__/connection-test-status.test.tsx`
  — idle/loading/success/failure render.
- `pnpm exec vitest run apps/hubspot-extension/src/settings/__tests__/settings-page.test.tsx`
  — button-disabled rules, draft-vs-saved dispatch, no-auto-fire on
  keystroke.
- Operator portal smoke: click `Test connection` on the LLM block with
  a wrong key — expect red failure with `auth` code; click with a real
  key — expect green success with latency; repeat for Exa block;
  attempt 6 rapid clicks — expect rate-limit 429 response rendered
  inline.

## Notes

- Issue #19 (lifecycle subscription delivery) is explicitly out of
  scope. No changes to
  `apps/hubspot-project/src/app/webhooks/webhooks-hsmeta.json`, no
  changes to `apps/api/scripts/lifecycle-bootstrap.ts`, no changes to
  `apps/api/src/routes/admin/lifecycle-bootstrap.ts`.
- Issue C (scope expansion) is explicitly deferred. The research output
  in "Solution Approach" captures the recommended scope set so Romeo
  can stage it as a separate issue when he's ready to absorb the
  marketplace-listing update + forced re-install.
- No changes to Taskmaster state, no push without explicit operator
  approval, no broadening into unrelated cleanup.
- Base commit: either `c49e239` (post-#17 fix) if Issue A should build
  on that fix, or `e8adc0b` (Slice 11 checkpoint, current branch HEAD)
  if Romeo wants this lane independent of #17. For this plan, treat
  `c49e239` as mandatory. The current worktree is branched from
  `e8adc0b`; merge `c49e239` in before starting Issue A so the settings
  surface continues to render in the portal during development.
- Live docs must be re-verified at implementation time via Context7
  (preferred) and Firecrawl only as a fallback. Commit messages must
  record the verification snapshot.
- **B4 security posture (connection testing):** plaintext API keys
  MUST remain write-only. The test-connection endpoint accepts drafts
  in the request body and saved-key requests via a boolean; it never
  echoes keys in responses, never logs them, and never returns vendor
  error bodies verbatim. Vendor errors are sanitized to a narrow
  `code` union. Custom-provider endpoint URLs are SSRF-guarded
  (HTTPS-only, reject loopback/link-local/private ranges and cloud
  metadata IPs). A per-tenant rate limiter (default 5/min) prevents
  the test path from becoming a free-tier DoS vector. Saved-key
  decryption happens in-process only and the plaintext is discarded
  immediately after the vendor call. Cross-tenant isolation is
  covered by an explicit test.
