# HubSpot Project Upload Workflow

## Quick reference

```bash
pnpm tsx scripts/hs-project-upload.ts
```

That script copies `apps/hubspot-project/` to a temporary directory outside any git worktree, then runs `hs project upload` from there.

## Why this indirection

The HubSpot CLI's project uploader (`@hubspot/cli` 8.4.0) cannot reliably upload from inside a git worktree (`.worktrees/<branch>/`). The bundler reports `The file /app/cards/<entry>.tsx was not found` even when the file is on disk and `hs project validate` passes. The same files upload + build + deploy successfully when copied to a clean temporary directory outside the worktree.

This appears to be a worktree-context issue in the CLI's git-aware file walker, not a misconfiguration on our side. Reproduced consistently:

| Source dir | Outcome |
|---|---|
| `.worktrees/slice-2/apps/hubspot-project/` | upload succeeds; build FAILS (`*.tsx not found`) |
| `/tmp/<copy>/` (no git) | build + deploy succeed |
| `/tmp/<copy>/` (with `git init`) | build + deploy succeed |

The wrapper script removes the worktree variable from the equation.

## Local development

For active card development with hot reload, use:

```bash
cd apps/hubspot-project
CLIENT_SECRET="$HUBSPOT_CLIENT_SECRET" hs project dev
```

`hs project dev` does NOT use the same upload-and-build pipeline as `hs project upload` and works fine from inside the worktree.

## Manual fallback

If the wrapper script breaks, copy and run by hand:

```bash
TMP=$(mktemp -d)
rsync -a --exclude node_modules --exclude '.git*' apps/hubspot-project/ "$TMP/"
cd "$TMP" && hs project upload
```

## Slice 3 follow-up

`@todo Slice 3` — file an issue against `@hubspot/cli` reproducing the worktree upload failure with a minimal repro, and remove this indirection if/when the CLI handles worktrees correctly.
