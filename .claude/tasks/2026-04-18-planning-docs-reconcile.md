# Plan: Planning-Docs Reconciliation (tracked task docs vs references)

## Task Description

`PLANNING_INDEX.md`, `AGENTS.md`, and newer tracking metadata in active local
branches all cite slice task docs under `.claude/tasks/` as canonical
execution artifacts. Only
ONE of those docs (`2026-04-17-slice-6-install-lifecycle-offboarding.md`) is
actually tracked in git. The rest live in developers' local working trees and
never made it onto `origin/main`. This is because `.gitignore:83` has
`.claude/*` with no exception for `tasks/`, so every task doc must be
force-added to land in the repo. Slice-6 was force-added once; no other slice
followed that precedent.

PR #12 (`chore/post-slice-10-tracking`, metadata-only) extended the same
pattern by adding slice-7 and slice-10 references to `PLANNING_INDEX.md`
without committing the underlying files. Reviewer flagged the drift as
pre-existing, and the user deferred the full reconciliation to this branch.

This task reconciles the references and the tracked files so `origin/main`
tells the truth about what exists today, and so PR #12's already-open metadata
additions become truthful automatically when that PR lands. It also makes the
invariant durable by adding a `.gitignore` exception so future task docs land
without `-f`.

## Objective

When this plan is complete:

1. Every `.claude/tasks/*.md` path referenced by any tracked planning artifact
   on `origin/main` resolves to a tracked file in the same tree.
2. `.gitignore` contains an explicit `!.claude/tasks/` exception so new slice
   task docs land via normal `git add` without force.
3. Slice-7 and Slice-10 task docs are also tracked in this branch so PR #12's
   already-open metadata additions become truthful without amending PR #12.
4. The reconciliation branch contains no product code changes, no runtime
   changes, and no edits to existing PRs in the stack.

## Problem Statement

Repo-truth vs reference-truth is out of sync:

| File                                                     | On disk (dirty main) | Tracked on `origin/main` | Referenced by now vs next                                                                  |
| -------------------------------------------------------- | :------------------: | :----------------------: | ------------------------------------------------------------------------------------------ |
| `2026-04-16-slice-3-phase-3-rls-card-bundling.md`        |         yes          |            no            | `PLANNING_INDEX.md` §2, `AGENTS.md:20` on `origin/main`                                    |
| `2026-04-16-slice-4-settings-configuration.md`           |         yes          |            no            | `PLANNING_INDEX.md` §2 on `origin/main`; newer Taskmaster metadata in local/PR branches    |
| `2026-04-17-slice-5-production-marketplace-readiness.md` |         yes          |            no            | `PLANNING_INDEX.md` §2 on `origin/main`                                                    |
| `2026-04-17-slice-6-install-lifecycle-offboarding.md`    |         yes          |         **yes**          | `PLANNING_INDEX.md` §2 on `origin/main`; newer Taskmaster metadata in local/PR branches    |
| `2026-04-17-slice-7-lifecycle-journal-ingestion.md`      |         yes          |            no            | not referenced on `origin/main` today; referenced by already-open PR #12 metadata updates  |
| `2026-04-17-slice-10-upload-profile-wiring.md`           |         yes          |            no            | not referenced on `origin/main` today; referenced by already-open PR #12 metadata updates  |

Root cause: `.gitignore:83` line `.claude/*` with only three un-ignores
(`settings.json`, `scripts/`, `skills/`). `tasks/` is not un-ignored. Slice-6
was landed with `git add -f`; no other slice was.

Downstream consequences if unfixed:

- Anyone cloning `origin/main` fresh cannot open five of the six slice plans
  cited by their own `PLANNING_INDEX.md`.
- `.taskmaster/tasks/tasks.json` task 18 (slice-4) and task 21 (slice-7)
  cite `details` files that don't exist in the clone.
- `AGENTS.md:20` instructs readers to read `slice-3-phase-3-rls-card-bundling.md`
  first. Fresh clones cannot.

## Solution Approach

**Hybrid: commit the missing task docs + codify the invariant.**

Rationale for rejecting the alternatives:

- **Trim references to slice-6 only** — would force rewriting `AGENTS.md:20`
  and demoting `tasks.json` task details from canonical pointers to inline
  prose. Discards execution history and lies about what the team produced.
- **Commit missing docs with no gitignore change** — fixes this round but
  leaves the same trap for slice-11+. The next slice author hits the silent
  `.gitignore` block and either doesn't notice (docs-drift reappears) or
  force-adds ad-hoc (unprincipled precedent).

The chosen hybrid:

1. Add `!.claude/tasks/` (and `!.claude/tasks/**`) exceptions under the
   existing `.claude/*` block so `git add .claude/tasks/foo.md` works.
2. Commit the three docs required to make current `origin/main` references
   truthful immediately: slices 3, 4, and 5.
3. Commit the two additional docs required to make PR #12's already-open
   metadata additions truthful as soon as that PR lands: slices 7 and 10.
4. Leave `PLANNING_INDEX.md`, `AGENTS.md`, and `tasks.json` content
   **unchanged**. Their references become truthful automatically once the
   files exist.

## Relevant Files

Use these files to complete the task:

- `.gitignore` — add `!.claude/tasks/` and `!.claude/tasks/**` under the
  `# Claude Code` block alongside the existing `!.claude/settings.json`,
  `!.claude/scripts/`, `!.claude/skills/` lines.
- `PLANNING_INDEX.md` — read-only; used to verify reference list matches
  committed files. No edits.
- `AGENTS.md` — read-only; verify slice-3-phase-3 reference is satisfied. No edits.
- `.taskmaster/tasks/tasks.json` — read-only in this branch; verify whether any
  tracked state here references task docs, but do not edit Taskmaster in this
  PR.

### New Files (copy from dirty main working tree at repo root)

Copy these five files from `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/.claude/tasks/` into the worktree's `.claude/tasks/` directory, then commit:

- `.claude/tasks/2026-04-16-slice-3-phase-3-rls-card-bundling.md`
- `.claude/tasks/2026-04-16-slice-4-settings-configuration.md`
- `.claude/tasks/2026-04-17-slice-5-production-marketplace-readiness.md`
- `.claude/tasks/2026-04-17-slice-7-lifecycle-journal-ingestion.md`
- `.claude/tasks/2026-04-17-slice-10-upload-profile-wiring.md`

**Already tracked — do not re-copy:** `2026-04-17-slice-6-install-lifecycle-offboarding.md`.

**This plan file itself:** `.claude/tasks/2026-04-18-planning-docs-reconcile.md` — commit alongside the five above so the reconciliation branch documents its own intent.

## Team Orchestration

Because this is a docs-only, deterministic, no-codegen task with no
contract chain between components, the team is intentionally minimal. One
builder moves files + edits `.gitignore`; one validator confirms the
reconciliation holds.

### Team Members

- Specialist
  - Name: `docs-reconciler`
  - Role: Copy five task docs from dirty main working tree into the worktree, edit `.gitignore`, stage, commit, verify `git ls-files` matches the reference set.
  - Agent Type: `general-purpose`
  - Resume: true
- Quality Engineer (Validator)
  - Name: `reconcile-validator`
  - Role: Validate acceptance criteria in read-only inspection mode: every reference resolves, `.gitignore` exception present, no product code touched.
  - Agent Type: `quality-engineer`
  - Resume: false

## Step by Step Tasks

### 1. Update `.gitignore` to un-ignore `.claude/tasks/`

- **Task ID**: gitignore-exception
- **Depends On**: none
- **Assigned To**: docs-reconciler
- **Agent Type**: general-purpose
- **Parallel**: false
- Under the existing `# Claude Code` block, after the three existing `!` lines, add:
  ```
  !.claude/tasks/
  !.claude/tasks/**
  ```
- Run `git check-ignore -v .claude/tasks/foo.md` and confirm output changes from matching `.claude/*` to matching neither (exit code 1).

### 2. Copy missing task docs into worktree

- **Task ID**: copy-task-docs
- **Depends On**: gitignore-exception
- **Assigned To**: docs-reconciler
- **Agent Type**: general-purpose
- **Parallel**: false
- Copy the five files listed under "New Files" above from `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/.claude/tasks/` to the worktree's `.claude/tasks/` directory.
- Do NOT modify content. Byte-for-byte copy.
- Verify via `ls .claude/tasks/ | sort` that exactly 7 files are present: slices 3, 4, 5, 6, 7, 10, and this reconcile plan.
- In validation notes, distinguish the reason for each group:
  - slices 3/4/5 satisfy current `origin/main` references
  - slices 7/10 pre-seed truth for already-open PR #12

### 3. Stage and commit

- **Task ID**: stage-and-commit
- **Depends On**: copy-task-docs
- **Assigned To**: docs-reconciler
- **Agent Type**: general-purpose
- **Parallel**: false
- `git add .gitignore .claude/tasks/` — should now work without `-f` thanks to the exception.
- Verify `git status --short` shows only these paths (6 new `.claude/tasks/*.md` files + modified `.gitignore`).
- Commit with message:

  ```
  chore(docs): track .claude/tasks/ slice plans referenced by index

  - Add !.claude/tasks/ exception under the .claude/* ignore rule so
    slice task docs land via normal git add going forward.
  - Commit slice-3/4/5 task docs already cited by `origin/main` execution
    docs, plus slice-7/10 task docs needed to make PR #12's metadata
    additions truthful when that PR lands. Slice-6 was already tracked.
  - Add this reconciliation plan so the branch documents its own intent.

  No product code changes.
  ```

### 4. Validate the reconciliation

- **Task ID**: validate-all
- **Depends On**: gitignore-exception, copy-task-docs, stage-and-commit
- **Assigned To**: reconcile-validator
- **Agent Type**: quality-engineer
- **Parallel**: false
- Run all Validation Commands below.
- Confirm every `.claude/tasks/*.md` reference in the tracked planning files on
  this branch resolves to a tracked file.
- Confirm slices 7 and 10 are tracked even though they are not referenced on
  `origin/main` yet, because they are needed to make PR #12 truthful once it
  merges.
- Confirm diff contains no files outside `.gitignore` and `.claude/tasks/`.
- Operate in validation mode: report only, do not modify files.

## Acceptance Criteria

- `git ls-files .claude/tasks/` returns exactly 7 paths: slices 3, 4, 5, 6, 7, 10, and this reconcile plan.
- `git diff --name-only origin/main..HEAD` returns only `.gitignore` and paths under `.claude/tasks/`.
- `git check-ignore .claude/tasks/anything.md` exits 1 (not ignored) after the exception is in place.
- Every path in `grep -oE "\.claude/tasks/[^\"'\`\ ]+\.md" PLANNING_INDEX.md AGENTS.md .taskmaster/tasks/tasks.json` on this branch resolves to a tracked file.
- `git ls-files --error-unmatch .claude/tasks/2026-04-17-slice-7-lifecycle-journal-ingestion.md .claude/tasks/2026-04-17-slice-10-upload-profile-wiring.md` succeeds so PR #12's already-open metadata additions become truthful once it merges.
- No files under `apps/`, `scripts/`, `docs/`, or `packages/` changed.
- Branch is `chore/planning-docs-reconcile` based on `origin/main`.

## Validation Commands

Execute these commands from the worktree root `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/.worktrees/planning-docs-reconcile`:

- `git status --short --branch` — expect clean tree on `chore/planning-docs-reconcile...origin/main` after commit.
- `git diff --name-only origin/main..HEAD` — expect only `.gitignore` + `.claude/tasks/*.md`.
- `git ls-files .claude/tasks/ | sort` — expect 7 entries.
- `git check-ignore -v .claude/tasks/sentinel.md; echo "exit=$?"` — expect exit=1.
- `for f in $(grep -hoE "\.claude/tasks/[^\"'\`\ ]+\.md" PLANNING_INDEX.md AGENTS.md .taskmaster/tasks/tasks.json | sort -u); do printf "%-70s " "$f"; git ls-files --error-unmatch "$f" >/dev/null 2>&1 && echo OK || echo MISSING; done` — expect all OK for the references that exist on this branch today.
- `git ls-files --error-unmatch .claude/tasks/2026-04-17-slice-7-lifecycle-journal-ingestion.md .claude/tasks/2026-04-17-slice-10-upload-profile-wiring.md` — expect success, even though those two are not referenced on `origin/main` yet.
- `git grep -n "\.claude/tasks/" -- ':!*.md' ':!*.json' || true` — sanity check that no code files reference task docs (they shouldn't).

## Notes

- PR #12 (`chore/post-slice-10-tracking`) stays narrow as-is. It does not need amendment — once this reconciliation PR merges, PR #12's PLANNING_INDEX additions become truthful.
- Slice-6 was force-added historically. After the `.gitignore` exception, its tracked status remains correct; no re-add needed.
- This plan deliberately leaves `PLANNING_INDEX.md` content unchanged. Trimming it would be the opposite intervention (reference-truth conforms to repo-truth). We chose the other direction because `AGENTS.md:20` and `tasks.json` treat the missing docs as canonical; silencing the references would degrade those execution artifacts.
- Slice-7 and Slice-10 are included intentionally even though they are not referenced on `origin/main` yet. They are already canonical local slice docs and are referenced by the open metadata-tracking PR #12. Landing them here avoids a second drift window without having to amend PR #12.
- Out of scope: reconciling `docs/superpowers/plans/` references (those files already exist and are tracked — see `PLANNING_INDEX.md` lines 58–60 on `origin/main`).
