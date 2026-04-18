# Plan: Slice 10 — Wire profile-aware API origin into the real HubSpot upload flow

## Task Description

Today `scripts/hs-project-upload.ts --profile <name>` is the only path that actually ships the extension to HubSpot. That script calls `scripts/bundle-hubspot-card.ts`, which builds two separate bundles (`card` + `settings`) via a programmatic `vite.build({ configFile: false, ... })` call. Because `configFile: false` bypasses `apps/hubspot-extension/vite.config.ts`, the Slice 8 `define: { __HAP_API_ORIGIN__ }` block is never applied during real uploads. The Slice 9 `build:with-profile` wrapper is also not reached, because the upload script does not call it. The deployed extension therefore always resolves `API_ORIGIN` to the hardcoded `DEFAULT_API_BASE_URL` fallback, regardless of which `--profile` flag is passed.

Slice 10 closes that gap. The upload wrapper must extract the selected profile's `API_ORIGIN` via the Slice 9 helpers and thread it into the programmatic bundler so both the card and settings bundles embed the correct origin at build time.

## Objective

Invoking the upload runner with `--profile staging` produces card and settings bundles in which `__HAP_API_ORIGIN__` is the staging origin declared in `hsprofile.staging.json`, deterministically and with no manual env export. In automated verification this uses the existing `UploadDeps` seam to stub the final `hs project upload` subprocess while still exercising the real bundler.

## Problem Statement

- Slice 8 proved `vite.config.ts` emits the correct `define`, but only when `vite build` uses that config file.
- Slice 9 proved `build:with-profile` reads the profile and sets `API_ORIGIN`, but the real upload does not call it.
- `scripts/bundle-hubspot-card.ts` uses `configFile: false` and its own inline Vite config; it does not emit `define` at all.
- The `--profile` flag passed to the upload script today reaches only the HubSpot CLI, never the bundler.

Net effect: production uploads silently ship with the wrong origin. There is no failing build, no warning, and no runtime signal until the extension calls an unreachable host.

## Solution Approach

Thread the profile's `API_ORIGIN` through the existing upload pipeline with minimum surface area:

1. Extract the profile name from the `--profile` / `-p` argv in `hs-project-upload.ts` via a small pure helper, so parsing behavior is testable without duplicating the current inline validation logic.
2. Reuse the Slice 9 helpers (`resolveProfilePath`, `loadProfile`, `extractApiOrigin`) to read `hsprofile.<name>.json` from `apps/hubspot-project/` and pull out `variables.API_ORIGIN`.
3. Set `process.env.API_ORIGIN` before calling `runBundle(root)`. Restore the prior value in `finally` so the wrapper stays side-effect free.
4. Refactor `scripts/bundle-hubspot-card.ts` to be import-safe for tests: export `bundleTargets` and a pure helper such as `buildViteOptions(target, apiOrigin)`, and guard the CLI entry with `if (import.meta.main)` instead of executing `main()` on import.
5. Add a matching `define: { __HAP_API_ORIGIN__: JSON.stringify(process.env.API_ORIGIN ?? "") }` block to the programmatic `build()` options for each target. This keeps the `configFile: false` structure (needed for the two-bundle `lib` mode) but reproduces the define contract Slice 8 pinned.
6. Surface a clear error if the profile is missing `API_ORIGIN` instead of falling through to the hardcoded default.

This keeps `build:with-profile` as the single-bundle ergonomic wrapper and the upload path as the two-bundle production pipeline, but both now share the same profile-driven origin contract.

## Relevant Files

Use these files to complete the task:

- [scripts/hs-project-upload.ts](scripts/hs-project-upload.ts) — where profile extraction + env handoff are added.
- [scripts/bundle-hubspot-card.ts](scripts/bundle-hubspot-card.ts) — where `define` block for `__HAP_API_ORIGIN__` is added per target.
- [scripts/**tests**/hs-project-upload.test.ts](scripts/__tests__/hs-project-upload.test.ts) — existing DI-style tests; new cases added here.
- [apps/hubspot-extension/scripts/build-with-profile.ts](apps/hubspot-extension/scripts/build-with-profile.ts) — exports `resolveProfilePath`, `loadProfile`, `extractApiOrigin` to reuse. Slice 9 code.
- [apps/hubspot-extension/src/features/snapshot/hooks/api-fetcher.ts](apps/hubspot-extension/src/features/snapshot/hooks/api-fetcher.ts) — consumer of `__HAP_API_ORIGIN__`, unchanged but referenced in acceptance criteria.
- [apps/hubspot-project/hsprofile.staging.example.json](apps/hubspot-project/hsprofile.staging.example.json) — profile shape.
- [apps/hubspot-project/UPLOAD.md](apps/hubspot-project/UPLOAD.md) — update the Slice 5 production contract section.

### New Files

- [scripts/**tests**/bundle-hubspot-card.test.ts](scripts/__tests__/bundle-hubspot-card.test.ts) — pins the `define` contract on the programmatic bundler (JSON-encoded, empty-sentinel-when-unset, verbatim trailing slashes).

### Expected Touch Set

Keep Slice 10 narrow. Expected production-code changes should stay within:

- `scripts/hs-project-upload.ts`
- `scripts/bundle-hubspot-card.ts`
- `apps/hubspot-project/UPLOAD.md`

Expected test changes:

- `scripts/__tests__/hs-project-upload.test.ts`
- `scripts/__tests__/bundle-hubspot-card.test.ts`
- an existing bundle-origin e2e test file, or one new e2e test file if extending is awkward

## Team Orchestration

### Team Members

- Specialist
  - Name: builder-upload-wiring
  - Role: Implement profile extraction in `hs-project-upload.ts`, add `define` block to `bundle-hubspot-card.ts`, add tests. TDD red-green-refactor.
  - Agent Type: backend-engineer
  - Resume: true
- Quality Engineer (Validator)
  - Name: validator
  - Role: Validate completed work against acceptance criteria (read-only inspection mode).
  - Agent Type: quality-engineer
  - Resume: false

## Step by Step Tasks

### 1. Write failing tests for profile-aware upload wrapper

- **Task ID**: test-upload-profile-handoff
- **Depends On**: none
- **Assigned To**: builder-upload-wiring
- **Agent Type**: backend-engineer
- **Parallel**: false
- Extend `scripts/__tests__/hs-project-upload.test.ts` with cases asserting:
  - profile name extracted from `--profile staging`, `--profile=staging`, `-p staging`, and `-p=staging` forms
  - `process.env.API_ORIGIN` is set to the profile's `variables.API_ORIGIN` at the moment `runBundle` is called
  - `process.env.API_ORIGIN` is restored to its prior value after the runner returns (success path)
  - `process.env.API_ORIGIN` is restored even when `runUpload` throws
  - a profile file missing `API_ORIGIN` surfaces `MissingApiOriginError` before any bundling or upload happens
- Watch each test fail for the expected reason. Do NOT write production code yet.

### 2. Write failing test for define contract in programmatic bundler

- **Task ID**: test-bundle-define-contract
- **Depends On**: none
- **Assigned To**: builder-upload-wiring
- **Agent Type**: backend-engineer
- **Parallel**: true (with Task 1)
- Create `scripts/__tests__/bundle-hubspot-card.test.ts`.
- Refactor `bundle-hubspot-card.ts` so importing it in tests does not start a build: export the target list and a `buildViteOptions(target, apiOrigin)` pure helper, and move CLI execution behind `if (import.meta.main)`.
- Parse the `define` block emitted by `bundle-hubspot-card.ts` by importing that pure helper rather than invoking the real build.
- Assert: `JSON.stringify(apiOrigin)` encoding, empty-string sentinel when env unset, trailing slash preservation.

### 3. Implement profile extraction + env handoff in `hs-project-upload.ts`

- **Task ID**: impl-upload-profile-handoff
- **Depends On**: test-upload-profile-handoff
- **Assigned To**: builder-upload-wiring
- **Agent Type**: backend-engineer
- **Parallel**: false
- Add argv parser that returns the profile name (reuse the check already inlined in `buildUploadRunner`).
- Import `resolveProfilePath`, `loadProfile`, `extractApiOrigin` from Slice 9's helper module via a **relative path** (e.g., `../apps/hubspot-extension/scripts/build-with-profile`). The root `tsconfig.json` does not define an `@hap/hubspot-extension/*` alias, so no path-alias import is available. If a shared helper is later extracted into a workspace package, migrate the import then — not as part of Slice 10.
- Before `deps.runBundle(root)`: read profile from `apps/hubspot-project/`, extract `API_ORIGIN`, set `process.env.API_ORIGIN`.
- Wrap the runner body in `try/finally` that restores the prior `API_ORIGIN`.
- Surface `MissingApiOriginError` as a fatal runner error (non-zero exit, clear message).

### 4. Implement define block in `bundle-hubspot-card.ts`

- **Task ID**: impl-bundle-define
- **Depends On**: test-bundle-define-contract
- **Assigned To**: builder-upload-wiring
- **Agent Type**: backend-engineer
- **Parallel**: false
- Add `define: { __HAP_API_ORIGIN__: JSON.stringify(process.env.API_ORIGIN ?? "") }` to the programmatic `build()` call for each target.
- Ensure the module remains import-safe after the refactor: production CLI behavior stays the same when executed directly, but tests can import helpers without side effects.
- Compute the value once at module scope (or inside `buildTarget`), matching the pattern Slice 8 pinned for `vite.config.ts`.
- Keep `configFile: false` — the two-bundle `lib` structure is not changing.

### 5. Update UPLOAD.md production contract

- **Task ID**: doc-upload-contract
- **Depends On**: impl-upload-profile-handoff, impl-bundle-define
- **Assigned To**: builder-upload-wiring
- **Agent Type**: backend-engineer
- **Parallel**: false
- Add a sentence to the `Current Slice 5 production contract` section stating that the upload wrapper now threads `API_ORIGIN` from the selected profile into the programmatic bundler. Reference Slice 10.
- Note the separation: `build:with-profile` = single-bundle dev ergonomic; `hs-project-upload.ts` = production two-bundle path; both now profile-aware.

### 6. End-to-end verification against real bundler

- **Task ID**: e2e-upload-define
- **Depends On**: impl-bundle-define, impl-upload-profile-handoff
- **Assigned To**: builder-upload-wiring
- **Agent Type**: backend-engineer
- **Parallel**: false
- Add an e2e test (or extend the existing `built-bundle-origin.test.ts` pattern) that writes a temp profile, invokes the upload wrapper with `runUpload` stubbed to exit 0, and asserts that the emitted `card/index.js` and `settings/index.js` contain the profile's origin string.
- Stub `makeTempDir` / `runUpload` but run `runBundle` for real so the Vite pipeline is actually exercised.

### 7. Final validation

- **Task ID**: validate-all
- **Depends On**: test-upload-profile-handoff, test-bundle-define-contract, impl-upload-profile-handoff, impl-bundle-define, doc-upload-contract, e2e-upload-define
- **Assigned To**: validator
- **Agent Type**: quality-engineer
- **Parallel**: false
- Run all validation commands below.
- Verify acceptance criteria are met.
- Inspect and report only; do not modify files.

## Acceptance Criteria

- Invoking the upload wrapper with a stubbed `runUpload` (exit 0, no real `hs project upload` call) produces `apps/hubspot-project/src/app/cards/dist/index.js` and `apps/hubspot-project/src/app/settings/dist/index.js` in which the staging `API_ORIGIN` string appears verbatim. No new CLI flag is introduced — stubbing happens in the test harness via the existing `UploadDeps` injection seam.
- A profile file with no `API_ORIGIN` causes the upload wrapper to exit non-zero before any bundling or `hs project upload` subprocess runs.
- `process.env.API_ORIGIN` is not leaked after the runner returns or throws.
- Importing `scripts/bundle-hubspot-card.ts` in tests does not start a real build as a side effect; its CLI behavior only runs when invoked as the entrypoint.
- No changes to `apps/hubspot-extension/vite.config.ts`, `build-with-profile.ts`, or `api-fetcher.ts` — Slice 10 only touches the programmatic bundler + upload wrapper.
- All prior Slice 7/8/9 tests still pass.
- `UPLOAD.md` reflects the new contract.

## Validation Commands

- `pnpm test scripts/__tests__/hs-project-upload.test.ts` — new upload wrapper tests pass.
- `pnpm test scripts/__tests__/bundle-hubspot-card.test.ts` — new define-contract tests pass.
- `pnpm test` — full repo test suite, no regressions.
- `pnpm typecheck` — no TS errors.
- `pnpm lint` — repo lint stays clean.
- Manual end-to-end (after PRs #8, #9, #10 merged): copy `hsprofile.staging.example.json` → `hsprofile.staging.json`, set a sentinel `API_ORIGIN`, then run a tiny `tsx` harness that imports `buildUploadRunner`, stubs `runUpload` to return `0`, and greps the built card and settings bundles for the sentinel.

## Notes

### Branch timing recommendation

**Wait for PR #9 and PR #8 to merge before branching Slice 10.**

Open-PR reality (as of this plan):

- **PR #9** — base `main`, head `feature/slice-8-extension-api-origin-profile` (Slice 8: extension resolver + Vite `define`).
- **PR #8** — base `feature/slice-8-extension-api-origin-profile`, head `feature/slice-9-hubspot-build-wrapper` (Slice 9: `build:with-profile` wrapper). Stacked on #9.
- **PR #10** — base `main`, head `feature/slice-7-lifecycle-webhook-receiver` (Slice 7 lifecycle webhook). Independent — only touches `apps/api/*`.

Reasoning for the wait:

- Slice 10 imports `resolveProfilePath`, `loadProfile`, `extractApiOrigin` from Slice 9's `build-with-profile.ts`. If Slice 10 branches off `main` before #8 merges, those exports don't exist on the base branch and the Slice 10 branch would need to stack on `feature/slice-9-hubspot-build-wrapper` to compile — adding a third layer to the existing stacked pair.
- Slice 10 also adds a `define` block that mirrors the contract Slice 8 pinned in `vite.config.ts`. Keeping both changes on a single base branch simplifies review and keeps the "profile-aware origin" story linear.

Recommended order: merge **#9 first** (brings Slice 8 to `main`), which auto-retargets **#8** onto `main`; merge **#8** next (brings Slice 9 to `main`); then branch Slice 10 from fresh `main`. **#10** can merge in any order — its file surface does not overlap.

If speed matters more than stack depth, Slice 10 could branch off `feature/slice-9-hubspot-build-wrapper` now. But the cost (third stacked PR, auto-retarget churn on every base merge) outweighs the benefit unless there is a real delivery deadline.

### Out of scope for Slice 10

- Subscribing the app to HubSpot's lifecycle webhook (`POST /webhooks/v4/subscriptions`). Queued separately.
- Root `/` → `/oauth/install` redirect. Queued separately.
- Cleaning up stale `SLICE2_TRANSPORT_NOT_WIRED` / `v1UnwiredFetcher` code in `use-snapshot.ts`. Queued separately.
- Retiring the `scripts/hs-project-upload.ts` temp-dir indirection (still required until `@hubspot/cli` handles worktrees).
