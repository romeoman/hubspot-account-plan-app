# Slice 7 Plan: HubSpot Lifecycle Journal Ingestion

## Task Description

Implement the primary HubSpot install-lifecycle signal path that Slice 6
documented but intentionally did not automate yet.

Today the system correctly handles lifecycle fallback at runtime:

- revoked refresh tokens soft-deactivate tenants
- inactive tenants are blocked at middleware
- reinstall reactivates the same tenant identity

What is still missing is the primary automation path for HubSpot lifecycle
events themselves. Slice 7 should add the real lifecycle-ingestion/control-plane
path so uninstall/install state does not depend mainly on refresh-token failure.

This slice should stay narrow:

- yes: lifecycle journal ingestion, cursoring, event application, operational
  sync path, verified uninstall/install automation
- no: billing, analytics, broad background-job platform, marketplace asset
  submission, hard-delete data workflows

## Objective

When Slice 7 is complete, the system should be able to:

1. authenticate to the HubSpot lifecycle-management surface using the verified
   app-level auth model
2. ingest lifecycle events from the documented HubSpot journal path
3. apply `app_install` / `app_uninstall` events idempotently to the existing
   tenant lifecycle service
4. checkpoint progress so repeated syncs are safe and resumable
5. keep Slice 6 fallback behavior as the safety net, not the primary mechanism

## Relevant Files

- `apps/api/src/lib/tenant-lifecycle.ts`
- `apps/api/src/lib/hubspot-client.ts`
- `apps/api/src/index.ts`
- `apps/api/src/routes/oauth.ts`
- `apps/api/src/middleware/tenant.ts`
- `apps/api/src/routes/snapshot.ts`
- `packages/db/src/schema/tenants.ts`
- `packages/db/drizzle/`
- `docs/slice-6-preflight-notes.md`
- `docs/security/slice-6-audit.md`
- `docs/runbooks/tenant-offboarding.md`
- `docs/security/SECURITY.md`
- `README.md`

Likely new files:

- `apps/api/src/lib/hubspot-app-auth.ts`
- `apps/api/src/lib/hubspot-lifecycle-journal.ts`
- `apps/api/src/lib/lifecycle-sync.ts`
- `apps/api/src/routes/lifecycle.ts`
- `apps/api/src/lib/__tests__/hubspot-lifecycle-journal.test.ts`
- `apps/api/src/lib/__tests__/lifecycle-sync.test.ts`
- `apps/api/src/routes/__tests__/lifecycle.test.ts`
- `docs/slice-7-preflight-notes.md`
- `docs/security/slice-7-audit.md`
- `docs/runbooks/lifecycle-sync.md`

Possible schema additions:

- a checkpoint/cursor table for journal consumption
- an idempotency/audit table for applied lifecycle events if the docs confirm
  this is needed

## Step by Step Tasks

1. `slice7-preflight`
   - Re-verify the current HubSpot docs for:
     - Webhooks Journal API auth model
     - event paging/checkpoint semantics
     - `APP_LIFECYCLE_EVENT` payload shape
     - install/uninstall event identifiers
     - whether polling, callback delivery, or hybrid is the intended pattern
   - Confirm whether `DELETE /appinstalls/v3/external-install` belongs in scope
     for this slice or remains an ops-only capability.
   - Output: `docs/slice-7-preflight-notes.md`

2. `slice7-scope-contract`
   - Lock the ingestion model explicitly:
     - journal polling only
     - callback + journal reconciliation
     - hybrid
   - Lock cursor semantics:
     - global cursor vs per-subscription cursor
     - replay/idempotency policy
     - operator recovery path when a sync partially fails
   - Lock what happens on unknown lifecycle event types:
     - ignore and log
     - store and surface as audit noise

3. `lifecycle-sync-schema`
   - Add the minimum schema needed for primary lifecycle automation.
   - Likely needs:
     - lifecycle journal cursor/checkpoint state
     - possibly applied-event dedupe/audit storage
   - Keep tenant identity keyed to `tenants.hubspot_portal_id`.
   - Do not duplicate tenant lifecycle state outside `tenants`.

4. `hubspot-app-auth-client`
   - Implement the verified app-level auth/token acquisition flow for lifecycle
     journal access.
   - Keep it separate from tenant-scoped OAuth.
   - Add strict tests for:
     - missing env/config
     - token fetch failures
     - token caching/refresh if needed

5. `journal-adapter`
   - Implement a HubSpot lifecycle journal adapter:
     - fetch page(s) from the journal
     - decode lifecycle events into a local normalized shape
     - carry through portal id, event type, event timestamp, and any cursor
       token needed for the next page
   - This stays behind an adapter boundary, not inline in routes.

6. `lifecycle-processor`
   - Implement a processor that:
     - takes normalized events
     - resolves tenant by `hubspot_portal_id`
     - calls `applyHubSpotLifecycleEvent(...)`
     - records cursor/idempotency state
   - Unknown portals must remain a safe no-op with telemetry.
   - Repeated events must be idempotent.

7. `sync-entrypoint`
   - Add the narrowest operational entrypoint for running lifecycle sync:
     - cron-safe route
     - internal admin route
     - script entrypoint
   - Preflight should decide which is safest for the current deployment model.
   - Protect it appropriately:
     - no public anonymous trigger
     - explicit auth or internal-only execution path

8. `uninstall-control-plane`
   - If Slice 7 preflight confirms it is appropriate, add a thin wrapper around
     HubSpot’s uninstall API for controlled/manual uninstall operations.
   - Keep this clearly separated from tenant-scoped runtime APIs.
   - If docs or product intent say “ops only,” document it and leave code out.

9. `observability-and-recovery`
   - Add stable logs and metrics-like breadcrumbs for:
     - sync start/end
     - cursor advance
     - event application counts
     - unknown portal ids
     - partial failure / replay / retry conditions
   - Add a recovery runbook:
     - rerun sync safely
     - inspect cursor state
     - reconcile a portal manually if needed

10. `docs-and-security`
    - Update:
      - `docs/security/SECURITY.md`
      - `README.md`
      - lifecycle runbooks
      - `PLANNING_INDEX.md` if this slice becomes active execution
    - Add:
      - `docs/security/slice-7-audit.md`
      - `docs/runbooks/lifecycle-sync.md`

11. `security-audit`
    - Audit for:
      - accidental public exposure of sync/uninstall controls
      - cross-tenant lifecycle application
      - replay/idempotency gaps in journal processing
      - cursor corruption / double-apply behavior
      - silent install-state drift

12. `code-review`
    - Push branch
    - run bot review + independent review
    - fix only real findings

13. `validate-all`
    - Run full validation:
      - `pnpm install --frozen-lockfile`
      - `pnpm lint`
      - `pnpm test`
      - `pnpm typecheck`
      - `pnpm db:migrate`

## Acceptance Criteria

- The primary lifecycle path is no longer only documented; it is implemented.
- HubSpot lifecycle journal ingestion can be run safely and repeatedly.
- `app_uninstall` deactivates the correct tenant idempotently.
- `app_install` reactivates the correct tenant idempotently.
- Unknown portals do not cause cross-tenant mutation.
- Cursor/checkpoint state prevents accidental double-application during normal
  reruns.
- Slice 6 fallback behavior still works if journal ingestion is delayed or
  temporarily unavailable.
- The sync/uninstall control plane is not publicly exposed.
- Runbook + security docs explain both the automated path and the manual
  recovery path.

## Team Orchestration

### Team Members

- **Track A — Lifecycle Core**
  - owns schema changes, journal cursor model, event processor, idempotency
  - must keep tenant identity centered on `hubspot_portal_id`

- **Track B — HubSpot App Integration**
  - owns app-level auth, journal adapter, optional uninstall control-plane path
  - must verify docs before implementation and keep tenant OAuth separate from
    app-level auth

- **Track C — Operations + Verification**
  - owns runbooks, security audit, observability, and end-to-end sync tests
  - ensures the slice is operationally understandable, not just code-complete

Suggested execution order:

1. Preflight + scope contract
2. Schema + auth client
3. Journal adapter + processor
4. Sync entrypoint
5. Docs/security/review/validation

Parallelism notes:

- Track A and Track B can move in parallel after preflight locks the auth and
  ingestion model.
- Track C should start once the processor contract is stable, not at the very
  end.
