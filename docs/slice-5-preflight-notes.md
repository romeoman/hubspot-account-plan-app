# Slice 5 Preflight Notes

Date: 2026-04-17

Purpose: lock the production and marketplace-readiness contract before Slice 5
implementation begins.

## Official docs verified

Primary sources reviewed on 2026-04-17:

- HubSpot: App configuration
  - https://developers.hubspot.com/docs/apps/developer-platform/build-apps/app-configuration
- HubSpot: Manage apps in HubSpot
  - https://developers.hubspot.com/docs/apps/developer-platform/build-apps/manage-apps-in-hubspot
- HubSpot: Working with OAuth
  - https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/working-with-oauth
- HubSpot: Fetching data for UI extensions
  - https://developers.hubspot.com/docs/apps/developer-platform/add-features/ui-extensions/fetching-data
- HubSpot: Build with config profiles
  - https://developers.hubspot.com/docs/developer-tooling/local-development/build-with-config-profiles
- HubSpot: Listing your app
  - https://developers.hubspot.com/docs/apps/developer-platform/list-apps/listing-your-app/listing-your-app

## Verified facts

1. Multi-account installs and marketplace distribution require `distribution:
   "marketplace"` plus `auth.type: "oauth"`. This is already true in the repo's
   `app-hsmeta.json`.
2. Every OAuth app must define at least one `redirectUrls` entry. Production
   redirect URLs must use HTTPS. `http://localhost` is the only allowed
   non-HTTPS exception and is for testing only.
3. HubSpot's app management UI reads the live redirect URLs from the top-level
   `app-hsmeta.json`, and changes take effect after `hs project upload`.
4. Marketplace listing setup uses redirect URLs from app settings as selectable
   install-button URLs. This means localhost-only redirect configuration is not
   enough for a real pilot or listing path.
5. UI extensions may only call URLs that appear in `permittedUrls.fetch`.
   These URLs must be valid HTTPS URLs and cannot be `localhost`.
6. HubSpot supports config profiles and variable substitution in `*-hsmeta.json`
   files. `hs project upload -p <profile>` and `hs project dev -p <profile>`
   apply the selected profile's variables at build time.
7. Config profiles are explicitly suitable for switching redirect URL domains
   between environments.

## Current repo findings

1. `apps/hubspot-project/src/app/app-hsmeta.json` is partially production-ready:
   - good: `distribution: "marketplace"`
   - good: `auth.type: "oauth"`
   - gap: `redirectUrls` is still only `http://localhost:3000/oauth/callback`
2. The app already whitelists deployed HTTPS API origins in
   `permittedUrls.fetch`:
   - `https://hap-signal-workspace.vercel.app`
   - `https://hap-signal-workspace-staging.vercel.app`
3. The frontend snapshot fetcher defaults to the production HTTPS API origin:
   `apps/hubspot-extension/src/features/snapshot/hooks/api-fetcher.ts`
   currently uses `https://hap-signal-workspace.vercel.app`.
4. The API still defaults the OAuth redirect URI to localhost when
   `HUBSPOT_OAUTH_REDIRECT_URI` is unset:
   - `apps/api/src/index.ts`
   - `.env.example`
5. Existing scaffold tests intentionally lock the current dev-localhost redirect
   behavior, so Slice 5 will need to update those tests as part of the config
   contract change.
6. `apps/hubspot-project/UPLOAD.md` already documents the intended end-state:
   `redirectUrls: ["https://<api-origin>/oauth/callback"]`, but the committed
   app config has not caught up yet.

## Resulting Slice 5 decisions

### 1. Slice 5 should use HubSpot config profiles

This is now the preferred implementation path for environment-specific app
config, not ad hoc manual editing.

Reason:

- HubSpot officially supports profile variables in `*-hsmeta.json`
- redirect URLs are a documented profile-variable use case
- the repo already needs local, staging, and production distinctions

### 2. Redirect URLs must stop being localhost-only

Slice 5 should move the app config to a profile-based redirect contract such as:

- local profile → `http://localhost:3000/oauth/callback`
- staging profile → `https://<staging-origin>/oauth/callback`
- production profile → `https://<production-origin>/oauth/callback`

Exact variable names can be chosen during implementation, but the core decision
is locked: the shipped app config cannot remain localhost-only.

### 3. Production readiness is app-config plus API-config work

Changing `app-hsmeta.json` alone is not sufficient. Slice 5 must keep these in
sync:

- HubSpot `app-hsmeta.json` redirect URLs
- `permittedUrls.fetch`
- API-side `HUBSPOT_OAUTH_REDIRECT_URI` handling
- deploy/runbook documentation

### 4. Slice 5 remains narrow

This slice is limited to:

- production/staging origin readiness
- OAuth callback and install-flow hardening
- first-run onboarding guidance
- two-portal pilot validation
- deploy/runbook and doc-stack cleanup

This slice does NOT introduce:

- a new end-user product surface
- billing
- marketplace listing assets/copy submission
- broader admin analytics

## Acceptance gate for implementation

Slice 5 implementation may proceed with these invariants:

1. We will use HubSpot config profiles for environment-specific app config.
2. We will remove the localhost-only assumption from the shipped OAuth app
   configuration.
3. We will keep `permittedUrls.fetch` aligned with actual deployed HTTPS API
   origins.
4. We will treat production readiness as both code and documentation work.
5. We will keep the wedge unchanged and avoid adding unrelated product scope.
