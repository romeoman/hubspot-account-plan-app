# Phase 5 Doc Alignment

Date: 2026-04-17

Purpose: identify the planning and execution documents that are actually present
in the repository now, call out stale path references, and define the active
source-of-truth stack for Slice 5.

## Summary

The planning foundation is still valid and should continue guiding execution.
The main issue is not product-direction drift. The issue is **path drift**:
some older planning-index entries refer to ChatPRD mirror files that are no
longer present at those exact local paths.

That means:

- we should keep using the planning/PRD stack
- we should not invent direction outside it
- we should treat the currently present local files as the active source of truth
- we should clean the stale path references during Slice 5

## Present and active

These files are present and should be treated as current, reliable guides for
Slice 5 planning and execution:

- `CLAUDE.md`
- `AGENTS.md`
- `PLANNING_INDEX.md`
- `.taskmaster/docs/prd.md`
- `planning/chatprd/AI_CODING_RULES_AND_STANDARDS.md`
- `planning/local/TASKMASTER_EXECUTION_PRD.md`
- `planning/local/AI_CODING_RULES_AND_STANDARDS.md`
- `planning/local/STACK_HOSTING_AND_TEST_ENV_NOTES.md`
- `docs/security/SECURITY.md`
- `docs/slice-3-preflight-notes.md`
- `docs/slice-4-preflight-notes.md`
- `.claude/tasks/2026-04-16-slice-3-phase-3-rls-card-bundling.md`
- `.claude/tasks/2026-04-16-slice-4-settings-configuration.md`
- `.claude/tasks/2026-04-17-slice-5-production-marketplace-readiness.md`
- `docs/superpowers/plans/2026-04-14-slice-1-core-domain.md`
- `docs/superpowers/plans/2026-04-15-slice-2-live-integrations.md`
- `docs/superpowers/plans/2026-04-15-slice-3-oauth-public-app.md`

## Referenced by index but not present at the listed path

These are the clearest stale path cases discovered during the audit:

- `planning/chatprd/PRODUCT_BRIEF_FOR_AI_DEVELOPMENT.md`
- `planning/chatprd/IMPLEMENTATION_PLAN.md`
- `planning/chatprd/REPO_DRAFT_AND_EXECUTION_CHECKLIST.md`
- `planning/chatprd/SECURITY_PERMISSION_GATE.md`
- `planning/chatprd/SPEC_FOR_AI_PROTOTYPING.md`

Also missing from `planning/local/` despite being referenced by the index:

- `planning/local/ENGINEERING_REVIEW_TEST_PLAN.md`
- `planning/local/LOCAL_REPO_DRAFT_AND_CHECKLIST.md`
- `planning/local/LOCAL_IMPLEMENTATION_PLAN_WITH_AUTOPLAN_REVIEW.md`
- `planning/local/OFFICE_HOURS_DESIGN_DOC.md`
- `planning/local/SECURITY_PERMISSION_GATE.md`
- `planning/local/SPEC_FOR_AI_PROTOTYPING.md`
- `planning/local/QA_AND_VERIFICATION_PLAN.md`
- `planning/local/DOC_STACK_REVIEW_NOTES.md`

This does **not** mean those ideas are invalid. It means the local mirror/index
no longer matches the files that actually exist in this repository.

## Slice 5 source-of-truth stack

For Slice 5, use this order:

1. explicit user instructions
2. `.claude/tasks/2026-04-17-slice-5-production-marketplace-readiness.md`
3. `CLAUDE.md`
4. `AGENTS.md`
5. `docs/security/SECURITY.md`
6. `docs/slice-3-preflight-notes.md`
7. `docs/slice-4-preflight-notes.md`
8. `.taskmaster/docs/prd.md`
9. `planning/chatprd/AI_CODING_RULES_AND_STANDARDS.md`
10. `planning/local/TASKMASTER_EXECUTION_PRD.md`
11. `PLANNING_INDEX.md` as a map, but only after verifying referenced files exist

## Slice 5 sanity check

The Slice 5 plan is aligned with the active doc stack:

- it preserves the locked wedge
- it does not introduce dashboard or transcript scope creep
- it follows the already-documented post-Slice-4 reality
- it targets a real remaining gap in shipped code: production/staging and pilot readiness

The strongest concrete motivators are already present in repo state:

- `apps/hubspot-project/src/app/app-hsmeta.json` still includes
  `http://localhost:3000/oauth/callback`
- `docs/slice-3-preflight-notes.md` explicitly calls out the unresolved
  production-domain/listing gap
- Taskmaster's current board is exhausted, so the next execution pass requires
  a fresh slice plan rather than the original `master` task set

## Action for Slice 5

During Slice 5, clean the planning-map drift without changing the underlying
product direction:

- update `PLANNING_INDEX.md` so it reflects files that actually exist
- avoid referencing missing mirror docs as if they are available locally
- keep using the present security/preflight/slice plans as the operational guide
