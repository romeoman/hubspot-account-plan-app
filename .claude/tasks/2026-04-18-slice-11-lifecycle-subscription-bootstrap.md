# Plan: Slice 11 — HubSpot Lifecycle Subscription Bootstrap

## Task Description

Slice 7 shipped the **webhook receiver transport**: `POST /webhooks/hubspot/lifecycle`
with HMAC `v3` signature verification, event-id mapping for
`4-1909196` (app_install) / `4-1916193` (app_uninstall), and idempotent
delegation to the existing `applyHubSpotLifecycleEvent` service (which itself
came from Slice 6). Source of truth:

- `apps/api/src/routes/lifecycle.ts` — receiver, already live on `main`
- `apps/api/src/lib/tenant-lifecycle.ts` — service, from Slice 6

What is still **not automated** — and what the original Slice 7 plan
(`.claude/tasks/2026-04-17-slice-7-lifecycle-journal-ingestion.md`) documented
but explicitly deferred — is the step **before** the receiver can ever fire:
the HubSpot app must have an `APP_LIFECYCLE_EVENT` **subscription** registered
against it, so that HubSpot actually delivers install/uninstall webhooks to
the receiver URL.

Today, for the primary automation path to work end-to-end, an operator has to
manually go into the HubSpot developer UI and toggle subscriptions. That is a
marketplace-submission blocker and a silent-drift risk: if nobody toggles it,
the receiver is live but never gets called, and the system falls back to the
Slice 6 oauth-failure path as the _only_ signal — exactly the posture Slice 7
was meant to exit.

Slice 11 closes **just that gap**: give the app a small, auditable,
config-driven way to register and verify its lifecycle subscription against
HubSpot using the documented app-level (client-credentials) auth flow. Nothing
more.

## Current Frontier

Discovery performed against `origin/main` at commit `baeaf4a` (Slice 10):

- **Slices 6, 7, 8, 9, 10 are merged.** No open PRs. Worktree cleanup done.
- Verification in this section is against the **git object at `origin/main`**,
  not against any possibly-dirty local root checkout. When local `main`
  drifts, use `git show origin/main:...` as the source of truth for Slice 11
  planning and validation.
- `apps/api/src/routes/lifecycle.ts` exists and is complete — verified:
  - `POST /webhooks/hubspot/lifecycle` mounted outside `/api/*`
  - HMAC v3 verification via `verifyHubSpotSignatureV3`
  - Event-id mapping `4-1909196` → `app_install`, `4-1916193` → `app_uninstall`
  - Unknown portals + unknown event ids → safe no-op with 200 (no retry storm)
- `apps/api/src/lib/tenant-lifecycle.ts` exposes `applyHubSpotLifecycleEvent`
  and the soft-deactivate / reactivate primitives from Slice 6.
- `.taskmaster/tasks/tasks.json` already carries an entry
  `"Slice 11 — Lifecycle Subscription Bootstrap and Journal Automation"` with
  status `pending`, describing the ambiguity this plan resolves: _"whether to
  ship a narrow subscription bootstrap helper first or continue into the
  fuller journal-ingestion/control-plane plan."_
- The original Slice 7 plan
  (`.claude/tasks/2026-04-17-slice-7-lifecycle-journal-ingestion.md`) proposed
  a 13-task superset including `lifecycle-sync-schema`, a journal adapter,
  cursor processor, and uninstall control-plane wrapper. That superset is
  **explicitly the thing Slice 11 narrows.**

## Scope Selection — Three Axes

The originally-scoped "primary lifecycle automation path" has three distinct
axes. Slice 11 ships exactly one.

| Axis                                         | Status                               | Where it lives                         |
| -------------------------------------------- | ------------------------------------ | -------------------------------------- |
| **A. Webhook receiver transport**            | **DONE** (Slice 7)                   | `apps/api/src/routes/lifecycle.ts`     |
| **B. Subscription bootstrap**                | **SLICE 11**                         | new `hubspot-subscription-bootstrap`   |
| **C. Journal ingestion / cursor automation** | **DEFERRED** (queued as later slice) | not in this slice                      |
| **D. Slice 6 oauth-failure fallback**        | **PRESERVED UNCHANGED**              | `apps/api/src/lib/tenant-lifecycle.ts` |

Rationale for this selection:

- **B is the smallest unit that moves the marketplace posture forward** — the
  receiver from A has zero real-world effect until a subscription is
  registered against the app.
- **C is only valuable if B is unreliable or as a reconciliation sweep.**
  HubSpot's documented delivery semantics treat webhooks as the primary
  channel; the journal is the operational backstop. We have D as a stronger
  backstop at the tenant-identity level (oauth revocation is observable
  synchronously from runtime). Therefore C is a low-value add-on right now
  and should not expand Slice 11.
- **D is already a safety net and must not regress.** Any Slice 11 change
  that touches `tenant-lifecycle.ts` is out of scope by construction.

Recommended Slice 11 scope: **B only.** C and A are explicitly not reopened.

## Objective

When Slice 11 is complete:

1. The app can acquire an **app-level access token** via HubSpot's documented
   client-credentials flow (separate from per-tenant OAuth).
2. The app exposes an **operator-only bootstrap entrypoint** that ensures the
   `APP_LIFECYCLE_EVENT` subscription is registered against the correct target
   URL for `app_install` and `app_uninstall`.
3. The bootstrap is **idempotent**: re-running it on an already-subscribed app
   is a safe no-op with clear logs.
4. The bootstrap is **observable**: logs + return payload describe current vs
   desired subscription state.
5. **Slice 6 fallback behavior is preserved unchanged** — oauth-refresh failure
   still soft-deactivates the tenant, so a delayed or misconfigured subscription
   cannot leave a revoked-install tenant active.
6. The operator runbook documents how to run the bootstrap, how to rotate the
   app credentials, and how to roll back.

## Problem Statement

The receiver route from Slice 7 is plumbing with no faucet. Unless a HubSpot
subscription is registered for `APP_LIFECYCLE_EVENT`, no install/uninstall
webhook will ever be delivered, and the primary automation path documented in
`docs/slice-6-preflight-notes.md` stays theoretical. That forces operators to
configure subscriptions by hand in the HubSpot developer UI per environment
(dev / preview / prod), which is error-prone, undiffable, and blocks
marketplace submission posture.

## Solution Approach

Add a narrow **subscription bootstrap** layer with three parts:

1. **App auth client** (`apps/api/src/lib/hubspot-app-auth.ts`)
   Acquire an app-level access token via HubSpot's client-credentials flow,
   using `HUBSPOT_APP_CLIENT_ID` / `HUBSPOT_APP_CLIENT_SECRET` /
   `HUBSPOT_APP_ID` from env. Cache in memory with expiry. Strict tests for
   missing env, token-fetch failure, and expiry handling.

2. **Subscription bootstrap service**
   (`apps/api/src/lib/hubspot-subscription-bootstrap.ts`)
   - List current subscriptions via
     `GET https://api.hubapi.com/webhooks-journal/subscriptions/2026-03`.
   - Compute the desired set from the locked event-id constants in
     `apps/api/src/routes/lifecycle.ts`: `APP_LIFECYCLE_EVENT` for
     `app_install` (`4-1909196`) and `app_uninstall` (`4-1916193`).
   - Diff on `(subscriptionType, eventTypeId)` only. **Correction from
     preflight (2026-03 docs):** HubSpot's subscription API is app-scoped
     and does not accept a per-subscription `targetUrl` or `portalId` in
     the body; the webhook target URL lives in `app-hsmeta.json` / the
     developer-UI webhooks config, NOT on the subscription record.
     Therefore there is no "mismatched target URL" diff case to handle at
     the API level. `LIFECYCLE_TARGET_URL` is kept as a passthrough field
     in the JSON report for operator visual verification at runbook time.
   - Create missing subscriptions via
     `POST .../webhooks-journal/subscriptions/2026-03` with body
     `{ "subscriptionType": "APP_LIFECYCLE_EVENT", "eventTypeId": "..." }`.
   - Return a typed report:
     `{ targetUrl, created: [{ eventTypeId, subscriptionId }], alreadyPresent: [{ eventTypeId, subscriptionId }] }`.

3. **Operator entrypoint**
   (`apps/api/src/routes/admin/lifecycle-bootstrap.ts`)
   - `POST /admin/lifecycle/bootstrap`, mounted OUTSIDE `/api/*`, guarded by
     `X-Internal-Bootstrap-Token` equality against an env-configured shared
     secret using a length-safe constant-time comparison. No public anonymous
     trigger.
   - Wire it to the bootstrap service. Return the typed report as JSON.
   - Leave a script shim (`pnpm --filter @hap/api lifecycle:bootstrap`) that
     calls the same service locally for CI / preview bootstraps without HTTP.

Explicitly **not in Slice 11**:

- Journal polling / cursor checkpointing / reconciliation sweeps
  (queue separately as Slice 12 if ever needed — current webhook-first model
  plus Slice 6 fallback is sufficient for the locked V1 wedge).
- `DELETE /appinstalls/v3/external-install` wrapping
  (still an ops-only capability per Slice 7 preflight notes).
- Any change to `apps/api/src/routes/lifecycle.ts` or `tenant-lifecycle.ts`.

## Relevant Files

Use these files to complete the task:

- `apps/api/src/routes/lifecycle.ts` — **read-only reference** for event-id
  mapping; must not change. Our new subscriptions must target the event ids
  declared in `HUBSPOT_LIFECYCLE_EVENT_IDS`.
- `apps/api/src/lib/tenant-lifecycle.ts` — **read-only reference**; Slice 6
  fallback behavior must keep working.
- `apps/api/src/middleware/hubspot-signature.ts` — reference for HMAC shape
  and the repo's existing length-safe `timingSafeEqual` pattern (no changes).
- `apps/api/src/lib/oauth.ts` — reference for constant-time secret comparison
  shape in auth-sensitive code (no changes).
- `apps/api/src/index.ts` — mount point for the new admin route.
- `apps/api/package.json` — tiny script addition to expose the operator shim
  as `pnpm --filter @hap/api lifecycle:bootstrap`.
- `docs/slice-6-preflight-notes.md` — verified source summary for the
  Webhooks API auth model and lifecycle event ids.
- `docs/phase-6-doc-alignment.md` — confirms soft-deactivate policy stays.
- `.claude/tasks/2026-04-17-slice-7-lifecycle-journal-ingestion.md` — the
  parent plan this slice carves a narrow piece off of.
- `docs/security/SECURITY.md` — update with the new admin route surface and
  the `HUBSPOT_APP_*` env requirements.
- `docs/runbooks/tenant-offboarding.md` — cross-link the new bootstrap
  runbook.
- `.taskmaster/tasks/tasks.json` — Slice 11 task entry already exists;
  update status when work begins.
- `PLANNING_INDEX.md` — register the new plan file.

### New Files

- `apps/api/src/lib/hubspot-app-auth.ts` — client-credentials token client.
- `apps/api/src/lib/__tests__/hubspot-app-auth.test.ts`
- `apps/api/src/lib/hubspot-subscription-bootstrap.ts` — diff + ensure logic.
- `apps/api/src/lib/__tests__/hubspot-subscription-bootstrap.test.ts`
- `apps/api/src/routes/admin/lifecycle-bootstrap.ts` — guarded HTTP entry.
- `apps/api/src/routes/admin/__tests__/lifecycle-bootstrap.test.ts`
- `apps/api/scripts/lifecycle-bootstrap.ts` — local/CI script shim.
- `docs/slice-11-preflight-notes.md` — re-verified HubSpot docs.
- `docs/security/slice-11-audit.md` — security review.
- `docs/runbooks/lifecycle-subscription-bootstrap.md` — operator runbook.

Note: `apps/api/src/routes/admin/` does not need to pre-exist. Creating that
subtree as part of Slice 11 is in scope.

## Implementation Phases

### Phase 1: Foundation

- Re-verify HubSpot Webhooks Subscription management API (endpoints, required
  scopes, client-credentials lifetime, idempotency semantics). Output:
  `docs/slice-11-preflight-notes.md`.
- Lock config contract: exactly which env vars feed the bootstrap
  (`HUBSPOT_APP_ID`, `HUBSPOT_APP_CLIENT_ID`, `HUBSPOT_APP_CLIENT_SECRET`,
  `LIFECYCLE_TARGET_URL`, `INTERNAL_BOOTSTRAP_TOKEN`).
- Write failing tests for `hubspot-app-auth`: missing env, token fetch
  success (mocked `fetch`), token fetch failure, cache hit inside TTL,
  cache miss past TTL.

### Phase 2: Core Implementation

- Implement `hubspot-app-auth.ts` to pass Phase 1 tests.
- Write failing tests for `hubspot-subscription-bootstrap`:
  - all missing → creates two subscriptions
  - partial present → creates missing one only
  - both present → no creates, both reported as `alreadyPresent`
  - list-subscriptions API failure → propagates
  - create-subscription API failure → propagates (previously-created partial
    state visible in the returned report)
  - (NO "mismatched target URL" case — the subscription API is app-scoped and
    does not carry a per-subscription target URL; see Solution Approach.)
- Implement the bootstrap service to pass.
- Write failing tests for the admin route: missing token → 401, bad token
  → 403, valid token → 200 with JSON report, upstream failure → 502.
- Implement the route and mount it in `apps/api/src/index.ts` outside
  `/api/*` and outside tenant middleware.
- Add the script shim that invokes the service with env-provided config and
  prints the report as JSON.

### Phase 3: Integration & Polish

- Runbook: `docs/runbooks/lifecycle-subscription-bootstrap.md` covering
  first-run, rotation of `HUBSPOT_APP_CLIENT_SECRET`, rollback (leaving
  subscriptions in place is safe — they simply deliver to the receiver;
  teardown requires manual HubSpot UI action).
- Security audit note: `docs/security/slice-11-audit.md` — confirms the
  admin route is not public-anonymous, that the internal token is compared
  with constant-time equality, and that we never log `HUBSPOT_APP_CLIENT_SECRET`
  or bearer tokens.
- Update `docs/security/SECURITY.md` with the new env and new route.
- Update `PLANNING_INDEX.md` to include this plan + the preflight note.
- Update the Slice 11 Taskmaster entry with implementation notes as work
  progresses.

## Team Orchestration

- Team lead orchestrates via `Agent` calls with `mode: "bypassPermissions"`
  and a `team_name`. Team lead does not write code.
- Contract chain: preflight → app-auth → bootstrap-service → admin-route +
  runbook/security in parallel → validator.

### Team Members

- Specialist
  - Name: `preflight-researcher`
  - Role: Re-verify HubSpot Webhooks Subscription management API (auth model,
    endpoints, idempotency). Produces `docs/slice-11-preflight-notes.md` and
    the config contract table. Read-only on code.
  - Agent Type: context7-docs-researcher
  - Resume: true

- Specialist
  - Name: `builder-app-auth`
  - Role: Implement `hubspot-app-auth.ts` + tests. Owns
    `apps/api/src/lib/hubspot-app-auth.ts` and its test file only.
  - Agent Type: backend-engineer
  - Resume: true

- Specialist
  - Name: `builder-subscription-bootstrap`
  - Role: Implement the subscription diff/ensure service + tests. Consumes
    the app-auth contract. Owns
    `apps/api/src/lib/hubspot-subscription-bootstrap.ts` and its test file.
  - Agent Type: backend-engineer
  - Resume: true

- Specialist
  - Name: `builder-admin-route`
  - Role: Implement the guarded admin route + script shim + index mount.
    Owns `apps/api/src/routes/admin/lifecycle-bootstrap.ts`,
    `apps/api/scripts/lifecycle-bootstrap.ts`, the route test, and the tiny
    edit to `apps/api/src/index.ts`.
  - Agent Type: backend-engineer
  - Resume: true

- Specialist
  - Name: `security-and-docs`
  - Role: Author runbook, security audit, and SECURITY.md / PLANNING_INDEX.md
    updates. Owns everything under `docs/` relevant to Slice 11.
  - Agent Type: security-auditor
  - Resume: true

- Quality Engineer (Validator)
  - Name: `validator`
  - Role: Validate completed work against acceptance criteria (read-only
    inspection mode). Runs the validation commands. Reports gaps.
  - Agent Type: quality-engineer
  - Resume: false

## Step by Step Tasks

### 1. Slice 11 Preflight

- **Task ID**: `slice11-preflight`
- **Depends On**: none
- **Assigned To**: `preflight-researcher`
- **Agent Type**: context7-docs-researcher
- **Parallel**: false
- Re-verify HubSpot Webhooks **subscription management** endpoints
  (create / list / delete) and required `webhooks` scope on the app token.
- Confirm client-credentials flow details (endpoint, grant type, token
  lifetime, refresh policy).
- Confirm that `APP_LIFECYCLE_EVENT` is the correct subscription type id and
  that `4-1909196` / `4-1916193` are the correct event type ids (cross-check
  with `apps/api/src/routes/lifecycle.ts`).
- Produce `docs/slice-11-preflight-notes.md` including a locked config
  contract listing the exact env vars and their roles.

### 2. App-Level Auth Client

- **Task ID**: `builder-app-auth`
- **Depends On**: `slice11-preflight`
- **Assigned To**: `builder-app-auth`
- **Agent Type**: backend-engineer
- **Parallel**: false
- TDD: write failing tests first under
  `apps/api/src/lib/__tests__/hubspot-app-auth.test.ts` covering missing env,
  success, failure, in-memory cache hit, cache expiry.
- Implement `apps/api/src/lib/hubspot-app-auth.ts` to pass.
- Export `getAppAccessToken()` with a typed return; never log secrets.

### 3. Subscription Bootstrap Service

- **Task ID**: `builder-subscription-bootstrap`
- **Depends On**: `builder-app-auth`
- **Assigned To**: `builder-subscription-bootstrap`
- **Agent Type**: backend-engineer
- **Parallel**: false
- TDD: write failing tests under
  `apps/api/src/lib/__tests__/hubspot-subscription-bootstrap.test.ts`
  covering: (a) all missing → creates two, (b) partial present → creates one,
  (c) both present → `alreadyPresent` × 2, (d) list failure propagates,
  (e) create failure propagates. No "mismatched target URL" case — the
  subscription API is app-scoped and does not carry a target URL; see
  Solution Approach.
- Implement `apps/api/src/lib/hubspot-subscription-bootstrap.ts` exporting
  `ensureLifecycleSubscriptions({ targetUrl }) -> Report`, where `targetUrl`
  is a passthrough into the report only (not sent to HubSpot).
- Diff only on `(subscriptionType, eventTypeId)`.

### 4. Admin Route + Script Shim

- **Task ID**: `builder-admin-route`
- **Depends On**: `builder-subscription-bootstrap`
- **Assigned To**: `builder-admin-route`
- **Agent Type**: backend-engineer
- **Parallel**: false
- TDD: write failing tests under
  `apps/api/src/routes/admin/__tests__/lifecycle-bootstrap.test.ts` for
  missing token / bad token / success / upstream failure.
- Implement `POST /admin/lifecycle/bootstrap` with constant-time token
  comparison using the repo's existing length-safe pattern (`timingSafeEqual`
  guarded for unequal lengths). Mount it in `apps/api/src/index.ts`
  **outside `/api/*`** and outside tenant middleware.
- Implement `apps/api/scripts/lifecycle-bootstrap.ts` as a thin wrapper that
  reads env, calls the service, prints JSON report, exits 0 on success and
  non-zero on any upstream/service failure.
- Add the matching `lifecycle:bootstrap` script entry in
  `apps/api/package.json`.

### 5. Security + Docs (parallel with Task 4's tail)

- **Task ID**: `security-and-docs`
- **Depends On**: `builder-subscription-bootstrap`
- **Assigned To**: `security-and-docs`
- **Agent Type**: security-auditor
- **Parallel**: true (may run alongside Task 4 — different files)
- Write `docs/runbooks/lifecycle-subscription-bootstrap.md`:
  first-run, rotation of `HUBSPOT_APP_CLIENT_SECRET`, rollback, and
  operator verification that `LIFECYCLE_TARGET_URL` in the JSON report
  matches the receiver URL configured in the app's
  `app-hsmeta.json` / developer-UI webhooks config (since HubSpot's
  subscription API is app-scoped and does not carry a per-subscription
  target URL).
- Write `docs/security/slice-11-audit.md`: route exposure, secret handling,
  logging posture, preservation of Slice 6 fallback.
- Update `docs/security/SECURITY.md` with the new admin route and env vars.
- Update `PLANNING_INDEX.md` to register this plan + the preflight note.
- Update `.taskmaster/tasks/tasks.json` Slice 11 entry with implementation
  notes.

### 6. Final Validation

- **Task ID**: `validate-all`
- **Depends On**: `slice11-preflight`, `builder-app-auth`,
  `builder-subscription-bootstrap`, `builder-admin-route`,
  `security-and-docs`
- **Assigned To**: `validator`
- **Agent Type**: quality-engineer
- **Parallel**: false
- Run all validation commands listed below.
- Verify every acceptance criterion.
- Operate in validation mode: inspect and report only, do not modify files.

## Acceptance Criteria

- `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass from the workspace
  root on the Slice 11 branch.
- The three new targeted suites pass:
  - `apps/api/src/lib/__tests__/hubspot-app-auth.test.ts`
  - `apps/api/src/lib/__tests__/hubspot-subscription-bootstrap.test.ts`
  - `apps/api/src/routes/admin/__tests__/lifecycle-bootstrap.test.ts`
- `apps/api/src/routes/lifecycle.ts` and `apps/api/src/lib/tenant-lifecycle.ts`
  are **unchanged** (verified by `git diff` against `main`).
- `getAppAccessToken()` acquires a HubSpot app-level token via
  client-credentials, caches it in memory, and refreshes after expiry.
- `ensureLifecycleSubscriptions({ targetUrl })` is idempotent: re-running on
  an already-subscribed app is a no-op that reports `alreadyPresent` for both
  event types.
- `LIFECYCLE_TARGET_URL` passes through into the JSON report as-is (HubSpot's
  subscription API is app-scoped and does not carry a per-subscription target
  URL, so there is no API-level mismatch case — the runbook handles visual
  verification against `app-hsmeta.json`).
- `POST /admin/lifecycle/bootstrap` rejects requests without the internal
  token (401) and with a wrong token (403), and succeeds with it (200).
- The admin route's token check uses a length-safe constant-time comparison;
  the provided token value is never echoed in logs or error payloads.
- The admin route is **not** mounted under `/api/*`, and does not flow through
  tenant middleware.
- Secrets (`HUBSPOT_APP_CLIENT_SECRET`, bearer tokens,
  `INTERNAL_BOOTSTRAP_TOKEN`) never appear in logs.
- Slice 6 fallback behavior is unchanged: refresh-token revocation still
  soft-deactivates the tenant.
- `docs/slice-11-preflight-notes.md`,
  `docs/runbooks/lifecycle-subscription-bootstrap.md`,
  `docs/security/slice-11-audit.md` exist and are linked from
  `PLANNING_INDEX.md` / `docs/security/SECURITY.md`.

## Validation Commands

Execute these commands to validate the task is complete:

- `pnpm install --frozen-lockfile` — confirm workspace integrity
- `pnpm test apps/api/src/lib/__tests__/hubspot-app-auth.test.ts apps/api/src/lib/__tests__/hubspot-subscription-bootstrap.test.ts apps/api/src/routes/admin/__tests__/lifecycle-bootstrap.test.ts`
  — targeted Slice 11 suites
- `pnpm test` — workspace test suite
- `pnpm typecheck` — workspace typecheck
- `pnpm lint` — workspace lint
- `git diff --stat origin/main -- apps/api/src/routes/lifecycle.ts apps/api/src/lib/tenant-lifecycle.ts`
  — must be empty (0 files changed)
- the idempotency proof comes from the targeted bootstrap-service test above;
  do not leave this slice depending on an optional `--dry-run` CLI surface

## Notes

- **Scope discipline**: do NOT introduce journal polling / cursor tables /
  reconciliation sweeps in this slice. Those belong in a later, explicitly
  separate slice if ever needed. The shipped webhook receiver + Slice 6
  fallback is the locked V1 posture.
- **Tenant isolation**: the bootstrap operates at the **app** level, not the
  tenant level — it has no `tenant_id` scope because subscriptions are a
  property of the HubSpot app itself, not a property of any one installed
  portal. This is deliberate and must be called out in the security audit.
- **Marketplace posture**: completing Slice 11 is a precondition for
  marketplace submission, because HubSpot requires the app to subscribe to
  `APP_LIFECYCLE_EVENT` and prove install/uninstall handling.
- **Runbook**: the bootstrap is operator-invoked on first deploy per
  environment. After that it's idempotent; CI can safely call it on every
  prod deploy as a guardrail.
