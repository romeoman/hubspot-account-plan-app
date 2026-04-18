# Plan: Slice 5 - Production and Marketplace Readiness

## Task Description

Slices 1 through 4 now cover the core product wedge:

- HubSpot company-record card
- real provider and LLM integrations
- OAuth install flow
- tenant-scoped RLS and replay protection
- HubSpot settings UI for per-tenant configuration

The next gap is not another feature surface. It is the path from a working local
and staging-oriented app to a production-installable product that can survive a
real pilot and prepare for HubSpot marketplace submission.

Today the biggest remaining readiness gaps are operational and configuration
oriented:

- `apps/hubspot-project/src/app/app-hsmeta.json` still points OAuth callbacks at
  `http://localhost:3000/oauth/callback`
- production/staging origin handling is not yet locked as a first-class deploy contract
- two-portal install validation is not yet represented as a clean, repeatable slice
- installer-facing success/error/onboarding flow needs to be tightened for real usage
- doc-stack drift means some older planning references are no longer the best active source

Slice 5 should deliberately avoid broadening the wedge. This is not a dashboard
slice, not a reporting slice, and not a new research feature. It is the minimum
production-readiness and marketplace-pilot slice needed to make the shipped app
operationally credible outside local development.

## Objective

When Slice 5 is complete, the app can be deployed against real staging/production
origins, installed into more than one portal through the supported OAuth flow,
guided through a clean post-install setup experience, and documented well enough
for a controlled pilot and marketplace-preparation workflow.

## Relevant Files

### Existing files to modify

- `apps/hubspot-project/src/app/app-hsmeta.json`
  - replace localhost-only callback assumptions with profile-driven staging/production-ready config
- `apps/api/src/routes/oauth.ts`
  - verify redirect and callback behavior against non-local origins
- `apps/api/src/lib/hubspot-client.ts`
  - confirm production-safe assumptions for OAuth token use and refresh
- `apps/api/src/routes/settings.ts`
  - confirm post-install and first-run configuration flow works cleanly after OAuth install
- `apps/hubspot-extension/src/features/snapshot/components/empty-states.tsx`
  - tighten unconfigured/install guidance if the current text is not enough for pilot users
- `apps/hubspot-extension/src/settings/settings-page.tsx`
  - ensure onboarding-to-configured flow is clear for real installs
- `scripts/hs-project-upload.ts`
  - production/staging-safe packaging and upload path
- `docs/security/SECURITY.md`
  - add production-readiness and install-flow notes where needed
- `README.md`
  - update setup/deploy instructions if local-only assumptions remain
- `PLANNING_INDEX.md`
  - clean stale path expectations if Slice 5 introduces a better active-doc contract

### New files

- `docs/slice-5-preflight-notes.md`
  - production + marketplace readiness contract and verified external assumptions
- `docs/qa/slice-5-pilot-walkthrough.md`
  - step-by-step pilot validation across install → configure → company-record usage
- `docs/runbooks/production-deploy.md`
  - deployment/runbook checklist if a dedicated runbook does not already exist
- `apps/api/src/routes/__tests__/oauth-production.test.ts`
  - focused coverage for non-local origin/callback assumptions
- `apps/hubspot-extension/src/settings/__tests__/first-run-onboarding.test.tsx`
  - optional if first-run UX needs explicit regression protection

## Step by Step Tasks

### Phase 0: Preflight and scope lock

1. **Task ID: production-preflight**
   - Verify current HubSpot docs for:
     - marketplace/public app OAuth expectations
     - redirect URL requirements
     - permitted URL / app config requirements for production
   - Verify current deployment assumptions for the API origin and callback flow.
   - Record all verified decisions in `docs/slice-5-preflight-notes.md`.
   - Dependency: none

2. **Task ID: slice5-scope-contract**
   - Lock Slice 5 to:
     - production/staging origin readiness
     - OAuth callback and app-config cleanup
     - install/onboarding hardening
     - two-portal pilot validation
     - deployment and rollout docs
   - Explicitly defer:
     - marketplace listing copy/assets submission
     - billing
     - advanced admin analytics
     - transcript or broader workspace features
   - Dependency: production-preflight

### Phase 1: App config and environment contract

3. **Task ID: app-config-profiles**
   - Replace localhost-only assumptions in `app-hsmeta.json` with a config-profile pattern that supports:
     - local
     - staging
     - production
   - Confirm redirect URLs, permitted fetch URLs, and distribution/auth shape are environment-safe.
   - Dependency: slice5-scope-contract

4. **Task ID: oauth-origin-hardening**
   - Verify the OAuth install/callback route behavior under non-local origins.
   - Tighten validation around:
     - callback URL generation
     - post-install redirect targets
     - error handling for missing/misconfigured production origins
   - Add focused tests for staging/production-style configuration.
   - Dependency: app-config-profiles

5. **Task ID: deploy-env-contract**
   - Lock the required environment variables and origin semantics for:
     - API base URL
     - OAuth callback URL
     - HubSpot app upload profile
   - Update env docs and any validators as needed.
   - Dependency: oauth-origin-hardening

### Phase 2: Installer and first-run experience

6. **Task ID: install-success-error-ux**
   - Review the installer journey:
     - OAuth install success
     - OAuth install failure
     - tenant created but still unconfigured
   - Tighten copy and UX so the next action is clear.
   - Dependency: oauth-origin-hardening

7. **Task ID: first-run-settings-guidance**
   - Make the first-run path cohesive from install → settings → working card.
   - Ensure the company-record `unconfigured` guidance matches the actual supported setup path.
   - Add regression coverage if the UX changes materially.
   - Dependency: install-success-error-ux

### Phase 3: Pilot validation and operational readiness

8. **Task ID: two-portal-pilot-validation**
   - Build a repeatable validation flow for at least two portals:
     - install
     - configure
     - load company-record card
     - verify tenant isolation and correct config usage
   - Prefer scripted or checklist-backed verification over one-off manual memory.
   - Dependency: first-run-settings-guidance

9. **Task ID: upload-deploy-runbook**
   - Document the production/staging deployment and HubSpot upload path:
     - build/bundle
     - upload
     - deploy
     - env setup
     - rollback notes if needed
   - Dependency: deploy-env-contract

10. **Task ID: doc-stack-cleanup**
    - Clean stale or misleading planning/doc references that would confuse a future implementation pass.
    - At minimum, reconcile:
      - `PLANNING_INDEX.md`
      - `README.md`
      - any local mirrors that still imply local-only or pre-Slice-5 assumptions
    - Dependency: upload-deploy-runbook

### Phase 4: Validation and merge prep

11. **Task ID: security-audit-slice5**
    - Audit the production/pilot path for:
      - bad redirect handling
      - origin misconfiguration
      - secret leakage in onboarding/deploy docs
      - multi-portal install correctness
    - PASS/FAIL per area.
    - Dependency: two-portal-pilot-validation

12. **Task ID: code-review-slice5**
    - Review the slice with focus on:
      - environment drift bugs
      - install flow regressions
      - documentation correctness
      - deploy/runbook accuracy
    - Fix only real findings.
    - Dependency: security-audit-slice5

13. **Task ID: validate-all-slice5**
    - Run final validation:
      - `pnpm install --frozen-lockfile`
      - `pnpm lint`
      - `pnpm test`
      - `pnpm typecheck`
      - `pnpm db:migrate`
      - upload/bundle validation commands relevant to this slice
    - Final acceptance:
      - no localhost-only production assumptions remain in the shipped app config
      - pilot install flow is documented and repeatable
      - docs point to the correct active sources
    - Dependency: code-review-slice5

## Acceptance Criteria

- The app config no longer assumes `http://localhost:3000/oauth/callback` as the only meaningful OAuth callback path.
- Environment/profile handling is clear for local, staging, and production.
- OAuth install/callback behavior is verified for non-local deployment assumptions.
- A two-portal pilot walkthrough exists and is specific enough to repeat reliably.
- The first-run path from install → configure → working company-record card is coherent and documented.
- Deployment/upload steps are documented clearly enough for a real pilot.
- Documentation no longer points contributors at obviously stale planning paths for active implementation work.
- Final validation passes:
  - `pnpm lint`
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm db:migrate`

## Team Orchestration

- Planning can be done on `main` with no new worktree.
- Implementation should use a fresh Slice 5 branch/worktree off `main` once this plan is approved.
- TDD stays mandatory for any code changes.
- Parallelization opportunities:
  - app-config/env contract work can proceed alongside deploy/runbook drafting after preflight
  - onboarding UX polish can proceed alongside pilot walkthrough drafting once the install contract is stable
- Sequential dependencies:
  - preflight must happen before app config hardening
  - app config/origin contract must be stable before pilot validation
  - docs cleanup should happen after the real production contract is settled

### Team Members

- `general-purpose` — **production-contract**
  - owns app config, env contract, OAuth origin hardening
- `general-purpose` — **installer-experience**
  - owns install/onboarding/first-run UX polish
- `general-purpose` — **pilot-ops**
  - owns two-portal walkthrough, upload/deploy runbook, and rollout documentation
- `quality-engineer`
  - owns security audit, final validation, and acceptance signoff
