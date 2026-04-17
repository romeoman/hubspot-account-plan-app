# HubSpot Project Upload Workflow

## Quick reference

```bash
pnpm tsx scripts/hs-project-upload.ts --profile local
```

That script copies `apps/hubspot-project/` to a temporary directory outside any git worktree, then runs `hs project upload` from there.
An explicit HubSpot config profile is required.

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
cp apps/hubspot-project/local.json.example apps/hubspot-project/local.json
cd apps/hubspot-project
CLIENT_SECRET="$HUBSPOT_CLIENT_SECRET" hs project dev --profile local
```

`hs project dev` does NOT use the same upload-and-build pipeline as `hs project upload` and works fine from inside the worktree.
The `local.json` proxy is required because HubSpot's `hubspot.fetch()` URLs
must stay HTTPS and cannot target `localhost` directly. The proxy remaps the
local profile's `API_ORIGIN` to `http://localhost:3001` only for local
development.

## Config profiles

Slice 5 standardizes HubSpot app configuration through config profiles instead
of hardcoded environment-specific JSON.

Committed templates:

- `apps/hubspot-project/hsprofile.local.example.json`
- `apps/hubspot-project/hsprofile.staging.example.json`
- `apps/hubspot-project/hsprofile.production.example.json`
- `apps/hubspot-project/local.json.example`

Create real local profile files by copying the templates and removing the
`.example` suffix. Real `hsprofile.*.json` files are gitignored because they
contain account IDs and environment-specific values.

The app config now expects these profile variables:

- `OAUTH_REDIRECT_URI`
- `API_ORIGIN`

Example flows:

```bash
cp apps/hubspot-project/hsprofile.local.example.json apps/hubspot-project/hsprofile.local.json
cp apps/hubspot-project/local.json.example apps/hubspot-project/local.json
pnpm tsx scripts/hs-project-upload.ts --profile local
```

```bash
cp apps/hubspot-project/hsprofile.staging.example.json apps/hubspot-project/hsprofile.staging.json
pnpm tsx scripts/hs-project-upload.ts --profile staging
```

## Manual fallback

If the wrapper script breaks, copy and run by hand:

```bash
TMP=$(mktemp -d)
rsync -a --exclude node_modules --exclude '.git*' apps/hubspot-project/ "$TMP/"
cd "$TMP" && hs project upload --profile staging
```

## Slice 3 follow-up

`@todo Slice 3` — file an issue against `@hubspot/cli` reproducing the worktree upload failure with a minimal repro, and remove this indirection if/when the CLI handles worktrees correctly.

## Current Slice 5 production contract

The app is already on the OAuth marketplace model. The remaining production
readiness contract is:

- `app-hsmeta.json` uses profile variables instead of a hardcoded localhost redirect
- the selected HubSpot profile supplies `OAUTH_REDIRECT_URI` and `API_ORIGIN`
- staging/production installs must use HTTPS callback URLs
- the API-side `HUBSPOT_OAUTH_REDIRECT_URI` must match the active deployed origin

See also:

- `docs/slice-5-preflight-notes.md`
- `docs/security/SECURITY.md`
