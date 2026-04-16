# Production Deploy Runbook

Date: 2026-04-17

Purpose: define the minimum repeatable deployment and HubSpot upload path for
Slice 5 production readiness.

## 1. Prepare environment

Set deploy-time environment variables for the API:

- `DATABASE_URL`
- `HUBSPOT_CLIENT_ID`
- `HUBSPOT_CLIENT_SECRET`
- `ROOT_KEK`
- `HUBSPOT_OAUTH_REDIRECT_URI`

Production/staging note:

- `HUBSPOT_OAUTH_REDIRECT_URI` must be HTTPS
- do not allow the API to rely on localhost fallback outside local development

## 2. Verify local repo state

Run:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm typecheck
pnpm db:migrate
```

## 3. Build and upload the HubSpot project

Create or update the real HubSpot profile file for the target environment:

- `apps/hubspot-project/hsprofile.staging.json`
- or `apps/hubspot-project/hsprofile.production.json`

Then upload:

```bash
pnpm tsx scripts/hs-project-upload.ts --profile staging
```

or

```bash
pnpm tsx scripts/hs-project-upload.ts --profile production
```

The upload wrapper will:

1. bundle the card and settings page
2. copy `apps/hubspot-project/` to a temp directory
3. run `hs project upload` from outside the git worktree

## 4. Deploy the API

Deploy the API to the matching environment and confirm:

- the deployed origin matches `API_ORIGIN` in the selected HubSpot profile
- the deployed callback matches `HUBSPOT_OAUTH_REDIRECT_URI`

## 5. Post-deploy smoke checks

1. Open the app install URL.
2. Complete OAuth in the target portal.
3. Confirm the callback returns to the correct HTTPS origin.
4. Open the app Settings page and save valid config.
5. Open a company record and confirm the card loads successfully.

## 6. Rollback guidance

If the deploy is unhealthy:

1. revert the API deployment to the last known-good release
2. confirm the previous HTTPS callback is still valid
3. if needed, re-upload the HubSpot project with the prior stable profile values
4. repeat the smoke checks
