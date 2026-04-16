# AGENTS.md

This file gives Codex-style agents a repo-native operating contract for this worktree.
It complements `CLAUDE.md`; it does not replace it.

Scope: this file applies to the repository root of this worktree and everything beneath it.

## Source Of Truth

Read these before planning or coding:

- `CLAUDE.md`
- `PLANNING_INDEX.md`
- `.taskmaster/docs/prd.md`
- `planning/chatprd/AI_CODING_RULES_AND_STANDARDS.md`
- `docs/security/SECURITY.md`

For Slice 3 Phase 3 work, also read:

- `.claude/tasks/2026-04-16-slice-3-phase-3-rls-card-bundling.md`
- `docs/slice-3-preflight-notes.md`
- `docs/superpowers/plans/2026-04-15-slice-3-oauth-public-app.md`

If a referenced file in `CLAUDE.md` has moved, use `PLANNING_INDEX.md` to resolve the current path instead of guessing.

## Precedence

If this file and `CLAUDE.md` ever drift, follow:

1. explicit user/system/developer instructions
2. the active task plan for the slice you are executing
3. `CLAUDE.md`
4. this `AGENTS.md`

## Product Guardrails

- Keep the wedge narrow: one credible reason to contact the account now.
- Primary surface is HubSpot `crm.record.tab`.
- Show up to 3 people plus reason-to-talk.
- Do not expand into a broad dashboard, generic research report, or transcript workflow.
- HubSpot is the source of truth for CRM entities and associations.
- No silent CRM writes.

## Architecture Guardrails

- Tenant isolation is mandatory.
- Behavior must stay config-driven; no hardcoded tenant, provider, threshold, or environment assumptions.
- Keep integrations behind adapters.
- UI consumes backend/domain outputs; it must not invent trust semantics.
- Restricted evidence must never be surfaced or summarized.
- Prefer explicit empty or suppressed states over bluffing.

## Phase 3 Locked Decisions

- RLS DB-handle injection lives in one middleware in `apps/api/src/index.ts`, immediately after `tenantMiddleware`.
- `tenants` is not under RLS.
- `ProviderAdapter.fetchSignals()` uses the structured context arg: `{ companyId, companyName?, domain? }`.
- Nonce middleware runs after auth and tenant middleware, and uses `c.get('rawBody')`.
- Signal factory deps include `db` and `tenantId` so HubSpot enrichment can construct its own client.
- Card bundling output is an IIFE locked to `dist/index.js`.
- Biome import restriction targets `createDatabase` usage, not general `@hap/db` schema/type imports.

## TDD And Verification

- No production code without a failing test first.
- For each task: write the failing test, confirm failure, implement the minimum change, confirm pass, then run broader verification.
- Do not claim something works without running the command that proves it.
- Before finishing the slice, run the validation commands listed in the active plan.

## Implementation Hygiene

- Use the Phase 3 worktree only: `.worktrees/slice-3-phase-3`.
- Preserve existing user changes; never revert unrelated work.
- In routes/services, do not reintroduce process-wide DB access after RLS wiring. Use the request-scoped handle from Hono context.
- Do not restore mock fallback behavior in production paths.
- Verify current docs before material work on HubSpot, Hono, Drizzle, or other major dependencies.
