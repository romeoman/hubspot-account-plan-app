# Plan: Slice 3 — OAuth Public App, Real LLM Adapters, Card Bundling

## Task Description

Slice 3 makes the Signal-First Account Workspace **installable by any HubSpot
customer** and **safe to run against real LLM/signal providers without mock
fallbacks**. It delivers on the three hard blockers documented in Slice 2's
scope deferrals:

1. **OAuth migration** — flip `apps/hubspot-project/src/app/app-hsmeta.json`
   from `auth.type: "static" / distribution: "private"` (single dev portal
   only) to `auth.type: "oauth" / distribution: "marketplace"` (or
   `"private"` with allowlist for pilot). Full migration plan already
   documented in `docs/security/SECURITY.md` §16 — this plan executes it.
2. **Real provider adapters + fallback removal** — real Anthropic and Gemini
   LLM adapters (OpenAI already real in Slice 2), real HubSpot-enrichment
   signal adapter, real News signal adapter. Remove the mock-fallback branch
   in `apps/api/src/routes/snapshot.ts` so misconfigured tenants surface an
   explicit `provider_unconfigured` error instead of silently serving mock
   data.
3. **Card bundling bridge** — bundle the React extension from
   `apps/hubspot-extension/` into `apps/hubspot-project/src/app/cards/` before
   `hs project upload` so the real `SnapshotStateRenderer` (not the
   placeholder card) ships to the HubSpot bundler. Slice 2 left this as
   `@todo Slice 3` in `apps/hubspot-extension/src/features/snapshot/hooks/use-snapshot.ts`.

Defense-in-depth layer (hard requirements per CLAUDE.md + SECURITY.md):

4. **Replay-nonce store** for HubSpot `X-HubSpot-Signature-v3` — within the
   5-minute freshness window the same signature is currently replayable.
   Add a `signed_request_nonce` table with a composite dedup key of
   `(tenant_id, signed-request timestamp, SHA-256 body hash)`, rejecting
   duplicates. Tenant-scoped both in the PK and in the index so two tenants
   cannot collide on the same body hash.
5. **Postgres Row-Level Security (RLS)** policies on tenant-scoped tables —
   `snapshots`, `evidence`, `people`, `provider_config`, `llm_config`, and
   the new `tenant_hubspot_oauth` + `signed_request_nonce` tables. Enforced
   via `SET LOCAL app.tenant_id` in every request-scoped DB transaction.
   Belt + braces vs. the app-layer `eq(table.tenantId, ctx.tenantId)`
   already in place. NOTE: `tenants` is deliberately NOT under RLS — it is
   the bootstrap lookup used by the tenant middleware to resolve
   `tenantId` from an inbound `portalId` BEFORE `app.tenant_id` can be
   set. See Solution Approach + SECURITY.md §17.

## Objective

Ship a version of the product that a customer can self-install from HubSpot's
marketplace (or via a private-distribution allowlist for the pilot), land on
their company record, and see a live signal-backed snapshot rendered by the
React extension using their own LLM + signal provider credentials — with zero
mock-adapter code paths reachable in production and zero cross-tenant leakage
surface area.

## Problem Statement

Slice 2 shipped a working end-to-end snapshot pipeline but with three
architectural gaps that block any real customer install:

- **Single-portal auth**: `auth.type: "static"` cannot be installed anywhere
  except the dev portal that created it. A second tenant cannot exist.
- **Mock-fallback reachable in production**: `resolveLlmAdapter` and
  `resolveSignalAdapter` in `apps/api/src/routes/snapshot.ts` silently fall
  back to `createMockLlmAdapter` / `createMockSignalAdapter` when a tenant's
  provider row is missing or a real adapter construction throws. Acceptable
  in Slice 2 (seeded test portal relies on it) but a correctness + trust
  hazard for real customers — violates CLAUDE.md "If evidence is weak,
  prefer explicit empty / suppressed state over bluffing."
- **Placeholder card**: `apps/hubspot-project/src/app/cards/SignalCard.tsx`
  is a stub. The real React component tree lives in
  `apps/hubspot-extension/` but the HubSpot CLI bundler doesn't resolve
  pnpm workspace deps, so the extension never ships.

On top of those gaps, two security hygiene items must land to match the
project's zero-trust posture: signed-request replay prevention and
Postgres RLS.

## Solution Approach

Execute `SECURITY.md §16` migration checklist as Phase 1, then layer real
adapters (Phase 2), card bundling (Phase 3), security hardening (Phase 4),
and QA/hygiene (Phase 5). Each phase is independently shippable behind
feature flags where possible; the slice merges as one PR once all five
phases pass the quality-engineer validator.

Key architectural decisions:

- **Per-tenant OAuth tokens** stored in a dedicated `tenant_hubspot_oauth`
  table (1:1 with `tenants`, separate from the config tables so token
  rotation doesn't churn config snapshots). Portal identity already lives
  on `tenants.hubspot_portal_id` (text, unique) — the OAuth table does
  NOT duplicate it; it only stores tokens + scopes + expiry, keyed by
  `tenant_id`. Tokens encrypted with the existing AES-256-GCM envelope
  from Slice 2 — `encryptProviderKey` is reused. Refresh-token rotation
  is automatic on 401 or `expires_at - 60s`.
- **Tenant provisioning at OAuth callback** (explicit, in this order):
  1. Exchange the `code` for `access_token` + `refresh_token` via
     `POST https://api.hubapi.com/oauth/v1/token`.
  2. Call `GET https://api.hubapi.com/oauth/v1/access-tokens/{token}` to
     fetch `hub_id` (= the HubSpot portal id) plus granted scopes.
  3. `UPSERT tenants ON CONFLICT (hubspot_portal_id) DO UPDATE SET
updated_at = now()` — single source of truth for portal identity.
  4. `UPSERT tenant_hubspot_oauth ON CONFLICT (tenant_id) DO UPDATE`
     storing freshly-encrypted tokens, expiry, scopes.
  5. Redirect the user back to HubSpot via the `returnUrl` query
     parameter HubSpot sends (see install-flow docs).
- **OAuth state = stateless CSRF guard**. State is an HMAC over
  `(nonce, expiresAt)` using `HUBSPOT_CLIENT_SECRET`. Short-lived (10
  min). No DB write. This detects tampering + expiry; it does NOT detect
  single-use replay of an intercepted-but-unexpired state. For Slice 3
  this is the documented tradeoff: the 10-min window plus HTTPS plus the
  fact that replaying state still yields a fresh HubSpot authorization
  (HubSpot binds the code to its own short-lived state server-side) is
  the accepted threat-model posture. If single-use replay becomes a
  requirement, add an `oauth_state_nonce` table in Slice 4 — called out
  in §17 of SECURITY.md.
- **Mock-fallback removal**: the explicit error path is a new `Snapshot`
  state — `eligibilityState: "unconfigured"` + `stateFlags.empty` — the
  UI already handles this via `UnconfiguredView`. No new state to render.
- **Card bundling** via a dedicated pre-upload script
  (`scripts/bundle-hubspot-card.ts`) that runs `vite build` on a NEW
  dedicated entry file `apps/hubspot-extension/src/hubspot-card-entry.tsx`
  — the existing `src/index.tsx` uses `hubspot.extend<'crm.record.tab'>()`
  as a side-effect registration and has no default export, so it cannot
  be re-exported directly. The new entry file exports a default React
  component (the same `SnapshotStateRenderer`-rooted tree) AND calls
  `hubspot.extend` for local-dev parity. The bundler emits a single-file
  UMD output into `apps/hubspot-project/src/app/cards/dist/`, and
  `SignalCard.tsx` becomes a thin re-export shim (`export { default }
from "./dist/index.js"`). Keeps workspace semantics intact; the
  HubSpot CLI bundler only sees a flat `cards/` dir.
- **Replay-nonce** uses `(tenant_id, signed-request timestamp, SHA-256 of
body)` as the dedup key — tenant-scoped both in the PK and in the
  index so two tenants cannot collide on the same body hash. TTL =
  freshness window (5 min). Postgres `INSERT ... ON CONFLICT DO NOTHING`
  makes the insert atomic.
- **RLS** uses session-local `app.tenant_id` set via `SET LOCAL` at the
  top of every request-scoped transaction. The `tenants` table is NOT
  under RLS — it is the bootstrap lookup used by the tenant middleware
  to resolve `tenantId` from an inbound `portalId`, which happens BEFORE
  we can set `app.tenant_id`. Bootstrap-safe tables: `tenants` (read-only
  from the app; writes only via the OAuth callback path). RLS-covered
  tables: `snapshots`, `evidence`, `people`, `provider_config`,
  `llm_config`, `tenant_hubspot_oauth`, `signed_request_nonce`.
- **Request-scoped DB handle on Hono context**. Middleware alone cannot
  transparently coerce every downstream query into a transaction — route
  and service code currently uses a process-wide `db` imported from the
  app entrypoint. Slice 3 introduces `c.set('db', withTenantTxHandle(db,
tenantId))`; routes and services MUST read the handle from context
  (`c.get('db')`) rather than importing the process-wide `db`. This
  refactor is in-scope (see Step 12) and touches every DB-reading
  handler.

## Relevant Files

### Existing files to modify

- `apps/hubspot-project/src/app/app-hsmeta.json` — flip auth to oauth, add `redirectUrls`, set distribution.
- `apps/hubspot-project/src/app/cards/card-hsmeta.json` — update card metadata to point at the bundled React card.
- `apps/hubspot-project/src/app/cards/SignalCard.tsx` — replace placeholder with a thin bundler-shim re-exporting the built extension.
- `apps/api/src/index.ts` — mount `/oauth/install` + `/oauth/callback` routes.
- `apps/api/src/lib/hubspot-client.ts` — refactor to per-tenant token resolution with auto-refresh.
- `apps/api/src/routes/snapshot.ts` — remove mock-fallback branches; surface `provider_unconfigured` as `eligibilityState: "unconfigured"`.
- `apps/api/src/adapters/llm/anthropic.ts` — replace Slice 3 stub with real Anthropic Messages API adapter.
- `apps/api/src/adapters/llm/gemini.ts` — replace Slice 3 stub with real Gemini `generateContent` adapter.
- `apps/api/src/adapters/signal/hubspot-enrichment.ts` — replace Slice 3 stub with real HubSpot-portal-backed signal adapter (reads recent company activity/notes via CRM v3).
- `apps/api/src/adapters/signal/news.ts` — replace Slice 3 stub with a real news-search adapter (Exa news vertical or Bing News — see research task).
- `apps/api/src/middleware/hubspot-signature.ts` — add nonce-check call after signature verification.
- `apps/api/src/middleware/auth.ts` — set request-scoped tenant-bound DB handle on context (`c.set('db', ...)`) so every downstream query runs under RLS.
- `apps/api/src/middleware/tenant.ts` — bootstrap-safe lookup against `tenants` (this table is excluded from RLS, see Solution Approach); resolves `tenantId` before any RLS-scoped work begins.
- `apps/api/src/routes/**/*.ts`, `apps/api/src/services/**/*.ts` — replace every direct import of the process-wide `db` with `c.get('db')` (or a dep injected from the route). This is a mechanical refactor across ~all route/service entrypoints that read/write tenant-scoped tables.
- `packages/db/src/schema/tenants.ts` — unchanged schema columns; the OAuth columns live in a sibling table. NOTE: this table is deliberately excluded from RLS — it is the bootstrap lookup for tenant resolution.
- `apps/hubspot-extension/src/index.tsx` — unchanged; keeps `hubspot.extend<'crm.record.tab'>()` as the local-dev / testing entrypoint.
- `packages/config/src/env.ts` — remove `HUBSPOT_DEV_PORTAL_TOKEN` from Zod schema.
- `.env.example`, `.env.test.example` — remove `HUBSPOT_DEV_PORTAL_TOKEN`, add `HUBSPOT_OAUTH_REDIRECT_BASE_URL`.
- `scripts/seed-hubspot-test-portal.ts` — refactor to use a post-install per-tenant token read from DB (no env var).
- `docs/security/SECURITY.md` — mark §16 as "completed in Slice 3"; add §17 (RLS) and §18 (replay-nonce).
- `docs/qa/slice-2-walkthrough.md` — supersede with `docs/qa/slice-3-walkthrough.md` covering OAuth install → live snapshot.
- `CLAUDE.md` — update "Verified stack versions" table if any new pinned dep lands.

### New files

- `apps/api/src/routes/oauth.ts` — `GET /oauth/install` + `GET /oauth/callback` handlers.
- `apps/api/src/lib/oauth.ts` — state HMAC, token exchange, token-refresh helpers.
- `apps/api/src/lib/tenant-tx.ts` — `withTenantTx(db, tenantId, fn)` helper that wraps a Drizzle transaction with `SET LOCAL app.tenant_id`.
- `apps/api/src/lib/__tests__/oauth.test.ts` — unit tests for state signing + token-exchange cassettes.
- `apps/api/src/routes/__tests__/oauth.test.ts` — integration tests for `/oauth/install` redirect + `/oauth/callback` happy/error paths.
- `apps/api/src/adapters/llm/__tests__/cassettes/anthropic-completion.json` — cassette.
- `apps/api/src/adapters/llm/__tests__/cassettes/gemini-completion.json` — cassette.
- `apps/api/src/adapters/signal/__tests__/cassettes/hubspot-enrichment-{companies,notes}.json` — cassettes.
- `apps/api/src/adapters/signal/__tests__/cassettes/news-search.json` — cassette.
- `apps/api/src/lib/__tests__/replay-nonce.test.ts` — unit tests for nonce-store roundtrip + duplicate rejection.
- `apps/api/src/lib/replay-nonce.ts` — nonce-store implementation (insert + TTL sweep).
- `apps/hubspot-extension/src/hubspot-card-entry.tsx` — NEW dedicated bundler entrypoint. Exports a default React component (the `SnapshotStateRenderer`-rooted tree) so the HubSpot project card can import it. Also calls `hubspot.extend<'crm.record.tab'>()` for local-dev parity. Distinct from `src/index.tsx` which is Vitest/local-dev only.
- `apps/hubspot-extension/vite.config.ts` — NEW Vite config producing a single-file UMD bundle from `hubspot-card-entry.tsx`.
- `packages/db/drizzle/0005_tenant_hubspot_oauth.sql` — migration adds `tenant_hubspot_oauth` table. Columns: `tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE`, `access_token_encrypted text NOT NULL`, `refresh_token_encrypted text NOT NULL`, `expires_at timestamptz NOT NULL`, `scopes text[] NOT NULL`, `key_version int NOT NULL DEFAULT 1 CHECK (key_version > 0)`, `created_at`, `updated_at`. Deliberately no `hub_id` column — portal identity lives on `tenants.hubspot_portal_id`.
- `packages/db/drizzle/0006_signed_request_nonce.sql` — migration adds `signed_request_nonce` table. Columns: `tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`, `timestamp bigint NOT NULL`, `body_hash bytea NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()`, `PRIMARY KEY (tenant_id, timestamp, body_hash)` + index on `created_at` for TTL sweeps.
- `packages/db/drizzle/0007_rls_policies.sql` — migration enables RLS + defines per-table policies reading `current_setting('app.tenant_id')`.
- `packages/db/src/schema/tenant-hubspot-oauth.ts` — Drizzle schema.
- `packages/db/src/schema/signed-request-nonce.ts` — Drizzle schema.
- `packages/db/src/schema/__tests__/rls.test.ts` — proves cross-tenant queries return zero rows under RLS.
- `scripts/bundle-hubspot-card.ts` — runs `vite build` on the extension and copies the bundle into `apps/hubspot-project/src/app/cards/dist/`.
- `docs/qa/slice-3-walkthrough.md` — OAuth install + 8-state live walkthrough on a second test portal.
- `docs/slice-3-preflight-notes.md` — written by Task 0 (`preflight-docs`); captures the Context7-verified HubSpot + Anthropic + Gemini references and the config-profile vs. per-env-manifest decision. Hard gate: no code begins until this file is committed.

## Implementation Phases

### Phase 1: Foundation

**OAuth + per-tenant tokens (blocks everything else):**

1. Preflight task 0 — Context7-verify current HubSpot + Anthropic + Gemini docs and commit `docs/slice-3-preflight-notes.md` with the config-profile-vs-per-env-manifest decision. Hard gate.
2. Add DB migrations `0005_tenant_hubspot_oauth.sql` + schema. Columns follow Relevant Files spec — no `hub_id` on this table; portal identity stays on `tenants.hubspot_portal_id`.
3. Implement `apps/api/src/lib/oauth.ts`: `buildAuthorizeUrl`, `signState`, `verifyState`, `exchangeCodeForTokens`, `refreshAccessToken`, `fetchTokenIdentity`. State HMAC is stateless — no DB. Stateless state detects tampering + expiry only; single-use replay is an accepted gap (see Solution Approach + SECURITY.md §17).
4. Implement `apps/api/src/routes/oauth.ts` with the explicit ordered callback flow: verify state → exchange code → fetch token identity (`hub_id` + scopes) → upsert `tenants` (keyed on `hubspot_portal_id`) → upsert `tenant_hubspot_oauth` (keyed on `tenant_id`) → redirect via `returnUrl`. Error handling for `error=access_denied`, token-exchange 4xx, identity-fetch 4xx, state tampering, state expiry.
5. Refactor `hubspot-client.ts` so every method takes `tenantId` and resolves the token via `getHubspotAccessToken(db, tenantId)`. 401 triggers `refreshAccessToken` + persist rotated tokens + retry once. Concurrent-refresh race guarded by `SELECT FOR UPDATE`.
6. Flip `app-hsmeta.json` (or its config-profile equivalent per Task 0's decision): `auth.type: "oauth"`, `distribution: "${HUBSPOT_DISTRIBUTION}"`, `redirectUrls: ["https://${DOMAIN}/oauth/callback"]`.
7. Remove `HUBSPOT_DEV_PORTAL_TOKEN` from the Zod env schema + `.env.example` + `.env.test.example`.
8. Refactor `scripts/seed-hubspot-test-portal.ts` to look up the post-install tenant token by portal ID (CLI flag), not env var.

### Phase 2: Core Implementation

**Real adapters + mock-fallback removal:**

9. Real Anthropic adapter (`adapters/llm/anthropic.ts`) — Messages API, default model `claude-sonnet-4-6`, cassette-tested, AbortController 30s.
10. Real Gemini adapter (`adapters/llm/gemini.ts`) — `generateContent`, cassette-tested, AbortController 30s.
11. Real HubSpot-enrichment signal adapter (`adapters/signal/hubspot-enrichment.ts`) — reads the current tenant's recent notes/engagements/deals via the OAuth-aware `hubspot-client`. First consumer of the per-tenant token.
12. Real News adapter (`adapters/signal/news.ts`) — default Exa news vertical (re-uses `EXA_API_KEY`); cassette-tested. Decision documented inline.
13. Remove mock-fallback from `apps/api/src/routes/snapshot.ts`: `resolveLlmAdapter` + `resolveSignalAdapter` return `{ status: "unconfigured" }` on missing provider row or construction failure; route surfaces `eligibilityState: "unconfigured"` via the existing snapshot-assembler path. Mocks remain only under `__tests__/` fixtures; Biome `no-restricted-imports` prevents regression.
14. Regression sweep: new tests assert the `unconfigured` return path never calls an adapter constructor; existing Slice 1/2 tests still pass.

### Phase 3: Integration & Polish

**Card bundling + security hardening + QA:**

15. New bundler entrypoint `apps/hubspot-extension/src/hubspot-card-entry.tsx` exporting a default React component (shared `ExtensionRoot` factored out of `src/index.tsx`) + `apps/hubspot-extension/vite.config.ts` producing a UMD bundle. `scripts/bundle-hubspot-card.ts` copies the bundle into `apps/hubspot-project/src/app/cards/dist/`; `SignalCard.tsx` becomes `export { default } from "./dist/index.js"`. Upload script runs the bundler first.
16. Replay-nonce table migration (`0006_signed_request_nonce.sql`) — composite PK `(tenant_id, timestamp, body_hash)` — plus `apps/api/src/lib/replay-nonce.ts` (`recordNonce(db, { tenantId, timestamp, bodyHash })` returning `{ duplicate: boolean }`). Wired into `hubspot-signature.ts` AFTER signature verification and AFTER `tenantMiddleware` resolves `tenantId`. Cron-style TTL sweep via `scripts/sweep-nonces.ts`.
17. RLS migration (`0007_rls_policies.sql`): enable RLS on `snapshots`, `evidence`, `people`, `provider_config`, `llm_config`, `tenant_hubspot_oauth`, `signed_request_nonce`. `tenants` is DELIBERATELY NOT under RLS (bootstrap lookup). `withTenantTx` + `withTenantTxHandle` implemented; `auth.ts` sets a tenant-bound DB handle on Hono context (`c.set('db', ...)`) and routes/services consume `c.get('db')` instead of the process-wide `db`. Biome `no-restricted-imports` enforces the boundary.
18. New `packages/db/src/schema/__tests__/rls.test.ts` — proves a tenant A session cannot SELECT tenant B rows for every RLS-covered table even when the wrong `tenantId` is passed.
19. Update SECURITY.md: mark §16 complete, add §17 (RLS architecture + the `tenants`-excluded bootstrap path + the stateless-state replay tradeoff) and §18 (replay-nonce architecture, tenant-scoped dedup key). Author `docs/qa/slice-3-walkthrough.md` covering two-portal install + 8 states + replay proof + RLS proof.

## Team Orchestration

- Operate as the team lead and orchestrate the team to execute the plan.
- NEVER operate directly on the codebase. Dispatch specialist agents to implement, validate, test, and review; the lead's role is to provide context, monitor progress, and integrate handoffs between agents.
- Use the runtime's agent-dispatch primitives to spawn specialist agents. Mirror the Slice 2 execution precedent exactly: sequential agent dispatches under the lead, with each agent returning a handoff summary (modified files, contracts produced, tests added) that the lead pastes into the next agent's context. No specific task-list tool is assumed — if the runtime exposes a shared task board, use it; otherwise the lead tracks progress in plain notes.
- Record each agent's returned identifier (session id / agent id) so follow-up work on the same area re-enters the same context where that benefits integration.
- Communication is paramount: keep inter-agent contracts (schemas, interfaces, endpoint specs) flowing through the shared task list and through the lead.

### Team Members

- Specialist
  - Name: `builder-oauth`
  - Role: OAuth install/callback endpoints, token exchange + refresh, per-tenant token storage, `hubspot-client` refactor, `seed` script rewrite
  - Agent Type: backend-engineer
  - Resume: true
- Specialist
  - Name: `builder-adapters`
  - Role: Real Anthropic + Gemini LLM adapters, real HubSpot-enrichment + News signal adapters, mock-fallback removal
  - Agent Type: backend-engineer
  - Resume: true
- Specialist
  - Name: `builder-db`
  - Role: Drizzle migrations (`tenant_hubspot_oauth`, `signed_request_nonce`, RLS), `withTenantTx` helper, RLS tests
  - Agent Type: supabase-specialist
  - Resume: true
- Specialist
  - Name: `builder-card-bundler`
  - Role: Vite-based bundling of the React extension into `apps/hubspot-project/src/app/cards/`, upload-script integration
  - Agent Type: frontend-specialist
  - Resume: true
- Specialist
  - Name: `security-reviewer`
  - Role: OAuth flow audit (CSRF/state, token-refresh races, log redaction), RLS policy audit, replay-nonce audit
  - Agent Type: security-auditor
  - Resume: false
- Quality Engineer (Validator)
  - Name: `validator`
  - Role: Validate completed work against acceptance criteria (read-only inspection mode)
  - Agent Type: quality-engineer
  - Resume: false

## Step by Step Tasks

### 0. Preflight — verify current docs + config-profile strategy

- **Task ID**: preflight-docs
- **Depends On**: none
- **Assigned To**: builder-oauth
- **Agent Type**: backend-engineer
- **Parallel**: false
- Re-verify the following docs via Context7 (library id `/websites/developers_hubspot`) and capture the current-as-of-today references inline in a short `docs/slice-3-preflight-notes.md`:
  - App configuration reference for `app-hsmeta.json` (OAuth + marketplace, `redirectUrls`, scope fields).
  - Developer-platform config profiles + variable substitution (e.g., `${DOMAIN}` in `redirectUrls`) — decide whether Slice 3 uses config profiles, templated variables, or committed per-env manifests.
  - Request-validation spec (`X-HubSpot-Signature-v3`) — confirm the exact canonicalization, header name, and freshness window Slice 2 implemented still match.
  - OAuth install/return flow: confirm the `returnUrl` query-param contract for "redirect back to HubSpot after install".
  - Token-identity endpoint `GET https://api.hubapi.com/oauth/v1/access-tokens/{token}` — confirm returned fields include `hub_id` + `scopes`.
- Re-verify Anthropic Messages API current shape (`/anthropics/anthropic-sdk-typescript` or equivalent) and Gemini `generateContent` current shape.
- Decision: document in the preflight notes which approach Slice 3 uses for multi-environment `redirectUrls` and `distribution` (recommended default: config profiles with `${DOMAIN}` + `${HUBSPOT_DISTRIBUTION}` substitution).
- This task is a hard gate: no code work begins until the preflight notes are committed and linked from this plan.

### 1. Worktree + branch bootstrap

- **Task ID**: worktree-bootstrap
- **Depends On**: preflight-docs
- **Assigned To**: builder-oauth
- **Agent Type**: backend-engineer
- **Parallel**: false
- Create an isolated worktree at `.worktrees/slice-3` on branch `feature/slice-3-oauth-public-app` from `main` (use `git worktree add` directly, or the worktree-management skill if the runtime exposes it — mirror the Slice 2 precedent). Confirm `.worktrees/` is gitignored before proceeding.
- `pnpm install --frozen-lockfile` + `pnpm test` baseline (expect 463/463 pass).

### 2. DB migrations (tenant OAuth + nonce + RLS scaffolding)

- **Task ID**: db-migrations
- **Depends On**: worktree-bootstrap
- **Assigned To**: builder-db
- **Agent Type**: supabase-specialist
- **Parallel**: false
- Write `packages/db/drizzle/0005_tenant_hubspot_oauth.sql` + schema. Columns: `tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE`, `access_token_encrypted text NOT NULL`, `refresh_token_encrypted text NOT NULL`, `expires_at timestamptz NOT NULL`, `scopes text[] NOT NULL`, `key_version int NOT NULL DEFAULT 1 CHECK (key_version > 0)`, `created_at`, `updated_at`. NO `hub_id` column — portal identity lives on `tenants.hubspot_portal_id`. Add a Vitest invariant test that `tenants.hubspot_portal_id` remains the single source of truth for portal identity.
- Write `0006_signed_request_nonce.sql`: `tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`, `timestamp bigint NOT NULL`, `body_hash bytea NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()`, `PRIMARY KEY (tenant_id, timestamp, body_hash)` + index on `created_at` for TTL sweeps.
- Write `0007_rls_policies.sql`: enable RLS + per-table policies on `snapshots`, `evidence`, `people`, `provider_config`, `llm_config`, `tenant_hubspot_oauth`, `signed_request_nonce` using `current_setting('app.tenant_id', true)::uuid`. DO NOT enable RLS on `tenants` — it is the bootstrap lookup used by the tenant middleware before `app.tenant_id` is known. Document this exclusion in SECURITY.md §17.
- Implement `apps/api/src/lib/tenant-tx.ts` — `withTenantTx(db, tenantId, fn)` wraps a Drizzle transaction and runs `SET LOCAL app.tenant_id = '<uuid>'` before `fn`.
- Write `packages/db/src/schema/__tests__/rls.test.ts` — seed two tenants, prove RLS-scoped session A sees zero tenant B rows.
- Update `_journal.json` with entries 5, 6, 7. Run `pnpm db:migrate` against the dev Postgres and confirm idempotency.

### 3. OAuth endpoints + per-tenant token storage

- **Task ID**: oauth-endpoints
- **Depends On**: db-migrations
- **Assigned To**: builder-oauth
- **Agent Type**: backend-engineer
- **Parallel**: false
- Implement `apps/api/src/lib/oauth.ts`: `signState`, `verifyState`, `buildAuthorizeUrl`, `exchangeCodeForTokens`, `refreshAccessToken`, `fetchTokenIdentity` (GET access-tokens/{token}). Use `HUBSPOT_CLIENT_SECRET` for state HMAC. Tokens fetched from `https://api.hubapi.com/oauth/v1/token` (form-encoded body per HubSpot docs).
- Implement `apps/api/src/routes/oauth.ts` with the following explicit callback flow (in order):
  1. Verify `state` via `verifyState` — reject tampered or expired (HTTP 400, friendly plain-HTML error page). NOTE: stateless state cannot detect single-use replay of an unexpired state; the threat model accepts this tradeoff (see Solution Approach + SECURITY.md §17).
  2. `exchangeCodeForTokens(code)` → `{ access_token, refresh_token, expires_in }`.
  3. `fetchTokenIdentity(access_token)` → `{ hub_id, scopes[], user, ... }`.
  4. Upsert `tenants` using `hub_id.toString()` as `hubspot_portal_id` (`INSERT ... ON CONFLICT (hubspot_portal_id) DO UPDATE SET updated_at = now(), name = EXCLUDED.name RETURNING id`).
  5. Encrypt tokens with `encryptProviderKey(plaintext, tenantId)` (reuses Slice 2 envelope).
  6. Upsert `tenant_hubspot_oauth` keyed on `tenant_id` (`ON CONFLICT (tenant_id) DO UPDATE` the token/expiry/scopes columns).
  7. If HubSpot provided a `returnUrl` query parameter, redirect there; otherwise redirect to a success page.
- Mount in `apps/api/src/index.ts` BEFORE the auth middleware (these endpoints are unauthenticated by design).
- Unit tests in `apps/api/src/lib/__tests__/oauth.test.ts`: state roundtrip, tampered-state rejection, expired-state rejection. DO NOT assert single-use replay rejection — stateless state does not provide that property; the test file must explicitly document this boundary so the requirement cannot silently drift back in.
- Integration tests in `apps/api/src/routes/__tests__/oauth.test.ts` covering: happy path (new tenant upsert), happy path (existing tenant update), `error=access_denied`, state tampering, state expiry, HubSpot token-exchange 4xx, HubSpot identity-endpoint 4xx.

### 4. hubspot-client refactor (per-tenant tokens, auto-refresh)

- **Task ID**: client-refactor
- **Depends On**: oauth-endpoints
- **Assigned To**: builder-oauth
- **Agent Type**: backend-engineer
- **Parallel**: false
- Refactor `apps/api/src/lib/hubspot-client.ts`: every method signature gains `tenantId` and resolves the token via `getHubspotAccessToken(db, tenantId)`.
- On 401 or `expires_at - 60s` window: call `refreshAccessToken`, persist rotated tokens (encrypted), retry once.
- Concurrent refresh race: `SELECT FOR UPDATE` on the `tenant_hubspot_oauth` row before refresh; second caller reads the rotated token on retry.
- Delete `HUBSPOT_DEV_PORTAL_TOKEN` from `packages/config/src/env.ts`, `.env.example`, `.env.test.example`, and any references in docs.
- Refactor `scripts/seed-hubspot-test-portal.ts` to accept `--portalId <id>` and look up the tenant token from DB — no env var.
- Update all existing tests that injected `HUBSPOT_DEV_PORTAL_TOKEN` to seed a fake `tenant_hubspot_oauth` row instead.

### 5. HubSpot project OAuth config flip

- **Task ID**: project-config-flip
- **Depends On**: client-refactor
- **Assigned To**: builder-oauth
- **Agent Type**: backend-engineer
- **Parallel**: true
- Follow the config-profile strategy chosen in Task 0 (`preflight-docs`). Default recommendation: committed `app-hsmeta.json` with `${DOMAIN}` + `${HUBSPOT_DISTRIBUTION}` variable substitutions resolved at upload time via HubSpot config profiles — one profile per environment (dev, staging, prod). If preflight chose per-env manifests instead, commit the manifest set and document the selector in `UPLOAD.md`.
- Edit `apps/hubspot-project/src/app/app-hsmeta.json` (or the profile equivalent): `auth.type: "oauth"`, `distribution: "${HUBSPOT_DISTRIBUTION}"` (resolves to `"marketplace"` by default; overridable to `"private"` for pilot via profile variable).
- `redirectUrls`: `["https://${DOMAIN}/oauth/callback"]`. Dev/staging/prod all resolve the same template; `${DOMAIN}` is profile-scoped.
- Confirm `requiredScopes` still limited to `crm.objects.companies.read` + `crm.objects.contacts.read` (PRD wedge — no deal/ticket scopes).
- Update `apps/hubspot-project/UPLOAD.md` with: which profile to use per environment, how `${DOMAIN}` + `${HUBSPOT_DISTRIBUTION}` are set, and post-install verification steps.
- Validate JSON via `apps/hubspot-project/__validate__/scaffold.test.ts`. Extend the test to cover variable-substitution syntax vs. fully-resolved output.

### 6. Real Anthropic LLM adapter

- **Task ID**: adapter-anthropic
- **Depends On**: client-refactor
- **Assigned To**: builder-adapters
- **Agent Type**: backend-engineer
- **Parallel**: true
- Replace `apps/api/src/adapters/llm/anthropic.ts` stub with a real adapter calling `POST https://api.anthropic.com/v1/messages`.
- Cassette at `apps/api/src/adapters/llm/__tests__/cassettes/anthropic-completion.json`. Default model `claude-sonnet-4-6`, max_tokens per `MAX_NEXT_MOVE_CHARS` budget.
- 30s AbortController timeout, structured error on 4xx/5xx.
- Register in `createLlmAdapter` factory (replace the `throw new Error("Slice 3...")` branch).

### 7. Real Gemini LLM adapter

- **Task ID**: adapter-gemini
- **Depends On**: client-refactor
- **Assigned To**: builder-adapters
- **Agent Type**: backend-engineer
- **Parallel**: true
- Replace `apps/api/src/adapters/llm/gemini.ts` stub with a real adapter calling `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`.
- Cassette + AbortController + factory registration as in Anthropic.

### 8. Real HubSpot-enrichment signal adapter

- **Task ID**: adapter-hubspot-enrichment
- **Depends On**: client-refactor
- **Assigned To**: builder-adapters
- **Agent Type**: backend-engineer
- **Parallel**: false
- Replace `apps/api/src/adapters/signal/hubspot-enrichment.ts` stub with an adapter that calls the refactored `hubspotClient.getCompany`, `getCompanyNotes`, and `getCompanyEngagements` (add missing methods to the client as needed) scoped to the current tenant's OAuth token.
- Emits `Evidence` rows tagged `source: "hubspot-enrichment"`.
- Cassettes for two calls: companies fetch + notes fetch.
- Register in `createSignalAdapter` factory.

### 9. Real News signal adapter

- **Task ID**: adapter-news
- **Depends On**: worktree-bootstrap
- **Assigned To**: builder-adapters
- **Agent Type**: backend-engineer
- **Parallel**: true
- Research decision: default Exa news vertical (re-use existing `EXA_API_KEY` — no new env surface). Document the decision inline.
- Replace `apps/api/src/adapters/signal/news.ts` stub with real Exa news call.
- Cassette + factory registration.

### 10. Remove mock-fallback from snapshot route

- **Task ID**: remove-mock-fallback
- **Depends On**: adapter-anthropic, adapter-gemini, adapter-hubspot-enrichment, adapter-news
- **Assigned To**: builder-adapters
- **Agent Type**: backend-engineer
- **Parallel**: false
- Delete `createMockLlmAdapter` / `createMockSignalAdapter` imports from `apps/api/src/routes/snapshot.ts`.
- `resolveLlmAdapter` + `resolveSignalAdapter` return `{ status: "unconfigured" }` on missing provider row or adapter construction failure.
- Thread `unconfigured` through `assembleSnapshot` — emits a `Snapshot` with `eligibilityState: "unconfigured"` + `stateFlags.empty: true`. UI's existing `UnconfiguredView` renders it.
- Add new tests asserting that a tenant with no `provider_config` row gets `unconfigured` (not mock data).
- Keep `createMockLlmAdapter` + `createMockSignalAdapter` files in the repo for test-only usage under `__tests__/` — they must never be imported outside tests (add a lint rule or a `no-restricted-imports` Biome config).

### 11. Replay-nonce store

- **Task ID**: replay-nonce
- **Depends On**: db-migrations
- **Assigned To**: builder-oauth
- **Agent Type**: backend-engineer
- **Parallel**: true
- Implement `apps/api/src/lib/replay-nonce.ts`: `recordNonce(db, { tenantId, timestamp, bodyHash })` — `INSERT ... ON CONFLICT (tenant_id, timestamp, body_hash) DO NOTHING`, returns `{ duplicate: boolean }`. The composite PK is tenant-scoped (see Solution Approach + migration spec).
- Wire into `apps/api/src/middleware/hubspot-signature.ts` after signature verification (and after tenantMiddleware resolves `tenantId`) — reject with `401 { error: "replay_detected" }` on duplicate.
- TTL sweep: add `scripts/sweep-nonces.ts` runnable via cron; sweeps rows older than 10 minutes.
- Unit tests in `apps/api/src/lib/__tests__/replay-nonce.test.ts`: duplicate detection (same tenant), concurrency (two inserts race — only one succeeds), cross-tenant independence (tenant A and tenant B with identical `(timestamp, bodyHash)` BOTH succeed — proves the PK is correctly tenant-scoped), TTL sweep.

### 12. RLS enforcement in auth middleware

- **Task ID**: rls-wiring
- **Depends On**: db-migrations, client-refactor
- **Assigned To**: builder-db
- **Agent Type**: supabase-specialist
- **Parallel**: true
- Add `withTenantTxHandle(db, tenantId)` alongside `withTenantTx` in `apps/api/src/lib/tenant-tx.ts`. The handle exposes the same Drizzle query surface but every call goes through a transaction that runs `SET LOCAL app.tenant_id = '<uuid>'` first.
- Refactor `apps/api/src/middleware/auth.ts` to set the tenant-bound handle on Hono context: `c.set('db', withTenantTxHandle(db, tenantId))`. Mount AFTER `tenantMiddleware` so `tenantId` is already resolved (tenantMiddleware's own `tenants` lookup runs WITHOUT the RLS handle — that's intentional; `tenants` is bootstrap-safe, not under RLS).
- Mechanical refactor sweep: replace every direct import of the process-wide `db` in `apps/api/src/routes/**/*.ts`, `apps/api/src/services/**/*.ts`, and service helpers with `c.get('db')` (or accept the handle as a dep injected from the route). Background jobs + the seed script keep direct access but MUST call `withTenantTx(db, tenantId, fn)` explicitly for any tenant-scoped read/write.
- Add a lint rule (`no-restricted-imports` via Biome) that forbids importing the process-wide `db` symbol from any file under `apps/api/src/routes/` or `apps/api/src/services/`. This prevents the refactor from silently regressing.
- Add a regression test: seed tenant A and tenant B rows in `snapshots`; open a session with `withTenantTxHandle(db, tenantB.id)` and attempt to SELECT tenant A rows — must return zero rows. Prove the same for `evidence`, `people`, `provider_config`, `llm_config`, `tenant_hubspot_oauth`.

### 13. Card bundling bridge

- **Task ID**: card-bundler
- **Depends On**: worktree-bootstrap
- **Assigned To**: builder-card-bundler
- **Agent Type**: frontend-specialist
- **Parallel**: true
- Add a NEW dedicated bundler entrypoint at `apps/hubspot-extension/src/hubspot-card-entry.tsx`. This file:
  - Exports a default React component that renders the same `SnapshotStateRenderer`-rooted tree the existing `src/index.tsx` registers — refactor the render function into a shared `ExtensionRoot` component consumed by both `src/index.tsx` and `src/hubspot-card-entry.tsx`.
  - Calls `hubspot.extend<'crm.record.tab'>(...)` for local-dev parity so `hs project dev` still renders when pointed at the built bundle.
  - This is required because `src/index.tsx` uses `hubspot.extend()` as a side-effect-only registration with NO default export — the existing file cannot be directly re-exported.
- Add `apps/hubspot-extension/vite.config.ts`: `build.lib.entry = "src/hubspot-card-entry.tsx"`, `formats = ["umd"]`, `build.lib.name = "HapSignalCard"`, single-file output at `dist/index.js`. Externalize `react`, `react-dom`, and `@hubspot/ui-extensions` (peer deps resolved by the HubSpot card runtime).
- Write `scripts/bundle-hubspot-card.ts`: runs `pnpm --filter @hap/hubspot-extension build`, copies `dist/index.js` (+ `dist/index.css` if any) into `apps/hubspot-project/src/app/cards/dist/`.
- Rewrite `apps/hubspot-project/src/app/cards/SignalCard.tsx` to `export { default } from "./dist/index.js";` — this works because the new entry file provides a default export.
- Update `scripts/hs-project-upload.ts` to invoke `bundle-hubspot-card.ts` first.
- Add `apps/hubspot-project/__validate__/bundle.test.ts` asserting the bundle exists after build AND that `SignalCard.tsx` re-exports it AND that the re-exported component renders a single root element when mounted in a JSDOM environment.

### 14. Second-portal QA walkthrough

- **Task ID**: slice-3-walkthrough
- **Depends On**: project-config-flip, remove-mock-fallback, card-bundler, rls-wiring, replay-nonce
- **Assigned To**: builder-oauth
- **Agent Type**: backend-engineer
- **Parallel**: false
- Install the app on a second HubSpot test portal (`man-digital-dev-account-oct` is portal 1; create or use a second portal for multi-tenant proof).
- Seed 8 QA states in portal 2. Capture company IDs + contact IDs.
- Author `docs/qa/slice-3-walkthrough.md` covering: install flow, two-portal isolation proof, all 8 states rendered, replay-nonce in action (replay the same signed request twice — second fails 401), RLS proof (manually run a cross-tenant query in psql — returns zero rows).
- Mark `docs/qa/slice-2-walkthrough.md` as superseded.

### 15. Documentation sweep

- **Task ID**: docs-sweep
- **Depends On**: slice-3-walkthrough
- **Assigned To**: builder-oauth
- **Agent Type**: backend-engineer
- **Parallel**: false
- Update `docs/security/SECURITY.md`: mark §16 complete, add §17 (RLS architecture: RLS policies, `withTenantTx`, threat model coverage), add §18 (replay-nonce architecture).
- Update `CLAUDE.md` "Verified stack versions" if any new pinned dep landed.
- Update `README.md` install instructions (if present) to point at the new OAuth install URL instead of the private-app token path.

### 16. Security audit

- **Task ID**: security-audit
- **Depends On**: docs-sweep
- **Assigned To**: security-reviewer
- **Agent Type**: security-auditor
- **Parallel**: false
- OAuth flow audit: CSRF (state HMAC), redirect-URL validation, token-refresh race, 401-loop prevention, log redaction (no tokens or codes in structured logs), scope-creep prevention.
- RLS audit: every tenant-scoped table has RLS enabled; every policy uses `current_setting('app.tenant_id', true)::uuid`; no `SECURITY DEFINER` functions bypass RLS.
- Replay-nonce audit: TTL sweep runs, `ON CONFLICT DO NOTHING` is atomic, `bodyHash` is SHA-256 (not weaker), tenantId scoping on the nonce prevents cross-tenant nonce collisions.
- Report PASS / FAIL per area with evidence.

### 17. Code review request

- **Task ID**: code-review
- **Depends On**: security-audit
- **Assigned To**: builder-oauth
- **Agent Type**: backend-engineer
- **Parallel**: false
- Run CodeRabbit CLI against the PR (`coderabbit review --agent --base main --type committed`).
- Wait for cubic + independent reviewer outputs.
- Fix real findings, push back on incorrect ones with technical reasoning.

### 18. Final validation

- **Task ID**: validate-all
- **Depends On**: preflight-docs, worktree-bootstrap, db-migrations, oauth-endpoints, client-refactor, project-config-flip, adapter-anthropic, adapter-gemini, adapter-hubspot-enrichment, adapter-news, remove-mock-fallback, replay-nonce, rls-wiring, card-bundler, slice-3-walkthrough, docs-sweep, security-audit, code-review
- **Assigned To**: validator
- **Agent Type**: quality-engineer
- **Parallel**: false
- Run all validation commands.
- Verify acceptance criteria met.
- Operate in validation mode: inspect and report only, do not modify files.

## Acceptance Criteria

- `apps/hubspot-project/src/app/app-hsmeta.json` has `auth.type: "oauth"` and `distribution: "marketplace"` (or `"private"` for pilot). Re-uploads successfully via `scripts/hs-project-upload.ts`.
- Two independent HubSpot portals can install the app via the marketplace OAuth flow. Each upsert creates (or updates) exactly one `tenants` row (keyed by `hubspot_portal_id`) and exactly one `tenant_hubspot_oauth` row (keyed by `tenant_id`). Cross-tenant query under RLS returns zero rows (proven by `rls.test.ts`).
- The OAuth callback flow is explicit and ordered: code-exchange → token-identity fetch → `tenants` upsert → `tenant_hubspot_oauth` upsert → redirect (see Step 3). Portal identity is not duplicated — `tenants.hubspot_portal_id` is the single source of truth, and no `hub_id` column exists on `tenant_hubspot_oauth`.
- OAuth state validation detects tampering + expiry. Single-use replay of an unexpired state is an accepted gap (stateless design); documented in SECURITY.md §17 with the mitigation path if it becomes a requirement.
- `tenants` table is NOT under RLS (bootstrap table). Every other tenant-scoped table IS under RLS, and the auth middleware sets a tenant-bound DB handle on Hono context; a Biome lint rule forbids routes/services from importing the process-wide `db`.
- `HUBSPOT_DEV_PORTAL_TOKEN` grep across `apps/`, `packages/`, `scripts/`, `.env.example`, and `packages/config/src/env.ts` returns zero hits.
- `createMockLlmAdapter` and `createMockSignalAdapter` are not imported anywhere under `apps/api/src/routes/` or `apps/api/src/services/` (grep proof). They remain only under `__tests__/`.
- `snapshotSchema.parse(response)` succeeds against a live response from a tenant configured with Anthropic (or Gemini) + Exa + HubSpot-enrichment + News adapters — no mock data served.
- Replay-nonce: POSTing the same `(tenantId, timestamp, bodyHash)` twice returns 401 on the second call. Two different tenants with identical `(timestamp, bodyHash)` BOTH succeed — the dedup key is tenant-scoped (both claim and schema agree).
- RLS: a direct psql session with `SET app.tenant_id = '<tenant-B-uuid>'` cannot SELECT tenant-A rows from any tenant-scoped table.
- Card bundling: `apps/hubspot-project/src/app/cards/dist/index.js` exists after `pnpm tsx scripts/bundle-hubspot-card.ts`; `hs project upload` succeeds; the installed extension renders the real `SnapshotStateRenderer` (not the placeholder).
- All existing Slice 1 + Slice 2 tests still pass (baseline 463 + new Slice 3 tests).
- Security audit PASS on OAuth, RLS, and replay-nonce.

## Validation Commands

Execute these commands to validate the task is complete:

- `pnpm install --frozen-lockfile` — lockfile drift check.
- `pnpm lint` — Biome clean (no errors).
- `pnpm test` — full Vitest suite passes (baseline 463 + ~50 new Slice 3 tests).
- `pnpm db:migrate` — all 7 migrations apply idempotently against a fresh Postgres.
- `pnpm tsx scripts/bundle-hubspot-card.ts` — extension bundles without errors; output exists at `apps/hubspot-project/src/app/cards/dist/index.js`.
- `pnpm tsx scripts/hs-project-upload.ts` — project uploads to dev portal without errors (OAuth config accepted).
- `pnpm tsx scripts/seed-hubspot-test-portal.ts --portalId <second-portal-id>` — seeds the second test portal end-to-end using its OAuth token.
- `grep -r "HUBSPOT_DEV_PORTAL_TOKEN" apps packages scripts .env.example` — returns no matches (excluding docs describing the migration).
- `grep -r "createMockLlmAdapter\|createMockSignalAdapter" apps/api/src/routes apps/api/src/services` — returns no matches.
- `grep -rE "from ['\"]\\.\\./.*db['\"]|from ['\"]@hap/db['\"]" apps/api/src/routes apps/api/src/services | grep -v "c\\.get('db')"` — returns no matches (process-wide `db` not imported in route/service layers).
- `grep -i "hub_id" packages/db/drizzle/0005_tenant_hubspot_oauth.sql packages/db/src/schema/tenant-hubspot-oauth.ts` — returns no matches (portal identity lives only on `tenants.hubspot_portal_id`).
- psql manual: `SET app.tenant_id = '<tenant-B-uuid>'; SELECT count(*) FROM snapshots WHERE tenant_id = '<tenant-A-uuid>';` — returns 0.
- `pnpm --filter @hap/hubspot-extension build` — extension builds without errors.

## Notes

- **Feature-flag strategy**: if pilot-scale matters more than marketplace listing, set `HUBSPOT_DISTRIBUTION=private` to default the app to `distribution: "private"` (10-tenant allowlist). No code change required at merge — only the env var.
- **Slice 3 does NOT deliver**: real OpenRouter or OpenAI-compatible adapters (remain Slice 4 stubs — low-priority per PRD wedge, customers can use OpenAI or Anthropic today), marketplace listing submission (business workflow, not code), token-revocation webhook receiver (Slice 4 — we handle install, not uninstall cleanup beyond simple tenant soft-delete).
- **Rollback path**: if OAuth migration blocks the slice, Phase 2 (real adapters + mock-fallback removal) and Phase 3 (card bundling + replay-nonce + RLS) are independently shippable. Each phase is one logical PR if we need to split.
- **Cassette-based testing** is mandatory for every real adapter — the cassette pattern from Slice 2 (`__tests__/cassettes/*.json` + fetch injection, no `msw` dep) is the project standard.
- **Verified against** `docs/security/SECURITY.md` §16 (OAuth migration plan authored in Slice 2) and HubSpot docs fetched via Context7 (`/websites/developers_hubspot`, 2026-04-15): `auth.type: "oauth"` + `distribution: "marketplace"` is current and correct for multi-tenant install; `redirectUrls` + `requiredScopes`/`optionalScopes`/`conditionallyRequiredScopes` split matches developer platform 2025.2+ (project is on 2026.03).
- **TDD rule (CLAUDE.md)**: every task writes failing tests first, confirms the failure, then implements. Cassettes are recorded against real provider responses once per adapter, then the real network calls are never replayed in CI.
