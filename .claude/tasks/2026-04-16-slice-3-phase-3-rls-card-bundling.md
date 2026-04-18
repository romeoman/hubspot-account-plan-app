# Plan: Slice 3 Phase 3 — RLS, Replay-Nonce, Card Bundling, HubSpot Enrichment

## Task Description

Complete the remaining Slice 3 tasks that Phase 1+2 deferred. Phase 1 delivered OAuth install flow + DB migrations. Phase 2 delivered real Anthropic/Gemini/News adapters + mock-fallback removal. Phase 3 delivers the defense-in-depth layer and the card bundling bridge that makes the real extension render on HubSpot:

1. **Replay-nonce middleware wiring** — the `signed_request_nonce` table and schema exist (migration 0006), but the middleware in `hubspot-signature.ts` doesn't yet record or check nonces. Wire `recordNonce()` into the signature verification flow + add a TTL sweep script.
2. **RLS enforcement** — add Postgres RLS policies to all tenant-scoped tables (except `tenants`). Create `withTenantTx` / `withTenantTxHandle` helpers that run `SET LOCAL app.tenant_id` in a transaction. Refactor auth middleware to set a tenant-bound DB handle on Hono context. Add a Biome `noRestrictedImports`-equivalent rule to prevent route/service files from importing the process-wide `db`.
3. **Real HubSpot-enrichment adapter** — replace the Phase 3 deferral stub with a real adapter that calls `HubSpotClient.getCompanyProperties` + engagement/notes fetch. Needs the RLS tx handle from task 2.
4. **Card bundling bridge** — create a Vite UMD build entry (`hubspot-card-entry.tsx`), a bundle script, and rewrite `SignalCard.tsx` to re-export the bundled output so `hs project upload` ships the real extension.
5. **QA walkthrough, docs sweep, security audit, code review, final validation** — ship-readiness gates.

## Objective

After this plan completes, the HubSpot Signal-First Account Workspace is fully installable via OAuth, renders the real `SnapshotStateRenderer` in HubSpot's CRM record tab, has defense-in-depth via RLS + replay-nonce, and all four signal/LLM adapter paths are real (no stubs or mocks in production code).

## Problem Statement

Phase 1+2 shipped the OAuth flow and real adapters, but three critical gaps remain:

- **No replay protection**: within the 5-minute signature freshness window, the same HubSpot signed request can be replayed. The nonce table exists but isn't wired into middleware.
- **No RLS enforcement**: tenant isolation is app-layer only (`eq(table.tenantId, ctx.tenantId)`). A bug in any route handler could leak cross-tenant data. RLS adds belt-and-braces Postgres-level enforcement.
- **Placeholder card in HubSpot**: the `SignalCard.tsx` in `apps/hubspot-project/` is still the Slice 2 scaffold `EmptyState`. The real React extension (`apps/hubspot-extension/`) isn't bundled into the HubSpot project, so `hs project upload` ships a placeholder.
- **HubSpot-enrichment stub**: the adapter throws "not yet implemented". It needs the RLS tx handle + per-tenant OAuth client to call HubSpot CRM APIs.

## Solution Approach

### Replay-nonce wiring

Add `apps/api/src/lib/replay-nonce.ts` with `recordNonce(db, { tenantId, timestamp, bodyHash })` that does `INSERT ... ON CONFLICT DO NOTHING` and returns `{ duplicate: boolean }`. Wire it into `hubspot-signature.ts` AFTER signature verification and AFTER `tenantMiddleware` resolves `tenantId`. Reject duplicates with `401 { error: "replay_detected" }`. Add `scripts/sweep-nonces.ts` for TTL cleanup (rows older than 10 minutes).

**Key constraint**: the nonce check must happen AFTER both signature verification AND tenant resolution, because `tenantId` is part of the composite key. This means the nonce check lives in a NEW middleware that runs after `authMiddleware` + `tenantMiddleware`, not inside `hubspot-signature.ts` itself.

### RLS enforcement

1. **Migration 0007**: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` for `snapshots`, `evidence`, `people`, `provider_config`, `llm_config`, `tenant_hubspot_oauth`, `signed_request_nonce`. Each policy: `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)` for SELECT/UPDATE/DELETE, same for INSERT `WITH CHECK`. `tenants` is deliberately excluded.
2. **`apps/api/src/lib/tenant-tx.ts`**: two helpers:
   - `withTenantTx(db, tenantId, fn)` — wraps `fn` in a transaction that first runs `SET LOCAL app.tenant_id = tenantId`. For scripts/background jobs.
   - `withTenantTxHandle(db, tenantId)` — returns a Drizzle-compatible handle where every query runs inside a `SET LOCAL` transaction. For request-scoped middleware injection.
3. **RLS DB-handle injection** — canonicalized to ONE location: a new middleware in `apps/api/src/index.ts` mounted immediately AFTER `tenantMiddleware`. This middleware reads `c.get('tenantId')`, calls `withTenantTxHandle(getDb(), tenantId)`, and sets `c.set('db', rlsHandle)`. Neither `auth.ts` nor `tenant.ts` are modified for this concern — `auth.ts` stays as a signature/portal-id extractor, `tenant.ts` stays as a tenant resolver. The RLS handle is a separate middleware responsibility.
4. **Mechanical sweep**: replace direct `db` imports in `apps/api/src/routes/` and `apps/api/src/services/` with `c.get('db')`.
5. **Biome lint rule**: Biome 2.4 supports `noRestrictedImports` under `nursery`. The rule targets only runtime DB-client construction (`createDatabase` function), NOT schema/table imports or type-only imports from `@hap/db`. Route and service files legitimately import schema tables, types, and `eq`/`sql` helpers — those are safe. The banned import is the `createDatabase` factory and any module-level `db` singleton.

### ProviderAdapter contract fix (prerequisite for HubSpot-enrichment)

The current `ProviderAdapter.fetchSignals(tenantId, companyName, domain?)` interface is ambiguous — `snapshot-assembler.ts:121` passes `companyId` as the second arg (not a company name). The HubSpot-enrichment adapter needs `companyId` for CRM API lookups, while Exa/News use it as a search query term. Fix the contract BEFORE implementing the enrichment adapter:

1. Change `ProviderAdapter.fetchSignals` signature to accept a structured arg:
   `fetchSignals(tenantId: string, context: { companyId: string; companyName?: string; domain?: string }): Promise<Evidence[]>`
2. Update `snapshot-assembler.ts` to pass `{ companyId, companyName, domain }` (companyName + domain resolved from CRM properties or the route params).
3. Update all existing adapter implementations: `ExaAdapter`, `NewsAdapter`, `HubSpotEnrichmentAdapter`, mock adapters in `__tests__/`, and the `wrapSignalWithGuards` wrapper.
4. Exa/News adapters use `context.companyName ?? context.companyId` as the query term (backward-compatible behavior).
5. HubSpot-enrichment adapter uses `context.companyId` for CRM lookups.
6. Update all affected tests.

### HubSpot-enrichment adapter

Replace the stub in `apps/api/src/adapters/signal/hubspot-enrichment.ts`. The adapter:

- Accepts a `HubSpotClient` instance (injected by the factory).
- Uses `context.companyId` (from the updated contract) to call `client.getCompanyProperties(companyId, ["name", "domain", "description", "notes_last_updated"])`.
- Calls a new `client.getCompanyEngagements(companyId)` method (CRM v3 associations → engagement search).
- Emits `Evidence[]` rows with `source: "hubspot-enrichment"`.
- Update the signal factory to construct a `HubSpotClient` when no `deps.hubspotClient` is injected:
  - Extend `SignalFactoryDeps` with optional `db: Database` and `tenantId: string` fields.
  - In the `hubspot-enrichment` branch: if no `deps.hubspotClient`, construct `new HubSpotClient({ tenantId: deps.tenantId!, db: deps.db!, fetch: deps.fetch })`.
  - Update `resolveSignalAdapter` in `routes/snapshot.ts` to pass `{ db: c.get('db'), tenantId }` into the factory deps.
  - Add tests for both the injected-client and default-construction paths.

### Card bundling bridge

1. **New entry file**: `apps/hubspot-extension/src/hubspot-card-entry.tsx` — extracts the render tree into a shared `ExtensionRoot` component, re-exports as default. Also calls `hubspot.extend()` for local-dev parity.
2. **Vite config**: `apps/hubspot-extension/vite.config.ts` — `build.lib.entry = "src/hubspot-card-entry.tsx"`, `formats: ["umd"]`, externalize `react`, `react-dom`, `@hubspot/ui-extensions`.
3. **Bundle script**: `scripts/bundle-hubspot-card.ts` — runs the Vite build, copies output to `apps/hubspot-project/src/app/cards/dist/`.
4. **Rewrite SignalCard.tsx**: `export { default } from "./dist/index.js"` — the HubSpot bundler picks up the real extension.
5. **Update card-hsmeta.json**: point entrypoint at the new card file if needed.
6. **Update `scripts/hs-project-upload.ts`**: invoke bundle script before upload.

## Relevant Files

### Existing Files to Modify

- `apps/api/src/middleware/hubspot-signature.ts` — remove the replay-nonce TODO, but the actual nonce check goes in a new middleware (see below)
- `apps/api/src/middleware/auth.ts` — re-export the signature middleware (unchanged)
- `apps/api/src/middleware/tenant.ts` — types only (add `db` to `TenantVariables`); tenant resolution logic unchanged
- `apps/api/src/index.ts` — mount the nonce middleware, mount the RLS DB-handle middleware (new, after tenantMiddleware)
- `apps/api/src/adapters/provider-adapter.ts` — change `fetchSignals` signature to structured context arg
- `apps/api/src/services/snapshot-assembler.ts` — update `fetchSignals` call to pass structured context
- `apps/api/src/routes/snapshot.ts` — remove local `getDb()`, use `c.get('db')` from context
- `apps/api/src/adapters/signal/hubspot-enrichment.ts` — replace stub with real implementation
- `apps/api/src/adapters/signal/factory.ts` — update hubspot-enrichment branch to construct HubSpotClient from tenant context
- `apps/api/src/lib/hubspot-client.ts` — add `getCompanyEngagements()` method
- `apps/hubspot-extension/src/index.tsx` — extract render tree into shared `ExtensionRoot`
- `apps/hubspot-extension/package.json` — add vite as devDependency
- `apps/hubspot-project/src/app/cards/SignalCard.tsx` — rewrite to re-export bundled extension
- `apps/hubspot-project/src/app/cards/card-hsmeta.json` — potentially update entrypoint
- `packages/db/src/index.ts` — may need to export `sql` for RLS `SET LOCAL`
- `biome.json` — add `noRestrictedImports` nursery rule
- `scripts/hs-project-upload.ts` — invoke bundle script first
- `docs/security/SECURITY.md` — add §17 (RLS) and §18 (replay-nonce)

### New Files

- `apps/api/src/lib/replay-nonce.ts` — `recordNonce()` function
- `apps/api/src/lib/__tests__/replay-nonce.test.ts` — unit tests
- `apps/api/src/middleware/nonce.ts` — nonce-check middleware (runs after auth + tenant)
- `apps/api/src/middleware/__tests__/nonce.test.ts` — middleware integration tests
- `apps/api/src/lib/tenant-tx.ts` — `withTenantTx` + `withTenantTxHandle`
- `apps/api/src/lib/__tests__/tenant-tx.test.ts` — unit + integration tests
- `packages/db/drizzle/0007_rls_policies.sql` — RLS migration
- `apps/api/src/lib/__tests__/rls.test.ts` — cross-tenant isolation regression tests
- `apps/api/src/adapters/signal/__tests__/hubspot-enrichment.test.ts` — real adapter tests
- `apps/api/src/adapters/signal/__tests__/cassettes/hubspot-enrichment-company.json` — cassette
- `apps/api/src/adapters/signal/__tests__/cassettes/hubspot-enrichment-engagements.json` — cassette
- `apps/hubspot-extension/src/hubspot-card-entry.tsx` — UMD bundle entry
- `apps/hubspot-extension/src/components/extension-root.tsx` — shared render tree
- `apps/hubspot-extension/vite.config.ts` — Vite build config
- `scripts/bundle-hubspot-card.ts` — bundle + copy script
- `scripts/sweep-nonces.ts` — TTL nonce cleanup
- `apps/hubspot-project/__validate__/bundle.test.ts` — bundle existence + re-export test
- `docs/qa/slice-3-walkthrough.md` — QA walkthrough document

## Implementation Phases

### Phase 1: Foundation (Tasks 1-3)

RLS migration + tenant-tx helpers + replay-nonce library. These are foundational — everything else depends on the RLS handle existing and the nonce function being available.

### Phase 2: Core Implementation (Tasks 4-8)

Wire RLS into middleware (Task 4), wire nonce into middleware (Task 5), fix ProviderAdapter contract (Task 6), implement HubSpot-enrichment adapter (Task 7), build card bundling bridge (Task 8). Partial parallelism: nonce wiring and card bundling are independent; HubSpot-enrichment depends on both RLS wiring and the contract fix.

### Phase 3: Integration & Polish (Tasks 9-13)

Biome lint rule, docs sweep, security audit, code review, final validation. Strictly sequential — each gate depends on all implementation being complete.

## Team Orchestration

- You operate as the team lead and orchestrate the team to execute the plan.
- You're responsible for deploying the right team members with the right context to execute the plan.
- IMPORTANT: You NEVER operate directly on the codebase. You dispatch specialist agents to handle building, validating, testing, and other tasks.
  - This is critical. Your job is to act as a high-level director of the team, not a builder.
  - Your role is to validate all work is going well and make sure the team is on track to complete the plan.
  - Use agent-dispatch primitives (the Agent tool) to deploy team members. Create and update an in-conversation task list to track progress across agents.
  - Communication is paramount. Monitor agent results, verify outputs, and coordinate handoffs between agents.
- Take note of the session id of each team member. This is how you'll reference them.

### Team Members

- Specialist
  - Name: builder-db
  - Role: RLS migration, tenant-tx helpers, RLS wiring into middleware, cross-tenant regression tests
  - Agent Type: backend-engineer
  - Resume: true

- Specialist
  - Name: builder-backend
  - Role: Replay-nonce library + middleware, HubSpot-enrichment adapter, nonce sweep script, mechanical db-import sweep
  - Agent Type: backend-engineer
  - Resume: true

- Specialist
  - Name: builder-frontend
  - Role: Card bundling bridge (Vite config, entry file, bundle script, SignalCard rewrite)
  - Agent Type: frontend-specialist
  - Resume: true

- Specialist
  - Name: security-reviewer
  - Role: Security audit of OAuth, RLS, and replay-nonce implementation
  - Agent Type: security-auditor
  - Resume: false

- Quality Engineer (Validator)
  - Name: validator
  - Role: Validate completed work against acceptance criteria (read-only inspection mode)
  - Agent Type: quality-engineer
  - Resume: false

## Step by Step Tasks

- IMPORTANT: Execute every step in order, top to bottom. Track each task in the in-conversation task list; mark each complete as soon as it's done.
- Before you start, create the task list so all agents can reference the plan's progress.
- IMPORTANT: All work happens in the worktree at `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/.worktrees/slice-3-phase-3` on branch `feature/slice-3-phase-3-rls-card-bundling`.

### 1. RLS Migration (0007)

- **Task ID**: rls-migration
- **Depends On**: none
- **Assigned To**: builder-db
- **Agent Type**: backend-engineer
- **Parallel**: false
- Create `packages/db/drizzle/0007_rls_policies.sql`:
  - `ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;`
  - `ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;`
  - `ALTER TABLE people ENABLE ROW LEVEL SECURITY;`
  - `ALTER TABLE provider_config ENABLE ROW LEVEL SECURITY;`
  - `ALTER TABLE llm_config ENABLE ROW LEVEL SECURITY;`
  - `ALTER TABLE tenant_hubspot_oauth ENABLE ROW LEVEL SECURITY;`
  - `ALTER TABLE signed_request_nonce ENABLE ROW LEVEL SECURITY;`
  - For EACH table above, create two policies:
    - `CREATE POLICY {table}_tenant_select ON {table} FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);`
    - `CREATE POLICY {table}_tenant_insert ON {table} FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);`
  - `tenants` is deliberately NOT under RLS (bootstrap lookup table).
  - ALSO add `ALTER ROLE` to ensure the app database role has RLS enforced (not superuser bypass): `ALTER TABLE {table} FORCE ROW LEVEL SECURITY;` so even the table owner is subject to policies.
- TDD: write a migration test in `packages/db/src/schema/__tests__/slice3-phase3-migrations.test.ts` that applies the migration and verifies RLS is enabled on all 7 tables via `pg_catalog.pg_tables` query.
- Run `pnpm test` to confirm all 531+ tests still pass.

### 2. Tenant Transaction Helpers

- **Task ID**: tenant-tx
- **Depends On**: rls-migration
- **Assigned To**: builder-db
- **Agent Type**: backend-engineer
- **Parallel**: false
- Create `apps/api/src/lib/tenant-tx.ts` with two exports:
  - `withTenantTx(db, tenantId, fn)` — wraps `fn(tx)` in a Drizzle transaction that first runs `await tx.execute(sql.raw(\`SET LOCAL app.tenant_id = '${tenantId}'\`))`. For scripts and background jobs.
  - `withTenantTxHandle(db, tenantId)` — returns a proxy/wrapper that provides the same Drizzle query surface (`select`, `insert`, `update`, `delete`, `query`) but every call goes through a `SET LOCAL` transaction. For request-scoped middleware injection.
- TDD: write tests in `apps/api/src/lib/__tests__/tenant-tx.test.ts`:
  - `withTenantTx` sets the session variable (verify via `current_setting('app.tenant_id')` inside the tx callback).
  - `withTenantTxHandle` returns correct results scoped to the tenant.
  - Cross-tenant isolation: seed rows for tenant A and B, use handle for tenant B, SELECT all from tenant-scoped table — must see only B's rows.
- Run full test suite.

### 3. Replay-Nonce Library

- **Task ID**: replay-nonce-lib
- **Depends On**: none
- **Assigned To**: builder-backend
- **Agent Type**: backend-engineer
- **Parallel**: true (parallel with task 1+2)
- Create `apps/api/src/lib/replay-nonce.ts`:
  - `recordNonce(db, { tenantId, timestamp, bodyHash }): Promise<{ duplicate: boolean }>` — `INSERT INTO signed_request_nonce (tenant_id, timestamp, body_hash) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, timestamp, body_hash) DO NOTHING` — check `rowCount === 0` for duplicate.
  - `computeBodyHash(body: string): Buffer` — `createHash('sha256').update(body).digest()`.
- TDD: write tests in `apps/api/src/lib/__tests__/replay-nonce.test.ts`:
  - First insert returns `{ duplicate: false }`.
  - Same `(tenantId, timestamp, bodyHash)` returns `{ duplicate: true }`.
  - Different tenant with same `(timestamp, bodyHash)` returns `{ duplicate: false }` (proves tenant-scoped PK).
  - Different bodyHash for same tenant returns `{ duplicate: false }`.
- Create `scripts/sweep-nonces.ts`: deletes rows where `created_at < now() - interval '10 minutes'`, logs count deleted.
- Run full test suite.

### 4. RLS Middleware Wiring

- **Task ID**: rls-wiring
- **Depends On**: tenant-tx, rls-migration
- **Assigned To**: builder-db
- **Agent Type**: backend-engineer
- **Parallel**: false
- **Canonical injection point**: add a NEW middleware function in `apps/api/src/index.ts`, mounted immediately AFTER `tenantMiddleware` on the `/api/*` path. This middleware:
  1. Reads `tenantId` from `c.get('tenantId')` (set by tenantMiddleware upstream).
  2. Calls `withTenantTxHandle(getDb(), tenantId)` to create an RLS-bound DB handle.
  3. Sets `c.set('db', rlsHandle)` on the Hono context.
  - `auth.ts` is NOT modified for this concern (stays as signature verifier).
  - `tenant.ts` is NOT modified for this concern (stays as tenant resolver). Only its exported `TenantVariables` type gains the `db` field.
- Mechanical sweep in `apps/api/src/routes/snapshot.ts`:
  - Remove the local `getDb()` function and `cachedDb` variable.
  - Change the route handler to read `const db = c.get('db')` from Hono context.
  - Update all DB calls to use the context-provided handle.
- Add RLS regression test in `apps/api/src/lib/__tests__/rls.test.ts`:
  - Seed tenant A + tenant B rows in `snapshots`, `evidence`, `people`, `provider_config`, `llm_config`, `tenant_hubspot_oauth`.
  - Open a session with `withTenantTxHandle(db, tenantB.id)`.
  - SELECT from each table — must return ONLY tenant B rows.
  - Attempt to INSERT a row with `tenant_id = tenantA.id` via tenant B's handle — must fail (RLS WITH CHECK violation).
- Run full test suite — all existing tests must still pass.

### 5. Replay-Nonce Middleware Wiring

- **Task ID**: nonce-wiring
- **Depends On**: replay-nonce-lib, rls-wiring
- **Assigned To**: builder-backend
- **Agent Type**: backend-engineer
- **Parallel**: false
- Create `apps/api/src/middleware/nonce.ts`:
  - Reads the raw body text (already available on `c.req` after signature middleware consumed it — may need to re-read or stash it).
  - Computes `bodyHash = computeBodyHash(body)`.
  - Reads `timestamp` from `X-HubSpot-Request-Timestamp` header (already validated by signature middleware).
  - Reads `tenantId` from `c.get('tenantId')` (set by tenant middleware).
  - Calls `recordNonce(db, { tenantId, timestamp, bodyHash })`.
  - If `duplicate`, returns `401 { error: "replay_detected" }`.
  - Otherwise calls `next()`.
- Mount in `apps/api/src/index.ts` AFTER `authMiddleware` + `tenantMiddleware`, BEFORE route handlers.
- IMPORTANT: the signature middleware reads the body via `c.req.text()` which consumes the stream. The nonce middleware needs the same body. Solution: stash the raw body text on the Hono context in the signature middleware (`c.set('rawBody', body)`) and read it from context in the nonce middleware.
- TDD: write tests in `apps/api/src/middleware/__tests__/nonce.test.ts`:
  - First request passes through (nonce recorded).
  - Replay of same request returns 401 `replay_detected`.
  - Different body with same timestamp passes (different hash).
  - Different tenant with same body+timestamp passes (tenant-scoped).
- Update the `@todo Slice 3` comment in `hubspot-signature.ts` to reference the nonce middleware.
- Run full test suite.

### 6. ProviderAdapter Contract Fix

- **Task ID**: provider-contract-fix
- **Depends On**: rls-wiring
- **Assigned To**: builder-backend
- **Agent Type**: backend-engineer
- **Parallel**: false
- Change `ProviderAdapter.fetchSignals` in `apps/api/src/adapters/provider-adapter.ts`:
  - Old: `fetchSignals(tenantId: string, companyName: string, domain?: string): Promise<Evidence[]>`
  - New: `fetchSignals(tenantId: string, context: SignalContext): Promise<Evidence[]>` where `SignalContext = { companyId: string; companyName?: string; domain?: string }`
- Update `apps/api/src/services/snapshot-assembler.ts` line 121: change `fetchSignals(tenantId, companyId)` to `fetchSignals(tenantId, { companyId, companyName, domain })` (companyName/domain resolved from route params or CRM properties — can be undefined initially).
- Update `ExaAdapter.fetchSignals`: use `context.companyName ?? context.companyId` as the query term (backward-compatible).
- Update `NewsAdapter.fetchSignals`: same — `context.companyName ?? context.companyId`.
- Update `HubSpotEnrichmentAdapter.fetchSignals`: use `context.companyId` for CRM API calls.
- Update `wrapSignalWithGuards` in `apps/api/src/adapters/signal/factory.ts`: pass through the structured context.
- Update all mock adapters in `__tests__/` and all test call sites.
- TDD: update existing adapter tests to use the new signature. All must pass.
- Run full test suite.

### 7. HubSpot Enrichment Adapter

- **Task ID**: hubspot-enrichment
- **Depends On**: provider-contract-fix, rls-wiring
- **Assigned To**: builder-backend
- **Agent Type**: backend-engineer
- **Parallel**: true (parallel with task 5 after dependencies met)
- Add `getCompanyEngagements(companyId: string): Promise<Array<{ type: string; timestamp: string; subject?: string }>>` method to `apps/api/src/lib/hubspot-client.ts`:
  - `GET /crm/v3/objects/companies/{companyId}/associations/engagements` to get engagement IDs.
  - Then batch-fetch engagement properties.
  - Return the 10 most recent.
- Replace the stub in `apps/api/src/adapters/signal/hubspot-enrichment.ts`:
  - `fetchSignals(tenantId, context)`:
    - Use `context.companyId` to call `this.client.getCompanyProperties(context.companyId, ["name", "domain", "description", "notes_last_updated"])`.
    - Use `this.client.getCompanyEngagements(context.companyId)` for recent engagement data.
    - Map results to `Evidence[]` with `source: "hubspot-enrichment"`, appropriate `confidence` and `timestamp`.
    - Handle missing data gracefully — return empty array if no enrichment data found.
- Update signal factory (`apps/api/src/adapters/signal/factory.ts`):
  - Extend `SignalFactoryDeps` with optional `db: Database` and `tenantId: string` fields.
  - In the `hubspot-enrichment` branch, when no `deps.hubspotClient` is injected, construct `new HubSpotClient({ tenantId: deps.tenantId!, db: deps.db!, fetch: deps.fetch })`.
  - Update `resolveSignalAdapter` in `routes/snapshot.ts` to pass `{ db: c.get('db'), tenantId }` into the factory deps.
  - Add tests for both the injected-client path and the default-construction path.
- Record cassettes:
  - `apps/api/src/adapters/signal/__tests__/cassettes/hubspot-enrichment-company.json`
  - `apps/api/src/adapters/signal/__tests__/cassettes/hubspot-enrichment-engagements.json`
- TDD: write tests in `apps/api/src/adapters/signal/__tests__/hubspot-enrichment.test.ts`:
  - Returns evidence from company properties.
  - Returns evidence from engagements.
  - Returns empty array on 404 company.
  - Handles partial data (company exists but no engagements).
- Add `"hubspot-enrichment"` to `REAL_SIGNAL_PROVIDERS` in `apps/api/src/routes/snapshot.ts`.
- Run full test suite.

### 8. Card Bundling Bridge

- **Task ID**: card-bundler
- **Depends On**: none
- **Assigned To**: builder-frontend
- **Agent Type**: frontend-specialist
- **Parallel**: true (fully independent of backend tasks)
- Extract the render tree from `apps/hubspot-extension/src/index.tsx` into a shared component:
  - Create `apps/hubspot-extension/src/components/extension-root.tsx` that exports `ExtensionRoot` — accepts the same props as `Extension` and renders `SnapshotStateRenderer` with the loading/error/empty logic.
  - Update `apps/hubspot-extension/src/index.tsx` to import and use `ExtensionRoot`.
- Create `apps/hubspot-extension/src/hubspot-card-entry.tsx`:
  - `export default` a React component that renders `ExtensionRoot`.
  - Also calls `hubspot.extend<'crm.record.tab'>()` for local-dev parity.
- Add `vite` as a devDependency to `apps/hubspot-extension/package.json`.
- Create `apps/hubspot-extension/vite.config.ts`:
  - `build.lib.entry: "src/hubspot-card-entry.tsx"`.
  - `build.lib.formats: ["iife"]` (single self-executing bundle — simpler than UMD for HubSpot's card runtime which evaluates the file directly).
  - `build.lib.name: "HapSignalCard"`.
  - `build.outDir: "dist"`.
  - `build.rollupOptions.output.entryFileNames: "index.js"` — lock the output filename to exactly `dist/index.js`. Do NOT rely on Vite's default naming convention (`index.umd.cjs`, `index.iife.js`, etc.) which varies by format and Vite version.
  - Externalize: `react`, `react-dom`, `@hubspot/ui-extensions`, `@hubspot/ui-extensions/crm`.
- Create `scripts/bundle-hubspot-card.ts`:
  - Run `pnpm --filter @hap/hubspot-extension build` (Vite build).
  - Verify `apps/hubspot-extension/dist/index.js` exists (fail loudly if not — catches Vite config drift).
  - Copy `apps/hubspot-extension/dist/index.js` to `apps/hubspot-project/src/app/cards/dist/index.js`.
  - Copy `apps/hubspot-extension/dist/style.css` to `apps/hubspot-project/src/app/cards/dist/index.css` if it exists.
- Rewrite `apps/hubspot-project/src/app/cards/SignalCard.tsx`:
  - Replace the scaffold placeholder with: `export { default } from "./dist/index.js";`
- Update `scripts/hs-project-upload.ts` to run `bundle-hubspot-card.ts` first.
- Add `.gitignore` entry for `apps/hubspot-project/src/app/cards/dist/` (build artifact).
- TDD: write `apps/hubspot-project/__validate__/bundle.test.ts`:
  - After running the bundle script, verify `apps/hubspot-project/src/app/cards/dist/index.js` exists.
  - Verify `SignalCard.tsx` re-exports from the dist.
- Verify all existing extension tests still pass.
- Run full test suite.

### 9. Biome Lint Rule for DB Client Imports

- **Task ID**: lint-db-imports
- **Depends On**: rls-wiring
- **Assigned To**: builder-db
- **Agent Type**: backend-engineer
- **Parallel**: true (after rls-wiring, parallel with other tasks)
- **Scope**: the rule targets ONLY runtime DB-client construction, NOT all `@hap/db` imports. Route/service files legitimately import schema tables (`tenants`, `snapshots`, etc.), types (`Database`, `Tenant`), and query helpers (`eq`, `sql`) from `@hap/db` — those are safe and must not be blocked.
- **What to ban**: the `createDatabase` function import from `@hap/db` and any local module that exports a process-wide `db` singleton. These are the imports that bypass RLS.
- **What to allow**: type-only imports, schema/table imports, `eq`/`sql`/`and` helpers, and the `Database` type (used as a parameter type for dependency injection).
- Add a Biome `noRestrictedImports` rule (nursery) targeting `createDatabase`. If Biome doesn't support path-scoped restrictions, add a nested `biome.json` override in `apps/api/src/routes/` and `apps/api/src/services/`.
- Verify with `pnpm lint` — should pass (all routes already use `c.get('db')` after task 4).
- Run a targeted grep to confirm no runtime DB-client construction in routes/services:
  `grep -rE "createDatabase|getDb\(\)" apps/api/src/routes apps/api/src/services` — returns no matches.
  (This replaces the overly broad `from.*@hap/db` grep that would false-positive on schema/type imports.)

### 10. Documentation Sweep

- **Task ID**: docs-sweep
- **Depends On**: hubspot-enrichment, nonce-wiring, card-bundler, lint-db-imports, provider-contract-fix
- **Assigned To**: builder-backend
- **Agent Type**: backend-engineer
- **Parallel**: false
- Update `docs/security/SECURITY.md`:
  - Mark §16 (OAuth migration) as complete.
  - Add §17: RLS architecture — policies, `withTenantTx`, `withTenantTxHandle`, threat model coverage, `tenants` exclusion rationale.
  - Add §18: Replay-nonce architecture — nonce middleware, composite PK design, TTL sweep, cross-tenant independence.
- Update `CLAUDE.md` "Verified stack versions" if any new deps landed (e.g., `vite`).
- Update `README.md` install instructions if present — point at OAuth install URL.
- Remove or update stale `@todo Slice 3` comments across the codebase.

### 11. Security Audit

- **Task ID**: security-audit
- **Depends On**: docs-sweep
- **Assigned To**: security-reviewer
- **Agent Type**: security-auditor
- **Parallel**: false
- OAuth flow audit: CSRF state HMAC, redirect-URL validation, token-refresh race, 401-loop prevention, log redaction.
- RLS audit: every tenant-scoped table has RLS enabled + FORCE; every policy uses `current_setting('app.tenant_id', true)::uuid`; no `SECURITY DEFINER` functions bypass RLS.
- Replay-nonce audit: TTL sweep runs, `ON CONFLICT DO NOTHING` is atomic, bodyHash is SHA-256, tenant-scoped PK prevents cross-tenant nonce collisions.
- Card bundling audit: no secrets in the UMD bundle, externalized deps match runtime expectations.
- Report PASS / FAIL per area with evidence.

### 12. Code Review

- **Task ID**: code-review
- **Depends On**: security-audit
- **Assigned To**: builder-backend
- **Agent Type**: backend-engineer
- **Parallel**: false
- Push the branch to origin.
- Run CodeRabbit CLI: `coderabbit review --agent --base main --type committed`.
- Also run an independent code-reviewer subagent against the diff.
- Fix real findings, push back on incorrect ones with technical reasoning.
- Push fixes and re-verify.

### 13. Final Validation

- **Task ID**: validate-all
- **Depends On**: rls-migration, tenant-tx, replay-nonce-lib, rls-wiring, nonce-wiring, provider-contract-fix, hubspot-enrichment, card-bundler, lint-db-imports, docs-sweep, security-audit, code-review
- **Assigned To**: validator
- **Agent Type**: quality-engineer
- **Parallel**: false
- Run all validation commands.
- Verify acceptance criteria met.
- Operate in validation mode: inspect and report only, do not modify files.

## Acceptance Criteria

- RLS is enabled on all 7 tenant-scoped tables (`snapshots`, `evidence`, `people`, `provider_config`, `llm_config`, `tenant_hubspot_oauth`, `signed_request_nonce`). `tenants` is NOT under RLS.
- `FORCE ROW LEVEL SECURITY` is set on all 7 tables (owner bypass disabled).
- Cross-tenant SELECT under RLS returns zero rows (proven by `rls.test.ts`).
- Cross-tenant INSERT under RLS fails with policy violation (proven by `rls.test.ts`).
- `withTenantTx(db, tenantId, fn)` correctly sets `app.tenant_id` session variable inside the transaction.
- `withTenantTxHandle(db, tenantId)` returns a handle that scopes all queries to the tenant.
- No route or service file under `apps/api/src/routes/` or `apps/api/src/services/` calls `createDatabase` or constructs a process-wide DB client. Schema/table imports, type imports, and `eq`/`sql` helpers from `@hap/db` are allowed.
- `ProviderAdapter.fetchSignals` accepts a structured `SignalContext` arg (`{ companyId, companyName?, domain? }`), not positional `(companyName, domain?)`. All adapters, tests, and the assembler use the new signature.
- Replay-nonce: POSTing the same `(tenantId, timestamp, bodyHash)` twice returns 401 `replay_detected` on the second call.
- Replay-nonce: two different tenants with identical `(timestamp, bodyHash)` BOTH succeed.
- `scripts/sweep-nonces.ts` deletes rows older than 10 minutes.
- HubSpot-enrichment adapter returns `Evidence[]` from real CRM data (cassette-tested).
- `hubspot-enrichment` is listed in `REAL_SIGNAL_PROVIDERS`.
- Card bundling: `apps/hubspot-project/src/app/cards/dist/index.js` exists after `pnpm tsx scripts/bundle-hubspot-card.ts`.
- `SignalCard.tsx` re-exports from the bundled dist.
- All existing Slice 1 + 2 + Phase 1-2 tests still pass (baseline 531).
- `pnpm lint` passes with the new Biome restriction rule.
- Security audit PASS on RLS, replay-nonce, and card bundling.
- SECURITY.md updated with §17 (RLS) and §18 (replay-nonce).

## Validation Commands

Execute these commands to validate the task is complete:

- `pnpm install --frozen-lockfile` — lockfile drift check
- `pnpm lint` — Biome clean (no errors)
- `pnpm test` — full Vitest suite passes (baseline 531 + ~40 new Phase 3 tests)
- `pnpm typecheck` — TypeScript compilation passes
- `pnpm db:migrate` — all migrations (0001-0007) apply idempotently
- `pnpm tsx scripts/bundle-hubspot-card.ts` — extension bundles; output at `apps/hubspot-project/src/app/cards/dist/index.js`
- `grep -rE "createDatabase|getDb\(\)" apps/api/src/routes apps/api/src/services` — returns no matches (targets runtime DB-client construction only; schema/type imports from `@hap/db` are allowed)
- `grep -r "createMockLlmAdapter\|createMockSignalAdapter" apps/api/src/routes apps/api/src/services` — returns no matches
- `grep -i "HUBSPOT_DEV_PORTAL_TOKEN" apps packages scripts .env.example` — returns no matches (excluding docs)

## Notes

- **Worktree**: all work happens in `.worktrees/slice-3-phase-3` on branch `feature/slice-3-phase-3-rls-card-bundling`. The worktree is already created and baseline tests pass (531/531).
- **TDD is mandatory**: every task writes failing tests first, confirms failure, then implements. No exceptions.
- **Cassette-based testing**: mandatory for the HubSpot-enrichment adapter. Use the same `__tests__/cassettes/*.json` + fetch injection pattern from Phase 1-2.
- **RLS `current_setting` with `true` second arg**: the `true` parameter to `current_setting('app.tenant_id', true)` means "return NULL if the setting doesn't exist" instead of throwing. This is critical — without it, any query outside a `SET LOCAL` context (e.g., a migration, a health check) would crash.
- **Card bundling approach**: the HubSpot project bundler (`hs project upload`) processes the `SignalCard.tsx` entrypoint. By making it re-export from a pre-built UMD, we bypass the HubSpot bundler's inability to resolve our pnpm workspace deps. The UMD bundle includes all workspace package code; only React and `@hubspot/ui-extensions` are externalized (provided by HubSpot's card runtime).
- **Biome `noRestrictedImports`**: as of Biome 2.4, this rule is in `nursery`. It targets ONLY the `createDatabase` function import — NOT all `@hap/db` imports. Schema tables, types, and query helpers (`eq`, `sql`) are safe and must not be blocked. If Biome doesn't support path-scoped overrides, use a nested `biome.json` in `apps/api/src/routes/` and `apps/api/src/services/`.
- **Phase 3 does NOT deliver**: settings/model-picker UI (Slice 4), marketplace listing submission (business workflow), token-revocation webhook (Slice 4), OpenRouter/custom-endpoint adapters (Slice 4 stubs).
