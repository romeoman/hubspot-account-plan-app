# Plan: Slice 11 Dev Operationalization

## Task Description

Slice 11 (lifecycle subscription bootstrap) is merged on `main`. The code path is complete: `getAppAccessToken`, `ensureLifecycleSubscriptions`, the `POST /admin/lifecycle/bootstrap` admin route, and the `pnpm --filter @hap/api lifecycle:bootstrap` script shim all exist and are covered by tests. The operational-readiness audit (2026-04-19) identified two blockers that prevent us from actually exercising Slice 11 end-to-end in dev:

1. **HubSpot app config is missing a webhooks feature component.** `apps/hubspot-project/src/app/app-hsmeta.json` declares `type: "app"` with `auth`, `permittedUrls`, and `support` blocks, but no webhooks feature is declared anywhere under `apps/hubspot-project/src/app/`. On platform `2026.03`, lifecycle webhooks require an explicit webhooks feature component (an `hsmeta.json` under `src/app/webhooks/` or equivalent) that points HubSpot at a target URL. Without it, even after `ensureLifecycleSubscriptions` successfully registers the two APP_LIFECYCLE_EVENT subscriptions at `4-1909196` (install) and `4-1916193` (uninstall), HubSpot has no delivery endpoint recorded for this app and the receiver at `POST /webhooks/hubspot/lifecycle` will never be called.
2. **Local dev env is missing four of the five required env vars.** `HUBSPOT_APP_ID` is set. `HUBSPOT_APP_CLIENT_ID`, `HUBSPOT_APP_CLIENT_SECRET`, `LIFECYCLE_TARGET_URL`, and `INTERNAL_BOOTSTRAP_TOKEN` are all unset. The bootstrap script correctly exits `2` for missing env, so this is a config gap, not a code gap.

This plan is narrow: fix both blockers, run the first dev bootstrap, and verify install + uninstall delivery against the running receiver. No journal/cursor ingestion. No new backend features. No broad platform redesign.

Important execution note: Task 4 is **operator-assisted**. The team can add
the HubSpot project config and docs in-repo, but it cannot invent real dev
HubSpot credentials or a public HTTPS receiver URL. If the required secrets
or reachable dev URL are unavailable, the slice must stop with a truthful
blocker report rather than claiming "operationalized."

## Objective

When this plan completes, a developer can (a) install the app into a dev HubSpot test portal and watch `POST /webhooks/hubspot/lifecycle` receive a real APP_INSTALL event, and (b) uninstall the app and watch the same route receive a real APP_UNINSTALL event — with both events sourced from subscriptions registered by the Slice 11 bootstrap pipeline, delivered to the URL declared in the HubSpot app config.

## Problem Statement

Slice 11 is "code-complete but not operational." The subscription-registration half is shipped, but the app-config half (telling HubSpot _where_ to deliver events) was never connected. The Slice 11 preflight explicitly calls this out in §1: "A subscription does NOT carry a `targetUrl`. Subscriptions are app-global; HubSpot delivers events to the webhook target URL configured in the app itself (via `app-hsmeta.json` webhooks config or the developer UI). Slice 11's `LIFECYCLE_TARGET_URL` env is therefore consumed by the app-config / receiver-mount side, not sent in the subscription body." That coupling was never materialized. The fix is to add the webhooks feature component to the HubSpot project and align its target URL with `LIFECYCLE_TARGET_URL`, then populate the five-env contract and run bootstrap.

## Solution Approach

1. **Verify the exact HubSpot webhooks-feature component shape for platform `2026.03`** against current HubSpot docs before editing project files. Do not guess the schema.
2. **Add the webhooks feature component** to `apps/hubspot-project/src/app/` as a new `hsmeta.json` file (likely `src/app/webhooks/webhooks-hsmeta.json`) pointing at `${API_ORIGIN}/webhooks/hubspot/lifecycle` (or whatever variable the existing profile system uses).
3. **Verify URL contract consistency**: the webhooks-feature target URL and `LIFECYCLE_TARGET_URL` env must resolve to the same HTTPS URL for any given environment. This is asserted operationally, not in code.
4. **Update the dev-setup docs** with the exact env vars, secret sources, and copy-paste commands.
5. **Run the first dev bootstrap** and capture the JSON report.
6. **Install the app into a dev HubSpot test portal** and watch the install webhook arrive.
7. **Uninstall and watch the uninstall webhook arrive.**
8. **Do not modify the Slice 7 receiver.** Do not modify `apps/api/src/routes/lifecycle.ts`, `apps/api/src/lib/tenant-lifecycle.ts`, the Slice 6 fallback, or the Slice 11 subscription-bootstrap service. This plan is config + docs + live verification only.

## Relevant Files

- `apps/hubspot-project/src/app/app-hsmeta.json` — existing app config (auth + permittedUrls). Currently no webhooks feature. **Do not** shove webhooks inline into this file unless preflight confirms 2026.03 supports it; prefer a sibling component file.
- `apps/hubspot-project/hsproject.json` — declares `"platformVersion": "2026.03"`, which governs the feature-component schema.
- `apps/hubspot-project/hsprofile.local.example.json` — existing profile shape, uses `${OAUTH_REDIRECT_URI}` and `${API_ORIGIN}` variable substitution; the webhooks feature should use the same substitution style.
- `apps/hubspot-project/UPLOAD.md` — source of truth for the actual HubSpot
  project upload workflow in this repo. `apps/hubspot-project/` is not a
  workspace package; do not assume `pnpm --filter @hap/hubspot-project ...`
  exists.
- `apps/hubspot-project/src/app/cards/card-hsmeta.json` and `apps/hubspot-project/src/app/settings/settings-hsmeta.json` — existing feature-component files, useful as shape references for the new webhooks component.
- `apps/api/src/routes/lifecycle.ts` — Slice 7 receiver. **Do not modify.** Read-only reference for the receiver mount path.
- `apps/api/src/routes/admin/lifecycle-bootstrap.ts` — Slice 11 admin route. **Do not modify.** Read-only reference for the admin contract.
- `apps/api/scripts/lifecycle-bootstrap.ts` — CLI shim. **Do not modify.** Entry point for the first dev bootstrap run.
- `apps/api/src/lib/hubspot-subscription-bootstrap.ts` — **Do not modify.** Reference only.
- `docs/slice-11-preflight-notes.md` — §1 and §7 lock the contract. Reference only.
- `docs/runbooks/lifecycle-subscription-bootstrap.md` — existing operator runbook. Extend with a dev-quickstart section.

### New Files

- `apps/hubspot-project/src/app/webhooks/webhooks-hsmeta.json` (exact filename to be confirmed in Task 1 from current HubSpot docs) — declares the webhooks feature component, target URL, and any required event subscriptions at the app-config layer.
- `docs/runbooks/slice-11-dev-quickstart.md` — copy-paste dev setup: env vars, where secrets come from, bootstrap command, install/uninstall verification.

Possible tracking/doc updates:

- `PLANNING_INDEX.md` — if this plan remains a binding execution artifact
- `.taskmaster/tasks/tasks.json` — only if live verification succeeds and
  Slice 11 is explicitly advanced from `in_progress` to `done`

## Team Orchestration

- Team lead orchestrates only. No direct edits.
- This slice is small enough to run sequentially; parallelism would only add coordination overhead.

### Team Members

- Preflight Researcher
  - Name: `preflight-webhooks-feature`
  - Role: Verify the exact webhooks feature component schema for HubSpot platform `2026.03` from current docs. Produce a short note with the confirmed filename location, required keys, event-subscription shape (if any at the config layer), and URL-substitution rules. No code changes.
  - Agent Type: `general-purpose`
  - Resume: false
- App Config Builder
  - Name: `builder-app-config`
  - Role: Create the webhooks feature component file under `apps/hubspot-project/src/app/` per the preflight note. Update `permittedUrls.fetch` if the preflight note says it's required. No changes outside `apps/hubspot-project/`.
  - Agent Type: `general-purpose`
  - Resume: false
- Docs Builder
  - Name: `builder-dev-quickstart`
  - Role: Write `docs/runbooks/slice-11-dev-quickstart.md` and extend `docs/runbooks/lifecycle-subscription-bootstrap.md` with a "Dev first run" subsection. No code changes.
  - Agent Type: `general-purpose`
  - Resume: false
- Live Verifier
  - Name: `live-verifier`
  - Role: Guided-operator role. Given the populated env and deployed/tunnelled receiver, run `pnpm --filter @hap/api lifecycle:bootstrap`, capture JSON report, trigger an install in a HubSpot dev test portal, watch the receiver logs for APP_INSTALL delivery, trigger uninstall, watch for APP_UNINSTALL. Produces a verification report. No code changes.
  - Agent Type: `general-purpose`
  - Resume: false
- Quality Engineer (Validator)
  - Name: `validator`
  - Role: Read-only inspection against acceptance criteria. Do not modify files.
  - Agent Type: `quality-engineer`
  - Resume: false

## Step by Step Tasks

### 1. Verify the 2026.03 webhooks feature component schema

- **Task ID**: `preflight-webhooks-feature`
- **Depends On**: none
- **Assigned To**: `preflight-webhooks-feature`
- **Agent Type**: `general-purpose`
- **Parallel**: false
- Fetch current HubSpot developer docs for platform `2026.03` app projects and the webhooks feature component.
- Confirm the exact filename (e.g., `webhooks-hsmeta.json`), its required directory, the required top-level `type`, and the required fields (`targetUrl`, event subscriptions if any).
- Confirm whether lifecycle event ids `4-1909196` and `4-1916193` must also be declared in the webhooks feature component, or whether they are declared only through the subscriptions API that Slice 11 already hits. Two sources of truth on the same event list would be a footgun; resolve it here.
- Confirm `${API_ORIGIN}` variable substitution works inside webhooks components (it works in `app-hsmeta.json` — verify it carries across).
- Output: a short inline note (no file change yet) with filename, directory, required fields, and the answer to "do we need to list event ids in the feature component too, or just in the subscriptions API."

### 2. Add the webhooks feature component

- **Task ID**: `add-webhooks-feature`
- **Depends On**: `preflight-webhooks-feature`
- **Assigned To**: `builder-app-config`
- **Agent Type**: `general-purpose`
- **Parallel**: false
- Create the new webhooks feature component file at the path confirmed in Task 1 (expected: `apps/hubspot-project/src/app/webhooks/webhooks-hsmeta.json`).
- Target URL: `${API_ORIGIN}/webhooks/hubspot/lifecycle` (matches the Slice 7 receiver mount).
- Event subscriptions (if required at this layer per Task 1): `4-1909196` (install) and `4-1916193` (uninstall).
- Do NOT modify `app-hsmeta.json` unless Task 1 explicitly says the webhooks target URL must also be referenced there; `permittedUrls.fetch` already allows `${API_ORIGIN}`, which is sufficient for outbound calls but is unrelated to inbound webhook delivery.
- No changes outside `apps/hubspot-project/src/app/webhooks/` unless Task 1 says otherwise.

### 3. Document the dev setup and verification procedure

- **Task ID**: `dev-quickstart-doc`
- **Depends On**: `add-webhooks-feature`
- **Assigned To**: `builder-dev-quickstart`
- **Agent Type**: `general-purpose`
- **Parallel**: false
- Create `docs/runbooks/slice-11-dev-quickstart.md` with four sections:
  1. **Env contract** — the five vars (`HUBSPOT_APP_ID`, `HUBSPOT_APP_CLIENT_ID`, `HUBSPOT_APP_CLIENT_SECRET`, `LIFECYCLE_TARGET_URL`, `INTERNAL_BOOTSTRAP_TOKEN`), where each value comes from (developer UI auth tab, ngrok/tunnel URL, CSPRNG), and exact shell `.env` snippet with placeholders.
  2. **URL contract rule** — `LIFECYCLE_TARGET_URL` MUST equal the URL HubSpot resolves from the new webhooks feature component. State the rule and how to eyeball it.
  3. **First bootstrap run** — exact command (`pnpm --filter @hap/api lifecycle:bootstrap`), expected JSON report shape (reference `docs/runbooks/lifecycle-subscription-bootstrap.md §3.3`), and interpretation of exit codes 0/1/2/3.
  4. **Install + uninstall verification** — step by step: upload the HubSpot project using the repo's real workflow from `apps/hubspot-project/UPLOAD.md`, install into the dev test portal, watch receiver logs for APP_INSTALL, uninstall, watch for APP_UNINSTALL.
- Append a short "Dev first run" cross-link subsection to `docs/runbooks/lifecycle-subscription-bootstrap.md` pointing at the new quickstart.
- If this plan remains part of the active execution stack, update
  `PLANNING_INDEX.md` to register it.

### 4. Live dev verification

- **Task ID**: `live-verify-install-uninstall`
- **Depends On**: `dev-quickstart-doc`
- **Assigned To**: `live-verifier`
- **Agent Type**: `general-purpose`
- **Parallel**: false
- Populate `.env` per the quickstart. Secrets come from the HubSpot developer UI auth tab for the dev app.
- Stand up the Slice 7 receiver on a public HTTPS URL (ngrok, a Vercel preview, or a dev tunnel) and set `LIFECYCLE_TARGET_URL` to that URL's `/webhooks/hubspot/lifecycle` path.
- If any of `HUBSPOT_APP_CLIENT_ID`, `HUBSPOT_APP_CLIENT_SECRET`,
  `LIFECYCLE_TARGET_URL`, or `INTERNAL_BOOTSTRAP_TOKEN` is unavailable,
  STOP and return a blocker report instead of claiming success.
- Upload the HubSpot project using the repo's real workflow from
  `apps/hubspot-project/UPLOAD.md`:
  `pnpm tsx scripts/hs-project-upload.ts --profile local`
  (or a more specific equivalent only if Task 1 confirms a better current
  HubSpot CLI path for platform `2026.03`).
- Run `pnpm --filter @hap/api lifecycle:bootstrap`. Capture the full JSON
  report. Verify that across `created` and `alreadyPresent`, both event ids
  `4-1909196` and `4-1916193` are covered.
- Re-run the same command. Confirm idempotency: second report shows both event ids as already-present, no duplicate creates, exit 0.
- Install the app into a HubSpot dev test portal. Confirm `POST /webhooks/hubspot/lifecycle` fires with an APP_INSTALL payload. Capture timestamped log line.
- Uninstall. Confirm `POST /webhooks/hubspot/lifecycle` fires with an APP_UNINSTALL payload. Capture timestamped log line.
- Capture the verification evidence (two bootstrap reports + two webhook log
  lines) in the PR description, session report, or non-secret operator notes.
  Do NOT write real tokens, secrets, or environment-specific secret values
  into a checked-in file.

### 5. Validation sweep

- **Task ID**: `validate-all`
- **Depends On**: `preflight-webhooks-feature`, `add-webhooks-feature`, `dev-quickstart-doc`, `live-verify-install-uninstall`
- **Assigned To**: `validator`
- **Agent Type**: `quality-engineer`
- **Parallel**: false
- Read-only inspection. Verify:
  - New webhooks feature component exists at the confirmed path.
  - Target URL in the component matches `LIFECYCLE_TARGET_URL` contract (both point at the Slice 7 receiver route).
  - `apps/api/src/routes/lifecycle.ts` unchanged vs `origin/main`.
  - `apps/api/src/lib/tenant-lifecycle.ts` unchanged vs `origin/main`.
  - `apps/api/src/lib/hubspot-subscription-bootstrap.ts` unchanged vs `origin/main`.
  - `apps/api/src/routes/admin/lifecycle-bootstrap.ts` unchanged vs `origin/main`.
  - No new backend feature code was added under `apps/api/src/`.
  - The two new files are ONLY `apps/hubspot-project/src/app/webhooks/*-hsmeta.json` and `docs/runbooks/slice-11-dev-quickstart.md` (plus the one appended subsection in the existing runbook).
  - `PLANNING_INDEX.md` changed only if this plan was intentionally registered
    as an active execution artifact.
  - `.taskmaster/tasks/tasks.json` changed only if live verification actually
    completed and Slice 11 was marked `done`.
  - Live verification evidence is present (2 bootstrap reports + 2 receiver log lines).
  - No secrets appear in any checked-in file.
- Report pass/fail per criterion. Do not modify files.

## Acceptance Criteria

1. `apps/hubspot-project/src/app/webhooks/webhooks-hsmeta.json` (or the exact filename confirmed by Task 1) exists and matches the 2026.03 schema.
2. That component's target URL resolves to the same HTTPS URL as `LIFECYCLE_TARGET_URL` for the dev environment.
3. `docs/runbooks/slice-11-dev-quickstart.md` exists and covers env setup, bootstrap run, and install/uninstall verification.
4. `docs/runbooks/lifecycle-subscription-bootstrap.md` gained a "Dev first run" cross-link subsection.
5. First live dev bootstrap produced a JSON report where across `created` and
   `alreadyPresent`, both `4-1909196` and `4-1916193` are covered. Exit code 0.
6. A second bootstrap run produced an idempotent report — both event ids `alreadyPresent`, zero new creates. Exit code 0.
7. A live install into the HubSpot dev test portal triggered a real APP_INSTALL delivery to `POST /webhooks/hubspot/lifecycle`. Log line captured with timestamp and portalId.
8. A live uninstall triggered a real APP_UNINSTALL delivery to the same route. Log line captured with timestamp and portalId.
9. No file under `apps/api/src/` was modified by this slice. Confirmed by `git diff --stat origin/main -- apps/api/src/`.
10. No secrets or tokens appear in any checked-in file.
11. If live verification succeeds, Slice 11 tracking state is updated from
    `in_progress` to `done`; if live verification is blocked by missing
    credentials or missing public HTTPS receiver, the plan stops with a
    blocker report and does not falsely mark the slice operationalized.

## Validation Commands

- `git diff --stat origin/main -- apps/api/src/routes/lifecycle.ts apps/api/src/lib/tenant-lifecycle.ts apps/api/src/lib/hubspot-subscription-bootstrap.ts apps/api/src/routes/admin/lifecycle-bootstrap.ts` — must print no changes.
- `git diff --stat origin/main -- apps/api/src/` — must print no changes.
- `ls apps/hubspot-project/src/app/webhooks/` — must list the new webhooks feature component file.
- `pnpm --filter @hap/api lifecycle:bootstrap` — must exit `0` and across
  `created` + `alreadyPresent` cover both event ids.
- `pnpm --filter @hap/api lifecycle:bootstrap` (second run) — must exit `0`, both event ids `alreadyPresent`, zero new creates.
- `pnpm test` — full root test suite must still pass (sanity; no test changes expected).
- `pnpm typecheck` — must pass.
- `pnpm lint` — must pass.
- `grep -rn "CLIENT_SECRET\|INTERNAL_BOOTSTRAP_TOKEN" apps/hubspot-project/ docs/runbooks/slice-11-dev-quickstart.md` — must return no real secret values (only placeholder references like `$HUBSPOT_APP_CLIENT_SECRET`).

## Notes

- **Scope guard — do not reopen**: journal/cursor ingestion, Slice 6 fallback behavior, Slice 7 receiver transport, any tenant-lifecycle logic, any admin-route hardening beyond what already shipped in Slice 11.
- **Secret handling**: no real client secret or internal bootstrap token ever appears in a checked-in file, a doc, or a log line. `.env` is gitignored; the quickstart doc only shows placeholders.
- **Verification-before-completion**: Task 4 is the gate. No "Slice 11 operationalized" claim without the two real-webhook log lines.
- **Truthful blocking**: if the dev HubSpot app credentials, public HTTPS
  receiver URL, or HubSpot project upload path are unavailable, this slice
  may still land the app-config + runbook changes, but it must report
  "not yet operationalized" rather than silently promoting the status.
- **Tunneling for dev**: if the team already uses a specific tunnel (ngrok, Cloudflare tunnel, Vercel preview on a feature branch), the quickstart should document that specific tool, not invent a new one.
- **Platform version alignment**: `hsproject.json` says `2026.03`. Task 1 must verify against that exact version, not an older or newer platform doc.
