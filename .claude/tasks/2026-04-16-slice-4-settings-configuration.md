# Plan: Slice 4 - Tenant Settings and Configuration UX

## Task Description

Slice 4 adds the first tenant-facing configuration surface to the product.
After Slice 3, the app is installable, multi-tenant, OAuth-backed, RLS-hardened,
and capable of serving real signal + LLM results. The remaining product gap is
that tenants still cannot configure their own provider credentials, model
selection, thresholds, or eligibility property from inside the app.

Today the product handles missing config safely by returning
`eligibilityState: "unconfigured"` and rendering `UnconfiguredState`, but that
state is a dead end. The database schema, encryption layer, config resolver,
RLS wiring, and tenant model already exist:

- `provider_config` and `llm_config` support per-tenant config rows
- `tenants.settings` exists for tenant-level settings
- encrypted key storage already exists for `api_key_encrypted`
- request-scoped tenant DB handles already exist after Slice 3
- HubSpot’s latest developer platform supports a React-based `settings`
  extension for installed apps

Slice 4 turns those backend primitives into a real settings product surface:

1. a HubSpot app `settings` extension UI
2. tenant-scoped settings read/write APIs
3. encrypted provider/LLM key management
4. actionable UX from the current `unconfigured` state
5. guardrails so no secret leaks to the client and no cross-tenant mutation is possible

The plan should preserve the locked wedge. This is not a broad admin console or
dashboard. It is the minimum self-serve configuration plane needed for a tenant
to move from install → configured → live snapshot.

Secret-handling contract for Slice 4:

- settings reads never return plaintext credentials
- settings reads return secret presence only via booleans such as
  `hasApiKey: true | false`
- secret inputs are **replace-only**
- when a user leaves a secret field blank on save, the existing encrypted value
  is preserved
- when a user enters a new value, it replaces the stored encrypted secret
- if explicit secret deletion is needed, it must be a deliberate separate
  action/flag and not an accidental side effect of an empty text field
- no “reveal current key” UX is in scope for Slice 4

## Objective

When Slice 4 is complete, an installed tenant can open the app’s HubSpot
Settings page, view its current configuration, update provider + LLM settings
for its own workspace only, save encrypted credentials safely, and return to the
company record card with the `unconfigured` state resolved.

## Relevant Files

### Existing files to modify

- `apps/hubspot-project/src/app/app-hsmeta.json`
  - add the HubSpot `settings` feature/config entry for the app settings page
- `apps/hubspot-extension/src/index.tsx`
  - may share extracted UI primitives/patterns with the settings extension
- `apps/hubspot-extension/src/shared/extension-root.tsx`
  - reference for shared extension composition patterns
- `apps/hubspot-extension/package.json`
  - may need scripts/build updates if settings bundling uses the same workspace
- `apps/api/src/index.ts`
  - mount tenant settings routes under the existing middleware chain
- `apps/api/src/middleware/tenant.ts`
  - reuse existing tenant resolution contract for settings APIs
- `apps/api/src/lib/config-resolver.ts`
  - keep read models aligned with new write/update paths; add targeted invalidation hooks if needed
- `apps/api/src/lib/encryption.ts`
  - reuse envelope encryption for settings writes; no new crypto scheme
- `apps/api/src/routes/snapshot.ts`
  - optionally surface a richer setup hint only if it stays wedge-safe
- `apps/hubspot-extension/src/features/snapshot/components/empty-states.tsx`
  - make `UnconfiguredState` actionable without expanding scope
- `packages/db/src/schema/provider-config.ts`
  - confirm shape is sufficient; only evolve if a concrete settings need is missing
- `packages/db/src/schema/llm-config.ts`
  - same as above
- `packages/db/src/schema/tenants.ts`
  - use `settings` only for truly tenant-level values, not provider rows
- `packages/validators/src/snapshot.ts`
  - may need config-related runtime schema additions if settings APIs share validated DTOs
- `docs/security/SECURITY.md`
  - add Slice 4 settings-specific secret-handling and authorization notes
- `CLAUDE.md`
  - update active doc references only if the slice introduces a new binding planning artifact

### New files

- `apps/hubspot-project/src/app/settings/settings-hsmeta.json`
  - HubSpot settings extension metadata
- `apps/hubspot-extension/src/settings/index.tsx`
  - local-dev/test entrypoint for the settings extension
- `apps/hubspot-extension/src/settings/settings-entry.tsx`
  - dedicated entry for bundling/exporting the settings surface
- `apps/hubspot-extension/src/settings/components/settings-root.tsx`
  - top-level settings component
- `apps/hubspot-extension/src/settings/components/provider-settings-form.tsx`
  - signal-provider config form
- `apps/hubspot-extension/src/settings/components/llm-settings-form.tsx`
  - LLM config form
- `apps/hubspot-extension/src/settings/components/eligibility-settings-form.tsx`
  - target-account property / threshold settings
- `apps/hubspot-extension/src/settings/hooks/use-tenant-settings.ts`
  - fetch + save tenant settings
- `apps/hubspot-extension/src/settings/hooks/use-settings-form.ts`
  - local form state and save/reset handling
- `apps/hubspot-extension/src/settings/*.test.tsx`
  - HubSpot settings renderer tests
- `apps/api/src/routes/settings.ts`
  - `GET /api/settings` + `PUT /api/settings` (or split resource routes if cleaner)
- `apps/api/src/routes/__tests__/settings.test.ts`
  - integration coverage for auth, tenant isolation, validation, write behavior
- `apps/api/src/lib/settings-service.ts`
  - read/write orchestration over `provider_config`, `llm_config`, and tenant-level settings
- `apps/api/src/lib/__tests__/settings-service.test.ts`
  - domain/service tests for updates, encryption, partial writes, invalidation
- `packages/validators/src/settings.ts`
  - request/response schemas for tenant settings APIs
- `packages/validators/src/__tests__/settings.test.ts`
  - schema coverage
- `scripts/bundle-hubspot-settings.ts`
  - if settings extension needs the same explicit bundle/copy flow as the record-tab card
- `docs/qa/slice-4-settings-walkthrough.md`
  - installer/admin walkthrough from unconfigured → configured → working card

## Step by Step Tasks

### Phase 0: Preflight and scope lock

1. **Task ID: preflight-settings-docs**
   - Verify current HubSpot settings-extension docs on the latest platform and record the implementation decision in a new preflight note.
   - Confirm whether the settings extension can live in the existing app/project structure without a separate project.
   - Confirm the correct `app-hsmeta` / `settings-hsmeta` shape and local-dev workflow.
   - Dependency: none

2. **Task ID: settings-scope-contract**
   - Lock the initial Slice 4 settings scope so we do not overbuild an admin surface.
   - Recommended V1 scope:
     - signal provider enablement (`exa`, `news`, `hubspot-enrichment`)
     - provider API key input where applicable
     - default LLM provider + model
     - LLM API key input + optional endpoint URL for `custom`
     - thresholds: `freshnessMaxDays`, `minConfidence`
     - eligibility property override (`hs_is_target_account` by default)
   - Explicitly defer:
     - broad team/user management
     - audit history UI
     - secret reveal/download flows
     - multi-workspace admin consoles
   - Dependency: preflight-settings-docs

### Phase 1: API and data contracts

3. **Task ID: settings-api-shapes**
   - Define request/response schemas in `packages/validators`.
   - Keep secrets write-only at the API boundary:
     - responses may include `hasApiKey: boolean`
     - responses must not return plaintext decrypted keys
     - blank secret fields in update payloads must mean “preserve existing key”
       rather than “clear key”
     - explicit key removal, if supported in Slice 4 at all, must use a separate
       boolean/operation and never implicit empty-string semantics
   - Decide the canonical payload shape for:
     - provider settings
     - LLM settings
     - eligibility settings
   - Dependency: settings-scope-contract

4. **Task ID: settings-service**
   - Implement `settings-service` as the single backend orchestration layer for:
     - reading tenant settings from `provider_config`, `llm_config`, and `tenants.settings`
     - upserting config rows
     - encrypting keys before persistence
     - invalidating config resolver cache after writes
     - preserving existing encrypted secrets when the incoming secret field is
       omitted or blank
     - replacing encrypted secrets only when a new plaintext value is supplied
   - Use the request-scoped DB handle created by Slice 3.
   - All writes must stay inside tenant-scoped transaction boundaries.
   - Dependency: settings-api-shapes

5. **Task ID: settings-routes**
   - Add tenant-scoped settings routes to the API.
   - Recommended surface:
     - `GET /api/settings`
     - `PUT /api/settings`
   - Validate payloads with `packages/validators`.
   - Reject malformed provider/model combinations explicitly.
   - Do not accept tenant identifiers from the client body; always derive from middleware context.
   - Dependency: settings-service

6. **Task ID: settings-route-tests**
   - TDD-first route tests for:
     - happy-path read
     - happy-path write
     - partial update
     - secret write-only behavior
      - blank secret field preserves existing encrypted value
      - new secret rotates/replaces existing encrypted value
      - explicit delete path, if supported, clears the secret only when the
        dedicated delete operation is used
      - tenant A cannot read/write tenant B config
      - invalid payloads return 400
      - missing tenant/auth returns 401/403 according to current middleware behavior
   - Dependency: settings-routes

### Phase 2: HubSpot settings extension UI

7. **Task ID: hubspot-settings-scaffold**
   - Add the HubSpot app settings feature to the project config.
   - Create the settings extension metadata file and local UI-extension entrypoint(s).
   - Align with the latest HubSpot settings-page guidance:
     - avoid nested enclosed tabs
     - prefer simple grouped panels/sections
   - Dependency: preflight-settings-docs

8. **Task ID: settings-fetch-hook**
   - Implement a hook for loading and saving tenant settings through the new backend endpoints.
   - Required states:
     - loading
     - loaded
     - saving
     - save success
     - save error
   - Do not cache secrets in a way that leaks them back into rendered UI after save.
   - Dependency: settings-routes

9. **Task ID: settings-forms-ui**
   - Build the minimal settings UI sections:
     - signal provider section
     - LLM section
     - eligibility/thresholds section
   - Use HubSpot UI extension primitives and current repo UI patterns.
   - Keep the interface intentionally narrow and admin-oriented, not decorative.
   - Dependencies: hubspot-settings-scaffold, settings-fetch-hook

10. **Task ID: settings-ui-tests**
    - TDD for the settings UI:
      - initial load
      - empty/unconfigured state
      - save flow
      - field validation/rendering
      - success/error messaging
    - Use HubSpot UI extension testing helpers where applicable.
    - Dependency: settings-forms-ui

### Phase 3: Integrate with current product flow

11. **Task ID: unconfigured-recovery-path**
    - Improve the current `UnconfiguredState` so the user is guided toward setup without blowing out the wedge.
    - Options to evaluate during implementation:
      - concise copy referencing app settings
      - a button/link if the SDK allows opening app settings from the card context
      - fallback plain text instructions if direct navigation is not supported
    - Must stay compliant with current HubSpot SDK capabilities.
    - Dependency: settings-ui-tests

12. **Task ID: config-save-invalidation**
    - After settings writes, ensure the runtime stops serving stale config:
      - invalidate resolver cache
      - verify next snapshot request uses the new settings
    - Add an integration test that proves unconfigured → configured → live route behavior.
    - Dependencies: settings-service, unconfigured-recovery-path

13. **Task ID: secret-hygiene-audit**
    - Review the full settings flow for secret exposure risks:
      - API responses
      - logs
      - test fixtures
      - UI rendered state
    - PASS/FAIL per area, similar to the Slice 3 security audit style.
    - Dependency: config-save-invalidation

### Phase 4: Validation, docs, and rollout prep

14. **Task ID: docs-sweep-slice4**
    - Add/update:
      - settings setup walkthrough
      - security notes for write-only secrets and tenant-scoped config mutation
      - any HubSpot upload/bundling docs if the settings extension changes packaging flow
    - Remove stale “not configured yet” assumptions from docs where Slice 4 supersedes them.
    - Dependency: secret-hygiene-audit

15. **Task ID: code-review-slice4**
    - Independent code review pass focused on:
      - tenant isolation
      - secret handling
      - SDK correctness for HubSpot settings
      - regressions in snapshot flow
    - Fix only real findings.
    - Dependency: docs-sweep-slice4

16. **Task ID: validate-all-slice4**
    - Final validation commands:
      - `pnpm install --frozen-lockfile`
      - `pnpm lint`
      - `pnpm test`
      - `pnpm typecheck`
      - `pnpm db:migrate`
      - any settings bundling/upload validation command introduced by the slice
    - Final acceptance verification:
      - tenant can configure the app without direct DB edits
      - configured tenant stops receiving `unconfigured`
      - secrets are never returned in plaintext
      - cross-tenant writes remain impossible
    - Dependency: code-review-slice4

## Acceptance Criteria

- The HubSpot app includes a working `settings` extension on the latest supported platform shape.
- An installed tenant can open app settings and read its current config without direct DB or script intervention.
- A tenant can save provider and LLM configuration for its own workspace only.
- Plaintext secrets are accepted only on write and are never returned by the settings API or rendered back in the UI after save.
- Blank secret fields preserve existing encrypted values; they do not clear them accidentally.
- Secret rotation works by submitting a new plaintext value, and any explicit deletion path is deliberate and separately tested.
- Settings writes use the existing encryption envelope and tenant-scoped DB transaction/RLS path.
- `config-resolver` cache invalidation occurs after writes, and a newly configured tenant can successfully move from `eligibilityState: "unconfigured"` to a live snapshot path.
- Cross-tenant tests prove tenant A cannot read or mutate tenant B settings.
- Validation passes:
  - `pnpm lint`
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm db:migrate`
- Documentation is updated for:
  - tenant/admin setup flow
  - secret handling rules
  - any new HubSpot project upload/bundle steps

## Team Orchestration

- This slice should be executed from a fresh worktree off `main` after the plan is approved.
- Execution should remain TDD-first per repo rules: failing test, confirm failure, minimal implementation, focused rerun, broader verification.
- Parallelization opportunities:
  - backend contract/service work can begin in parallel with HubSpot settings-extension scaffold after preflight is done
  - docs can start once route/UI shapes stabilize
- Sequential dependencies:
  - settings API shapes must be locked before frontend save/load hooks
  - backend write path must exist before meaningful settings UI behavior testing
  - unconfigured recovery UX should be finalized only after the settings extension contract is confirmed
- Taskmaster should be updated before implementation begins so Slice 4 becomes the execution board rather than relying on the now-complete root task set.
- Use Context7 / official HubSpot docs for any settings-extension API uncertainty before implementation.

### Team Members

- `general-purpose` — **lead-backend-settings**
  - Owns API shape, settings service, route wiring, encryption integration, and cache invalidation.
- `general-purpose` — **lead-frontend-settings**
  - Owns HubSpot settings extension scaffold, settings UI, hooks, and unconfigured recovery UX.
- `general-purpose` — **integration-hardening**
  - Owns cross-surface integration tests, route/UI regression coverage, and final wiring verification.
- `quality-engineer`
  - Owns security-focused review, validation sweep, and acceptance-criteria signoff.
