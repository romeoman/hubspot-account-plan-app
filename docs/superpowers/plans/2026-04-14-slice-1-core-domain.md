# Plan: Slice 1 — Core Domain Implementation (Tasks 2-11)

## Task Description

Implement Slice 1 of the HubSpot Signal-First Account Workspace: database schema, domain types, API endpoints, HubSpot extension frontend, eligibility gating, trust/suppression logic, UI state rendering, and tenant isolation. All work uses fixture/mock data. Provider adapters are interface-only with single mock implementations — real LLM/Exa integrations are Slice 2.

**Type:** feature
**Complexity:** complex
**Branch:** `feature/slice-1-core-domain` (worktree at `.worktrees/slice-1/`)
**Execution model:** sequential (single worktree, no parallel agent writes)

## Objective

When complete, the HubSpot `crm.record.tab` extension will:

1. Resolve company context from the HubSpot record
2. Check target-account eligibility (configurable gating)
3. Display one dominant reason-to-contact-now with 0-3 people + reason-to-talk
4. Show evidence with source/timestamp/confidence inspection
5. Explicitly render all 8 QA states (eligible-strong, fewer-contacts, empty, stale, degraded, low-confidence, ineligible, restricted)
6. Enforce tenant isolation and permission-aware suppression
7. All backed by fixture data — no live API calls required

## Problem Statement

The bootstrap (Task 1) created the monorepo skeleton with a health endpoint and extension stub. There is no domain model, snapshot contract, state rendering, or tenant isolation. Tasks 2-11 build the entire product surface using fixture data to stabilize state semantics before Slice 2 wires in real providers.

## Solution Approach

Three implementation phases mapped to dependency layers, executed sequentially:

- **Phase 0 (Preflight):** Verify tooling works before committing to the full plan (HubSpot testing, Docker Postgres, migrations)
- **Phase 1 (Foundation):** DB schema, domain types, security stubs — the shared dependencies
- **Phase 2 (Core Logic):** API endpoints, eligibility, trust/suppression, reason generation, people selection — the business domain
- **Phase 3 (UI + Integration):** Frontend state rendering, evidence inspection, end-to-end verification

TDD is mandatory per CLAUDE.md. Agents implement sequentially in the worktree. Auto-commit after each task. PR to main when all tasks pass.

**V1 scope discipline (per PRD):**

- Provider adapters: interface + single mock implementation. Real Anthropic/OpenAI/Gemini/OpenRouter/Exa calls → Slice 2.
- Encryption: stub functions that establish the pattern. Real AES-256-GCM → Slice 2 (when real keys exist).
- HubSpot auth: fixture/bypass mode for V1. Real HubSpot private app validation → Slice 2.

## Relevant Files

### Existing Files (modify)

- `packages/db/src/schema/tenants.ts` — Extend with `settings` jsonb
- `packages/db/src/schema/index.ts` — Barrel export, add new tables
- `packages/db/src/index.ts` — Add Drizzle query client
- `packages/db/drizzle.config.ts` — Migration config (already points to DATABASE_URL)
- `packages/config/src/index.ts` — Expand significantly
- `packages/validators/src/index.ts` — Empty, add Zod schemas
- `apps/api/src/index.ts` — Health-only Hono app, add routes/middleware
- `apps/api/src/index.test.ts` — Add comprehensive test suites
- `apps/hubspot-extension/src/index.tsx` — Build full UI

### New Files

**Database:**

- `packages/db/src/schema/snapshots.ts`
- `packages/db/src/schema/evidence.ts`
- `packages/db/src/schema/people.ts`
- `packages/db/src/schema/provider-config.ts`
- `packages/db/src/schema/llm-config.ts`

**Domain:**

- `packages/config/src/domain-types.ts` — Full domain model
- `packages/config/src/factories.ts` — Tenant-aware fixture factories
- `packages/validators/src/snapshot.ts` — Zod schemas

**API:**

- `apps/api/src/middleware/tenant.ts`
- `apps/api/src/middleware/auth.ts`
- `apps/api/src/routes/snapshot.ts`
- `apps/api/src/services/eligibility.ts`
- `apps/api/src/services/trust.ts`
- `apps/api/src/services/reason-generator.ts`
- `apps/api/src/services/people-selector.ts`
- `apps/api/src/services/snapshot-assembler.ts`
- `apps/api/src/adapters/provider-adapter.ts` — Interface only
- `apps/api/src/adapters/mock-signal-adapter.ts` — Single V1 mock
- `apps/api/src/adapters/llm-adapter.ts` — Interface only
- `apps/api/src/adapters/mock-llm-adapter.ts` — Single V1 mock
- `apps/api/src/lib/config-resolver.ts`
- `apps/api/src/lib/encryption.ts` — Stub with Slice 2 TODO

**Frontend:**

- `apps/hubspot-extension/src/features/snapshot/hooks/use-company-context.ts`
- `apps/hubspot-extension/src/features/snapshot/hooks/use-snapshot.ts`
- `apps/hubspot-extension/src/features/snapshot/components/snapshot-state-renderer.tsx`
- `apps/hubspot-extension/src/features/snapshot/components/eligible-view.tsx`
- `apps/hubspot-extension/src/features/snapshot/components/warning-states.tsx`
- `apps/hubspot-extension/src/features/snapshot/components/empty-states.tsx`
- `apps/hubspot-extension/src/features/snapshot/components/evidence-modal.tsx`

**Docs:**

- `docs/security/SECURITY.md`

## Implementation Phases

### Phase 0: Preflight Verification

Before implementing Slice 1, verify tooling actually works:

- HubSpot testing (`createRenderer` with Vitest 4)
- Docker Postgres on port 5433 is healthy and accessible
- Drizzle migrations can connect and run
- If any of these fail, STOP and fix before proceeding

### Phase 1: Foundation (Tasks 2, 5, 11.1-11.3)

Build shared dependencies:

- Drizzle schema with tenant isolation (5 new tables)
- Domain types + factory functions for all 8 QA states
- Zod validators
- Tenant middleware + encryption stubs

### Phase 2: Core Logic (Tasks 4, 6, 7, 8, 9, 11.4)

Build business domain:

- Hono API with CORS + auth + snapshot endpoint
- Eligibility gating service (fixture data, 5-min cache)
- Provider + LLM adapter interfaces with single mocks
- Reason generation + people selection (0-3 contacts, no fabrication)
- Trust evaluation + suppression for all 8 QA states
- HubSpot auth with V1 bypass mode

### Phase 3: UI + Integration (Tasks 3, 10, 11.5-11.9)

Build user surface + verify:

- HubSpot extension context hooks
- State renderer for all 8 QA states
- Evidence inspection modal
- Docker local dev finalization
- Security documentation
- Cross-tenant integration tests

## Team Orchestration

- You operate as the team lead and orchestrate the team to execute the plan.
- You're responsible for deploying the right team members with the right context to execute the plan.
- IMPORTANT: You NEVER operate directly on the codebase. You use `Task` and `Task*` tools to deploy team members.
- Take note of the session id of each team member.

### Team Members

- Specialist
  - Name: preflight-checker
  - Role: Verify tooling (HubSpot testing, Docker Postgres, Drizzle migrations) works before implementation
  - Agent Type: general-purpose
  - Resume: false

- Specialist
  - Name: builder-db
  - Role: Database schema, Drizzle ORM tables, migrations, tenant isolation at DB level
  - Agent Type: backend-engineer
  - Resume: true

- Specialist
  - Name: builder-types
  - Role: Domain types, factory functions, Zod validators, shared type exports
  - Agent Type: typescript-pro
  - Resume: true

- Specialist
  - Name: builder-api
  - Role: Hono API routes, middleware (auth, tenant, CORS), snapshot endpoint, service orchestration
  - Agent Type: backend-engineer
  - Resume: true

- Specialist
  - Name: builder-domain
  - Role: Eligibility gating, trust/suppression logic, reason generation, people selection — core business services
  - Agent Type: backend-engineer
  - Resume: true

- Specialist
  - Name: builder-adapters
  - Role: Provider + LLM adapter interfaces with single mock implementations
  - Agent Type: backend-engineer
  - Resume: true

- Specialist
  - Name: builder-security
  - Role: Tenant resolution middleware, encryption stubs, HubSpot auth bypass mode, cross-tenant isolation tests, security documentation
  - Agent Type: backend-security-coder
  - Resume: true

- Specialist
  - Name: builder-frontend
  - Role: HubSpot extension UI — state renderer, evidence modal, company context hooks, all 8 QA state views
  - Agent Type: frontend-developer
  - Resume: true

- Quality Engineer (Validator)
  - Name: validator
  - Role: Validate completed work against acceptance criteria (read-only inspection mode)
  - Agent Type: quality-engineer
  - Resume: false

## Step by Step Tasks

- IMPORTANT: Execute every step in order. ALL tasks are sequential (single worktree, no parallel agent writes).
- Before you start, run `TaskCreate` to create the initial task list.
- All work happens in `.worktrees/slice-1/` on branch `feature/slice-1-core-domain`.
- TDD is mandatory: every implementation agent writes failing tests FIRST.
- Auto-commit after each completed step. Post-commit hook auto-pushes.

---

### Phase 0: Preflight

### 1. Preflight Tooling Verification

- **Task ID**: preflight
- **Depends On**: none
- **Assigned To**: preflight-checker
- **Agent Type**: general-purpose
- **Parallel**: false
- Working directory: `.worktrees/slice-1/`
- Verify Docker Postgres is running on port 5433: `docker compose ps | grep hap-postgres | grep healthy` — if not, run `docker compose up -d` and wait for healthcheck
- Verify DATABASE_URL can connect: `DATABASE_URL=postgresql://hap:hap_local_dev@localhost:5433/hap_dev psql -c "SELECT 1;"` (or equivalent with pnpm)
- Verify Drizzle migration pipeline works with existing tenants table: `cd packages/db && DATABASE_URL=... pnpm drizzle-kit push --config=drizzle.config.ts` (use `push` for quick iteration in V1)
- Verify HubSpot testing: write minimal test using `createRenderer('crm.record.tab')` from `@hubspot/ui-extensions/testing` that renders a simple `<Text>` component. Confirm it passes in Vitest.
- If HubSpot testing fails, research working pattern via Context7/HubSpot docs and document finding. Do NOT proceed to Phase 3 until this works.
- Report: all three checks green, with proof (command outputs)
- Commit if any fixes needed: `chore: preflight fixes for postgres/drizzle/hubspot testing`

---

### Phase 1: Foundation

### 2. Database Schema — Full Drizzle Tables (Taskmaster Task 2)

- **Task ID**: db-schema
- **Depends On**: preflight
- **Assigned To**: builder-db
- **Agent Type**: backend-engineer
- **Parallel**: false
- Working directory: `.worktrees/slice-1/`
- Extend `packages/db/src/schema/tenants.ts`: add `settings` jsonb column
- Create `packages/db/src/schema/snapshots.ts`: `id` uuid PK, `tenant_id` FK → tenants(id) cascade, `company_id` text, `eligibility_state` text, `reason_to_contact` text nullable, `trust_score` numeric nullable, `state_flags` jsonb, `created_at` timestamptz. Composite index `(tenant_id, company_id)`
- Create `packages/db/src/schema/evidence.ts`: `id` uuid PK, `tenant_id` FK cascade, `snapshot_id` FK → snapshots(id) cascade, `source` text, `timestamp` timestamptz, `confidence` numeric, `content` text, `is_restricted` boolean default false. Index `(tenant_id, timestamp)`
- Create `packages/db/src/schema/people.ts`: `id` uuid PK, `tenant_id` FK cascade, `snapshot_id` FK → snapshots(id) cascade, `name` text, `title` text nullable, `reason_to_talk` text, `evidence_refs` jsonb. Composite index `(tenant_id, snapshot_id)`
- Create `packages/db/src/schema/provider-config.ts`: `id` uuid PK, `tenant_id` FK cascade, `provider_name` text, `enabled` boolean, `api_key_encrypted` text, `thresholds` jsonb, `settings` jsonb. Unique `(tenant_id, provider_name)`
- Create `packages/db/src/schema/llm-config.ts`: `id` uuid PK, `tenant_id` FK cascade, `provider_name` text, `model_name` text, `api_key_encrypted` text, `endpoint_url` text nullable, `settings` jsonb. Unique `(tenant_id, provider_name)`
- Update `packages/db/src/schema/index.ts` barrel to export all tables
- Write TDD tests: insert/query with tenant isolation, FK cascades, unique constraints (use test DB or transactions)
- Run `pnpm drizzle-kit generate` to create migration files
- Apply migration: `pnpm drizzle-kit push` against local Postgres
- Verify with `pnpm typecheck` and `pnpm test`
- Commit: `feat(db): add full Drizzle schema with tenant isolation`

### 3. Domain Types and Factory Functions (Taskmaster Task 5)

- **Task ID**: domain-types
- **Depends On**: db-schema
- **Assigned To**: builder-types
- **Agent Type**: typescript-pro
- **Parallel**: false
- Working directory: `.worktrees/slice-1/`
- Expand `packages/config/src/index.ts` — barrel export new files
- Create `packages/config/src/domain-types.ts`:
  - `EligibilityState`: `'eligible' | 'ineligible' | 'unconfigured'`
  - `StateFlags`: `{ stale: boolean, degraded: boolean, lowConfidence: boolean, ineligible: boolean, restricted: boolean, empty: boolean }`
  - `Evidence`: `{ id: string, tenantId: string, source: string, timestamp: Date, confidence: number, content: string, isRestricted: boolean }`
  - `Person`: `{ id: string, name: string, title?: string, reasonToTalk: string, evidenceRefs: string[] }`
  - `Snapshot`: `{ tenantId: string, companyId: string, eligibilityState: EligibilityState, reasonToContact?: string, people: Person[], evidence: Evidence[], stateFlags: StateFlags, trustScore?: number, createdAt: Date }`
  - `ThresholdConfig`: `{ freshnessMaxDays: number, minConfidence: number }`
  - `LlmProviderType`: `'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'custom'`
  - `LlmProviderConfig`: `{ provider: LlmProviderType, model: string, apiKeyRef: string, endpointUrl?: string }`
  - `ProviderConfig`: `{ name: string, enabled: boolean, apiKeyRef: string, thresholds: ThresholdConfig }`
  - `TenantConfig`: extend existing with `settings?: TenantSettings`
  - `TenantSettings`: `{ defaultLlmProvider?: LlmProviderType, thresholds: ThresholdConfig, providers: ProviderConfig[] }`
- Create `packages/config/src/factories.ts` — tenant-aware factories:
  - `createSnapshot(tenantId, overrides?)`, `createEvidence(tenantId, overrides?)`, `createPerson(overrides?)`, `createStateFlags(overrides?)`
  - 8 QA fixture generators: `fixtureEligibleStrong`, `fixtureFewerContacts`, `fixtureEmpty`, `fixtureStale`, `fixtureDegraded`, `fixtureLowConfidence`, `fixtureIneligible`, `fixtureRestricted`
- Create `packages/validators/src/snapshot.ts` — Zod v4 schemas (`z.record(keySchema, valSchema)` requires 2 args)
- Write TDD tests: types compile, factories produce valid objects, Zod schemas validate, all 8 fixtures produce distinct state flags
- Verify: `pnpm typecheck` and `pnpm test`
- Commit: `feat(types): add domain model, factories, and Zod validators`

### 4. Security Stubs + Tenant Middleware (Taskmaster Task 11, subtasks 1-3)

- **Task ID**: security-foundation
- **Depends On**: domain-types
- **Assigned To**: builder-security
- **Agent Type**: backend-security-coder
- **Parallel**: false
- Working directory: `.worktrees/slice-1/`
- Create `apps/api/src/middleware/tenant.ts`:
  - Extract portal_id from auth context
  - Query `tenants` table for matching `hubspot_portal_id`
  - Set `c.set('tenantId', tenant.id)` on Hono context
  - Return 401 for missing/invalid tenant
- Create `apps/api/src/lib/encryption.ts` — STUB for V1:
  - `encryptProviderKey(tenantId: string, plaintext: string): string` — V1 returns `base64(plaintext)` with clear TODO comment
  - `decryptProviderKey(tenantId: string, ciphertext: string): string` — V1 returns `base64decode(ciphertext)`
  - Add JSDoc noting Slice 2 will implement real AES-256-GCM with tenant-derived keys
  - Interface MUST be stable so Slice 2 swap is drop-in
- Write TDD tests: middleware resolves tenant, rejects invalid, encryption roundtrips (stub), cross-tenant isolation at middleware level
- Verify: `pnpm test`
- Commit: `feat(security): add tenant middleware and encryption stubs`

---

### Phase 2: Core Logic

### 5. Hono API Routes and Snapshot Endpoint (Taskmaster Task 4)

- **Task ID**: api-routes
- **Depends On**: security-foundation
- **Assigned To**: builder-api
- **Agent Type**: backend-engineer
- **Parallel**: false
- Working directory: `.worktrees/slice-1/`
- Add CORS middleware for HubSpot origins to `apps/api/src/index.ts`
- Create `apps/api/src/middleware/auth.ts`:
  - V1: bearer auth with `hono/bearer-auth`
  - Support fixture bypass mode via `NODE_ENV=test` or config flag (returns mock portal_id)
  - Real HubSpot private app token validation is Slice 2
- Create `apps/api/src/routes/snapshot.ts`:
  - `POST /api/snapshot/:companyId` — requires auth + tenant middleware
  - Returns Snapshot JSON (wiring only; assembler logic in Task 8)
  - Errors: 400 invalid companyId, 401 unauthorized, 404 not found, 500 server error
- Wire routes in `apps/api/src/index.ts` using `app.route('/api', apiRoutes)`
- Write TDD tests using `app.request()`:
  - CORS preflight OK
  - 401 without auth token
  - 200 with bypass/valid token + mock snapshot
  - 400 for invalid companyId
  - Tenant isolation in request context
- Verify: `pnpm test` and `pnpm lint`
- Commit: `feat(api): add snapshot endpoint with auth and tenant middleware`

### 6. Eligibility Gating Service (Taskmaster Task 6)

- **Task ID**: eligibility
- **Depends On**: api-routes
- **Assigned To**: builder-domain
- **Agent Type**: backend-engineer
- **Parallel**: false
- Working directory: `.worktrees/slice-1/`
- Create `apps/api/src/services/eligibility.ts`:
  - `checkEligibility(tenantId, companyId, fetcher)` — `fetcher` is injectable for testing (fixture vs real HubSpot)
  - Reads gating property name from provider_config (default `hs_is_target_account`)
  - Returns `{ eligible: boolean, reason: 'eligible' | 'ineligible' | 'unconfigured' }`
  - In-memory cache keyed by `(tenantId, companyId)` with 5-min TTL
  - Fail-safe: missing property → unconfigured state
- V1 note: `fetcher` function receives fixture data; real HubSpot API call is Slice 2
- Write TDD tests: eligible=true/false/missing, cache hit/miss/expiry, tenant-scoped cache, configurable property name
- Verify: `pnpm test`
- Commit: `feat(domain): add target-account eligibility gating service`

### 7. Provider + LLM Adapter Interfaces with Single Mocks (Taskmaster Task 7)

- **Task ID**: adapters
- **Depends On**: domain-types, security-foundation
- **Assigned To**: builder-adapters
- **Agent Type**: backend-engineer
- **Parallel**: false
- Working directory: `.worktrees/slice-1/`
- **SCOPE DISCIPLINE: V1 builds interfaces + single mock adapters. Real Anthropic/OpenAI/Gemini/OpenRouter/Exa implementations are Slice 2.**
- Create `apps/api/src/adapters/provider-adapter.ts`:
  - `ProviderAdapter` interface: `{ name: string, fetchSignals(tenantId: string, companyName: string, domain?: string): Promise<Evidence[]> }`
- Create `apps/api/src/adapters/mock-signal-adapter.ts`:
  - Single mock implementation returning fixture Evidence arrays
  - Supports configurable fixture selection (strong, stale, degraded, empty)
- Create `apps/api/src/adapters/llm-adapter.ts`:
  - `LlmAdapter` interface: `{ provider: string, complete(prompt: string, options?: LlmOptions): Promise<LlmResponse> }`
  - `LlmOptions`: `{ model?: string, maxTokens?: number, temperature?: number }`
  - `LlmResponse`: `{ content: string, usage: { inputTokens: number, outputTokens: number } }`
- Create `apps/api/src/adapters/mock-llm-adapter.ts`:
  - Single mock returning template-based responses
  - Configurable response style (short, long, error simulation)
- Create `apps/api/src/lib/config-resolver.ts`:
  - `getProviderConfig(tenantId, providerName)` — queries provider_config
  - `getLlmConfig(tenantId)` — queries llm_config
  - Uses encryption stub for API key decrypt
  - In-memory cache with TTL
- Add TODOs marking Slice 2 work: real adapters, factory pattern, data minimization hardening
- Write TDD tests:
  - Adapter interface compliance
  - Mock adapters return correct fixtures
  - Config resolver tenant isolation
  - Cache behavior
- Verify: `pnpm test`
- Commit: `feat(adapters): add provider/LLM adapter interfaces with V1 mocks`

### 8. Reason Generation + People Selection (Taskmaster Task 8)

- **Task ID**: reason-people
- **Depends On**: eligibility, adapters
- **Assigned To**: builder-domain
- **Agent Type**: backend-engineer
- **Parallel**: false
- Working directory: `.worktrees/slice-1/`
- Create `apps/api/src/services/reason-generator.ts`:
  - `extractDominantSignal(signals, thresholds)` — highest-confidence + most-recent passing thresholds, null if none
  - `generateReasonText(signal, llmAdapter?)` — template-based for V1 (LLM call stubbed via mock)
- Create `apps/api/src/services/people-selector.ts`:
  - `fetchContacts(tenantId, companyId, fetcher)` — injectable fetcher (fixture data in V1)
  - `rankContacts(contacts, dominantSignal)` — score by title/role keyword match + recency
  - `selectPeople(ranked, maxCount=3)` — top 0-3, generate `reasonToTalk` per person
  - Never fabricates. Empty array if no qualifiers.
- Create `apps/api/src/services/snapshot-assembler.ts`:
  - Orchestrates: eligibility → signals (via mock adapter) → dominant reason → people → (trust logic comes in Task 9) → Snapshot
  - Handles paths: eligible-strong, fewer-contacts, empty, ineligible
- Wire into snapshot route so `/api/snapshot/:companyId` returns real assembled data
- Write TDD tests:
  - Dominant signal: recency wins, confidence tiebreaker, no-signal → null
  - People: 0/1/2/3 cases, no fabrication, ranking correctness
  - Assembler: all state paths produce valid Snapshot
  - Tenant scoping throughout
- Verify: `pnpm test`
- Commit: `feat(domain): add reason generation, people selection, and snapshot assembler`

### 9. Trust, Freshness, and Suppression Logic (Taskmaster Task 9)

- **Task ID**: trust-logic
- **Depends On**: reason-people
- **Assigned To**: builder-domain
- **Agent Type**: backend-engineer
- **Parallel**: false
- Working directory: `.worktrees/slice-1/`
- Create `apps/api/src/services/trust.ts`:
  - `TrustEvaluator` class:
    - `evaluateFreshness(evidence, thresholds)` → `{ isFresh: boolean, ageDays: number }`
    - `evaluateConfidence(evidence, thresholds)` → `{ isAdequate: boolean, score: number }`
    - `validateSource(evidence)` → `{ isValid: boolean, degradationReason?: string }`
    - `applySuppression(evidence[], thresholds)` → `{ filteredEvidence: Evidence[], stateFlags: StateFlags, warnings: string[] }`
  - Suppression rules:
    - `restricted` → completely empty response (no evidence, no summary, nothing leaked)
    - `stale` → show with age warning
    - `lowConfidence` → show with caution + score
    - `degraded` → show as system/source issue
  - Reads thresholds from tenant-specific provider_config
- Update `apps/api/src/services/snapshot-assembler.ts` — call TrustEvaluator before final snapshot return
- Write TDD tests for ALL 8 QA states:
  1. Eligible, strong evidence → full snapshot
  2. Eligible, fewer than 3 contacts → partial people + note
  3. Empty / no credible reason → explicit empty
  4. Stale → stateFlags.stale=true, ageDays present
  5. Degraded → stateFlags.degraded=true, degradationReason
  6. Low-confidence → stateFlags.lowConfidence=true, score shown
  7. Ineligible → eligibilityState='ineligible'
  8. Restricted → completely empty, ZERO evidence leakage (assert empty arrays/null fields)
- Test tenant-specific thresholds: tenant A lenient vs tenant B strict produce different results for same evidence
- Verify: `pnpm test`
- Commit: `feat(domain): add trust evaluation and suppression logic for all 8 QA states`

---

### Phase 3: UI + Integration

### 10. HubSpot Extension — Company Context Hooks (Taskmaster Task 3, subtasks 1-4)

- **Task ID**: extension-hooks
- **Depends On**: trust-logic
- **Assigned To**: builder-frontend
- **Agent Type**: frontend-developer
- **Parallel**: false
- Working directory: `.worktrees/slice-1/`
- Create `apps/hubspot-extension/src/features/snapshot/hooks/use-company-context.ts`:
  - Extracts `companyId`, `objectType`, `portalId` from HubSpot context
  - Uses `fetchCrmObjectProperties(['name', 'domain', 'hs_is_target_account'])`
  - Handles loading state
- Create `apps/hubspot-extension/src/features/snapshot/hooks/use-snapshot.ts`:
  - Fetches snapshot from API
  - Returns `{ snapshot, loading, error }`
- Update `apps/hubspot-extension/src/index.tsx` to use hooks
- Write TDD tests using pattern verified in preflight:
  - Hook returns companyId from mock context
  - Snapshot hook loading → loaded → error transitions
- Verify: `pnpm test`
- Commit: `feat(extension): add company context and snapshot hooks`

### 11. HubSpot Extension — State Rendering for All 8 QA States (Taskmaster Task 10)

- **Task ID**: extension-ui
- **Depends On**: extension-hooks
- **Assigned To**: builder-frontend
- **Agent Type**: frontend-developer
- **Parallel**: false
- Working directory: `.worktrees/slice-1/`
- Create in `apps/hubspot-extension/src/features/snapshot/components/`:
  - `snapshot-state-renderer.tsx` — central switch on eligibilityState + stateFlags
  - `eligible-view.tsx` — reason + people list (3 and 1-2 variants) + evidence link triggers
  - `warning-states.tsx` — stale (Alert warning), degraded (Alert danger), lowConf (Alert caution + score)
  - `empty-states.tsx` — empty/no-reason text, ineligible text, restricted (renders nothing)
  - `evidence-modal.tsx` — source/timestamp/confidence display
- Use HubSpot UI components: `Flex`, `Text`, `Tile`, `Alert`, `LoadingSpinner`, `DescriptionList`, `Button`, `Modal`/`Panel`
- Write TDD render tests for ALL 8 QA states (pattern from preflight):
  1. eligible-strong, 2. eligible-fewer-contacts, 3. empty, 4. stale, 5. degraded, 6. low-confidence, 7. ineligible, 8. restricted
- Test evidence modal open/close, loading spinner, Escape key accessibility
- Verify: `pnpm test`
- Commit: `feat(extension): add state rendering and evidence modal for all 8 QA states`

### 12. Docker + Security Docs + Cross-Tenant Tests (Taskmaster Task 11, subtasks 5-9)

- **Task ID**: devops-security
- **Depends On**: extension-ui
- **Assigned To**: builder-security
- **Agent Type**: backend-security-coder
- **Parallel**: false
- Working directory: `.worktrees/slice-1/`
- Update `docker-compose.yml` — add init SQL for seeding test tenants if needed
- Create `docs/security/SECURITY.md`:
  - Tenant middleware architecture
  - DB isolation (tenant_id on all tables, composite indexes, FK cascades)
  - Encryption approach (V1 stub + Slice 2 plan for AES-256-GCM)
  - Auth flow (V1 bypass mode + Slice 2 HubSpot private app validation)
  - Data minimization rules for adapters
  - Cross-tenant test coverage summary
  - Threat model basics and compliance checklist
- Write cross-tenant integration tests:
  - Tenant A cannot query tenant B snapshots
  - Tenant A cannot decrypt tenant B provider keys (stub level)
  - Eligibility cache isolated per tenant
  - Restricted evidence never leaks across tenants
- Verify: `pnpm test`, `pnpm lint`, `pnpm typecheck`
- Commit: `docs(security): add security architecture and cross-tenant integration tests`

---

### Final Validation

### 13. Full Validation

- **Task ID**: validate-all
- **Depends On**: preflight, db-schema, domain-types, security-foundation, api-routes, eligibility, adapters, reason-people, trust-logic, extension-hooks, extension-ui, devops-security
- **Assigned To**: validator
- **Agent Type**: quality-engineer
- **Parallel**: false
- Run all validation commands (see below)
- Verify acceptance criteria met
- Operate in validation mode: inspect and report only, do not modify files
- Check all 8 QA states have test coverage (both backend trust logic and frontend rendering)
- Verify no hardcoded secrets, thresholds, or provider logic
- Verify tenant isolation in DB queries, middleware, adapters, caches
- Verify domain types used consistently across FE/BE
- Verify Slice 2 TODOs are clearly marked (encryption, real adapters, real auth)
- Report pass/fail with specifics. If fail, create a fix task before PR.

## Acceptance Criteria

1. **Preflight passed**: Docker Postgres, Drizzle migrations, HubSpot testing all confirmed working
2. **Schema complete**: 6 tables (tenants, snapshots, evidence, people, provider_config, llm_config) with tenant_id FK + cascade deletes
3. **Domain types**: Snapshot, Evidence, Person, StateFlags, ThresholdConfig, ProviderConfig, LlmProviderConfig all exported from `@hap/config`
4. **Factory functions**: 8 fixture generators produce distinct state flags for all QA states
5. **Snapshot endpoint**: `POST /api/snapshot/:companyId` returns valid Snapshot JSON
6. **Auth enforced**: 401 without valid bearer token
7. **Tenant isolation**: Tenant A cannot see tenant B data (tested at middleware, DB, cache, adapter levels)
8. **Eligibility gating**: Configurable via DB, cached 5-min, fail-safe defaults
9. **Adapter interfaces**: ProviderAdapter + LlmAdapter interfaces stable; mock implementations present; real impls deferred to Slice 2 with TODOs
10. **Trust evaluation**: All 8 QA states produce correct StateFlags
11. **Restricted suppression**: Restricted evidence returns empty — asserted zero leaks
12. **UI renders all 8 states**: Each explicitly distinguishable
13. **Evidence modal**: Shows source, timestamp, confidence
14. **No fabrication**: 0-3 people, never filler contacts
15. **Config-driven**: Thresholds, providers, gating property — all from DB
16. **TDD**: Every feature has tests written before implementation (verified via commit history)
17. **Slice 2 boundaries clear**: Real adapters, encryption, auth validation marked with TODO + JSDoc
18. **All checks pass**: `pnpm test`, `pnpm lint`, `pnpm typecheck` — zero errors

## Validation Commands

Execute these commands to validate the task is complete:

- `cd .worktrees/slice-1 && docker compose ps | grep healthy` — Postgres healthy
- `cd .worktrees/slice-1 && pnpm test` — All tests pass (target: 60+ tests)
- `cd .worktrees/slice-1 && pnpm lint` — Zero errors
- `cd .worktrees/slice-1 && pnpm typecheck` — Zero TypeScript errors
- `cd .worktrees/slice-1 && grep -r "TODO.*Slice 2\|FIXME\|HACK" apps/ packages/ --include="*.ts" --include="*.tsx"` — Verify Slice 2 markers present and nothing else
- `cd .worktrees/slice-1 && pnpm test -- --coverage` — Review coverage report for critical paths
- Manual review: confirm no real LLM/Exa API calls in V1 code

## Notes

1. **Sequential execution only**: Single worktree = no parallel agent writes. Every task waits for predecessor.

2. **V1 is fixture-backed**: All provider integrations use mock data. Real API calls are Slice 2. This matches PRD: "fixture-backed Slice 1 work first so state semantics stabilize."

3. **Adapter interfaces are stable**: The interfaces shipped in Task 7 must NOT change in Slice 2 — only implementations swap. This means interface design requires care now.

4. **Encryption is a stub**: V1 uses base64 (obviously insecure). This is intentional — it keeps the code paths honest (we're clearly not secure) while establishing the API shape. Slice 2 implements real AES-256-GCM.

5. **Auto-commit workflow**: Each task completion triggers a commit. Post-commit hook auto-pushes to `origin/feature/slice-1-core-domain`. When all 13 steps pass, create PR to main for CodeRabbit review.

6. **Stack reference**: All agents reference `.taskmaster/docs/STACK_REFERENCE.md` for library patterns (Drizzle setup, Hono testing, Zod v4 breaking changes, Biome 2 config).

7. **Preflight is a gate**: If HubSpot testing doesn't work in preflight, we pause and fix it (or find alternative testing strategy) before planning 8 UI state tests around it.
