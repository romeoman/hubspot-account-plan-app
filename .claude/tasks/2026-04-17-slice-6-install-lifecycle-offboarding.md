# Plan: Slice 6 - Install Lifecycle and Tenant Offboarding

## Task Description

Slices 1 through 5 now cover the main product wedge end to end:

- HubSpot company-record card
- real provider and LLM integrations
- OAuth install flow
- tenant-scoped RLS and replay protection
- HubSpot settings UI for per-tenant configuration
- production/pilot-ready app config and deployment contract

The next engineering gap is not another user-facing feature. It is lifecycle
completeness after install:

- what happens when HubSpot uninstall or token revocation occurs
- how tenant OAuth credentials are deactivated or removed
- how the app behaves after install loss or revoked access
- how re-install behaves after prior tenant state exists
- how operations can reason about tenant lifecycle state safely

Today the app can install and run, but uninstall/offboarding behavior is still
thin and partially implicit. That creates operational and security risk:

- stale OAuth credentials may remain stored after uninstall
- tenant lifecycle state is not yet explicit enough for offboarding flows
- revoked access may surface as generic runtime failures rather than a clean
  lifecycle state
- re-install after uninstall/revocation is not yet locked as a deliberate flow

Slice 6 should stay narrow. It is not a billing slice, not marketplace asset
submission, not admin analytics, and not a broader workspace expansion. It is
the minimum install-lifecycle and offboarding slice needed to make the app
operationally complete after Slice 5.

Two lifecycle decisions should be treated as explicit contracts in this slice,
not left implicit:

1. **Lifecycle event source**
   - preflight must verify whether HubSpot provides a real uninstall/revocation
     webhook/event we can trust directly
   - if not, the slice must explicitly adopt token-failure-driven revocation
     inference
   - if both exist, the slice should lock a hybrid model with one source marked
     primary and the other as reconciliation/fallback

2. **Offboarding data policy**
   - default Slice 6 recommendation is:
     - soft-deactivate the tenant
     - clear or invalidate stored OAuth credentials
     - preserve tenant config and historical app data
     - reactivate the same tenant identity on reinstall
   - hard-delete is out of scope unless a concrete legal/compliance requirement
     forces it

## Objective

When Slice 6 is complete, the system can correctly handle HubSpot app uninstall
or token revocation events, mark the tenant lifecycle state safely, revoke or
disable further tenant-scoped API use, and support a clean reinstall flow
without cross-tenant leakage or broken residual state.

## Relevant Files

### Existing files to modify

- `apps/api/src/routes/oauth.ts`
  - extend lifecycle handling where reinstall and revoked access intersect the OAuth flow
- `apps/api/src/lib/hubspot-client.ts`
  - define behavior for revoked/invalid tenant tokens and post-revocation client use
- `apps/api/src/middleware/tenant.ts`
  - ensure deactivated/offboarded tenants fail safely and explicitly
- `apps/api/src/routes/settings.ts`
  - verify settings access for deactivated/offboarded tenants behaves correctly
- `apps/api/src/routes/snapshot.ts`
  - ensure snapshot generation fails explicitly for deactivated/offboarded tenants
- `apps/api/src/lib/settings-service.ts`
  - protect settings reads/writes after tenant offboarding if needed
- `packages/db/src/schema/tenants.ts`
  - extend lifecycle state only if the current tenant model is insufficient
- `packages/db/src/schema/tenant-hubspot-oauth.ts`
  - extend token/offboarding metadata only if needed
- `docs/security/SECURITY.md`
  - add uninstall, revocation, offboarding, and reinstall guarantees
- `README.md`
  - update lifecycle assumptions if local/manual cleanup guidance changes
- `PLANNING_INDEX.md`
  - add Slice 6 as the active next execution plan once approved

### New files

- `docs/slice-6-preflight-notes.md`
  - verified lifecycle/offboarding contract and current HubSpot webhook assumptions
- `docs/runbooks/tenant-offboarding.md`
  - operational checklist for uninstall, revocation, and reinstall handling
- `docs/security/slice-6-audit.md`
  - focused security review for lifecycle/offboarding behavior
- `apps/api/src/routes/__tests__/hubspot-lifecycle.test.ts`
  - lifecycle endpoint behavior: uninstall, revocation, and reinstall cases
- `apps/api/src/lib/__tests__/tenant-lifecycle.test.ts`
  - domain/service-level offboarding behavior
- `apps/api/src/routes/hubspot-lifecycle.ts`
  - receiver for uninstall / lifecycle notifications if a dedicated route is cleaner

## Step by Step Tasks

### Phase 0: Preflight and scope lock

1. **Task ID: lifecycle-preflight**
   - Verify current HubSpot docs for:
     - app uninstall lifecycle behavior
     - webhook/event support for uninstall or token revocation
     - what signals are actually available versus what must be inferred on failed token use
   - Verify current repo assumptions around:
     - `tenant_hubspot_oauth`
     - tenant deactivation / soft-delete semantics
     - reinstall expectations after prior tenant existence
   - Explicitly lock one lifecycle-event-source model:
     - webhook-driven
     - token-failure-driven
     - hybrid
   - Record verified decisions in `docs/slice-6-preflight-notes.md`.
   - Dependency: none

2. **Task ID: slice6-scope-contract**
   - Lock Slice 6 to:
     - uninstall / revocation detection
     - tenant lifecycle state handling
     - post-offboarding runtime protection
     - reinstall correctness
     - lifecycle runbook and security documentation
   - Lock the offboarding data policy explicitly:
     - tenant is soft-deactivated, not hard-deleted
     - OAuth credentials are cleared or made unusable
     - provider/LLM config and historical app data are preserved
     - reinstall reactivates the same tenant identity
   - Explicitly defer:
     - billing
     - marketplace listing copy/assets submission
     - analytics/admin reporting
     - broad customer-success workflows
   - Dependency: lifecycle-preflight

### Phase 1: Data model and lifecycle contract

3. **Task ID: tenant-lifecycle-model**
   - Decide whether current tenant schema is sufficient or needs explicit lifecycle fields, for example:
     - `status`
     - `deactivatedAt`
     - `deactivationReason`
     - OAuth token invalidation metadata
   - Add failing tests first, then the minimum schema/domain changes required.
   - Keep lifecycle semantics explicit and config-driven rather than inferred from scattered null checks.
   - The model must reflect the locked soft-deactivate policy and must not
     assume hard-delete as the normal uninstall path.
   - Dependency: slice6-scope-contract

4. **Task ID: lifecycle-service**
   - Implement a single orchestration layer for:
     - marking tenant OAuth access revoked
     - marking tenant app installation removed / deactivated
     - clearing or invalidating stored tenant OAuth credentials as appropriate
     - determining whether reinstall should reactivate an existing tenant or create fresh linked state
   - Dependency: tenant-lifecycle-model

### Phase 2: App lifecycle ingestion and runtime behavior

5. **Task ID: lifecycle-endpoint**
   - Add the lifecycle receiver path required by the verified HubSpot contract.
   - If HubSpot uninstall is webhook-driven, implement and verify that route.
   - If revocation must be inferred from token failures, codify that path
     explicitly instead of leaving it ad hoc.
   - If the contract is hybrid, document which signal is authoritative and how
     reconciliation works.
   - Add request verification and replay protection if the endpoint requires the same signed-request model.
   - Dependency: lifecycle-service

6. **Task ID: runtime-offboarding-guards**
   - Update runtime request handling so deactivated/offboarded tenants fail safely and explicitly in:
     - snapshot route
     - settings route
     - HubSpot client construction/use
   - Return a clear lifecycle-specific state instead of generic internal failures.
   - Dependency: lifecycle-endpoint

7. **Task ID: reinstall-flow**
   - Verify and harden the reinstall path:
     - uninstall → reinstall same portal
     - revoked access → reinstall / reauthorize
     - previously deactivated tenant coming back online
   - Ensure reinstall does not duplicate tenant identity or leave broken mixed lifecycle state.
   - Reactivation of the same tenant identity is the default Slice 6 policy and
     should only change if preflight uncovers a concrete reason it is unsafe.
   - Dependency: runtime-offboarding-guards

### Phase 3: UI and operational handling

8. **Task ID: lifecycle-empty-states**
   - Add explicit UI/system states for lifecycle problems where needed:
     - app no longer authorized
     - tenant deactivated/offboarded
     - reinstall required
   - Keep the UX narrow and operationally clear.
   - Dependency: reinstall-flow

9. **Task ID: offboarding-runbook**
   - Document the operational path for:
     - uninstall handling
     - token revocation handling
     - tenant deactivation/reactivation
     - reinstall verification
   - Include rollback/recovery notes where appropriate.
   - Dependency: reinstall-flow

10. **Task ID: doc-stack-cleanup-slice6**
    - Update repo docs so the lifecycle/offboarding model is easy to find:
      - `PLANNING_INDEX.md`
      - `README.md`
      - any runbook or security references that still imply install-only thinking
    - Dependency: offboarding-runbook

### Phase 4: Validation and merge prep

11. **Task ID: security-audit-slice6**
    - Audit the lifecycle/offboarding path for:
      - stale credential retention
      - accidental continued tenant access after uninstall
      - reinstall identity drift
      - webhook/request verification gaps
      - cross-tenant leakage during lifecycle transitions
    - PASS/FAIL per area.
    - Dependency: lifecycle-empty-states

12. **Task ID: code-review-slice6**
    - Review the slice with focus on:
      - lifecycle race conditions
      - reinstall regressions
      - tenant-state inconsistency
      - documentation/runbook correctness
    - Fix only real findings.
    - Dependency: security-audit-slice6

13. **Task ID: validate-all-slice6**
    - Run final validation:
      - `pnpm install --frozen-lockfile`
      - `pnpm lint`
      - `pnpm test`
      - `pnpm typecheck`
      - `pnpm db:migrate`
      - any lifecycle-specific validation command introduced by the slice
    - Final acceptance:
      - uninstall/revocation no longer leaves ambiguous runtime behavior
      - reinstall is repeatable and tenant-safe
      - lifecycle docs point to the correct active sources
    - Dependency: code-review-slice6

## Acceptance Criteria

- The app has an explicit, documented lifecycle contract for uninstall, revocation, deactivation, and reinstall.
- The slice explicitly documents which lifecycle event source is authoritative:
  webhook-driven, token-failure-driven, or hybrid.
- Tenant lifecycle state is represented clearly in the backend rather than being inferred from incidental failures alone.
- Stored HubSpot OAuth credentials are invalidated, cleared, or otherwise made unusable according to the locked lifecycle policy.
- The offboarding policy is explicit: soft-deactivate tenant, preserve app data,
  disable OAuth access, and reactivate the same tenant on reinstall unless a
  verified requirement forces a different rule.
- Deactivated/offboarded tenants cannot continue using snapshot/settings paths as if still installed.
- Runtime behavior after uninstall/revocation is explicit and user-operationally understandable.
- Reinstalling the app for the same portal does not create duplicate tenant identity or inconsistent OAuth state.
- Security documentation covers lifecycle/offboarding guarantees and residual risks.
- Final validation passes:
  - `pnpm lint`
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm db:migrate`

## Team Orchestration

- Planning can be done on `main` with no new worktree.
- Implementation should use a fresh Slice 6 branch/worktree off `main` once this plan is approved.
- TDD stays mandatory for every task that changes code.
- Parallelization opportunities:
  - lifecycle schema/service work can proceed alongside runbook drafting after preflight
  - UI lifecycle-state work can proceed once runtime guard contracts are stable
- Sequential dependencies:
  - preflight must happen before lifecycle receiver design
  - lifecycle model must be stable before runtime guard wiring
  - reinstall handling should finalize only after offboarding semantics are locked

### Team Members

- `general-purpose` — **lifecycle-contract**
  - owns preflight, schema/domain lifecycle model, and service orchestration
- `general-purpose` — **runtime-guard**
  - owns lifecycle endpoint, HubSpot client behavior, route protection, and reinstall flow
- `general-purpose` — **ops-docs**
  - owns offboarding runbook, doc-stack cleanup, and lifecycle state UX wording
- `quality-engineer`
  - owns lifecycle regression tests, security audit, and final validation
