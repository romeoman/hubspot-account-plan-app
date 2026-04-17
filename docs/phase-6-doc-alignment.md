# Phase 6 Doc Alignment

Date: 2026-04-17

Purpose: confirm the active planning and execution documents for Slice 6 before
any implementation work starts.

## Conclusion

The planning stack is still sound. The next engineering slice should be driven
by the new Slice 6 plan plus the existing repo-local execution/security docs.

The main maintenance issue remains path drift in older planning references, not
missing product direction.

## Active Slice 6 Source Of Truth

Use these as the primary execution stack for Slice 6:

1. `.claude/tasks/2026-04-17-slice-6-install-lifecycle-offboarding.md`
2. `CLAUDE.md`
3. `AGENTS.md`
4. `docs/security/SECURITY.md`
5. `.taskmaster/docs/prd.md`
6. `planning/chatprd/AI_CODING_RULES_AND_STANDARDS.md`
7. `planning/local/TASKMASTER_EXECUTION_PRD.md`
8. `docs/slice-6-preflight-notes.md`
9. `docs/runbooks/tenant-offboarding.md`
10. `docs/security/slice-6-audit.md`
11. `docs/slice-3-preflight-notes.md`
12. `docs/slice-5-preflight-notes.md`

Why these matter:

- the Slice 6 plan is the active implementation contract
- `SECURITY.md` already captures the shipped OAuth, RLS, replay-nonce, and
  settings guarantees that Slice 6 must preserve
- the Slice 6 preflight, offboarding runbook, and audit note lock the actual
  lifecycle contract and operational handling for this slice
- `.taskmaster/docs/prd.md` and the local execution PRD still define the wedge
  boundaries and what remains out of scope
- Slice 3 and Slice 5 preflight notes are still relevant because Slice 6 builds
  directly on the OAuth install model and the production/pilot contract

## What We Verified

- Slice 5 is fully merged on `main`
- the repo is clean after merge
- no Slice 5 worktree or feature branch remains
- `tenant_hubspot_oauth` is the current per-tenant OAuth storage model
- tenant lifecycle/offboarding is not yet an explicit first-class contract
- earlier planning docs explicitly deferred uninstall/token-revocation follow-up

## Important Existing Constraints For Slice 6

- Keep the wedge narrow: no billing, no analytics/admin dashboard expansion, no
  transcript work.
- Preserve tenant identity rules:
  - `tenants.hubspot_portal_id` remains the single source of truth for portal
    identity
  - `tenant_hubspot_oauth` remains tenant-scoped and RLS-protected
- Slice 6 must not weaken:
  - RLS boundaries
  - replay protection for signed requests
  - settings secret-handling guarantees
  - production/pilot environment contract from Slice 5

## Slice 6 Open Questions That Must Be Locked In Preflight

1. What is the authoritative lifecycle event source?
   - webhook-driven
   - token-failure-driven
   - hybrid

2. What exact offboarding policy is in force?
   - current recommended default is:
     - soft-deactivate tenant
     - clear or invalidate OAuth credentials
     - preserve provider/LLM config and historical app data
     - reactivate the same tenant identity on reinstall

These are already reflected in the Slice 6 plan and must be verified during
`lifecycle-preflight`, not improvised mid-implementation.

## Current Recommendation

The next implementation branch should begin with:

1. `lifecycle-preflight`
2. `slice6-scope-contract`

No code changes should start before those two tasks are complete, because the
offboarding/event-source contract controls schema shape, endpoint design, and
runtime guard behavior.
