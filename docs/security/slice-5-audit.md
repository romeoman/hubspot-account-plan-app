# Slice 5 Security Audit

Date: 2026-04-17

Scope: production and marketplace readiness for the OAuth install path, HubSpot
profile contract, extension API origins, and deploy-time environment handling.

## Verdict

- OAuth redirect handling: PASS
- Post-install return URL handling: PASS
- HubSpot profile and upload contract: PASS
- Secrets and environment docs: PASS
- Local development fetch contract: PASS

## Notes

### OAuth redirect handling — PASS

- `packages/config/src/env.ts` now resolves `HUBSPOT_OAUTH_REDIRECT_URI`
  through `resolveHubSpotOAuthRedirectUri()`.
- Production refuses to fall back to localhost when
  `HUBSPOT_OAUTH_REDIRECT_URI` is unset.
- Non-localhost `http://` redirect URIs are rejected.
- `apps/api/src/index.ts` now uses the resolver directly instead of a silent
  localhost fallback.
- `apps/api/src/lib/oauth.ts` rejects invalid non-HTTPS authorize redirect
  URIs before building the HubSpot install URL.

### Post-install return URL handling — PASS

- `apps/api/src/routes/oauth.ts` still validates HubSpot-provided `returnUrl`
  values against HubSpot-owned domains before redirecting.
- Invalid or missing `returnUrl` values fall back to a local success page
  rather than redirecting to arbitrary destinations.

### HubSpot profile and upload contract — PASS

- `apps/hubspot-project/src/app/app-hsmeta.json` now uses profile variables for
  `redirectUrls` and `permittedUrls.fetch`.
- `scripts/hs-project-upload.ts` requires an explicit `--profile` so uploads
  cannot silently use the wrong config.
- Committed profile templates exist for local, staging, and production.

### Secrets and environment docs — PASS

- `.env.example` documents staging and production callback expectations without
  introducing plaintext secrets.
- `docs/runbooks/production-deploy.md` and `docs/qa/slice-5-pilot-walkthrough.md`
  align on the required environment variables and deployed-origin checks.

### Local development fetch contract — PASS

- HubSpot's current UI extension docs require `hubspot.fetch()` URLs to stay
  HTTPS and forbid `localhost`.
- Slice 5 originally documented running the local API without shipping the
  corresponding local proxy contract.
- This is now fixed by shipping `apps/hubspot-project/local.json.example`,
  ignoring real `local.json`, and documenting the required proxy setup in
  `README.md` and `apps/hubspot-project/UPLOAD.md`.

## Residual accepted risk

- The local proxy contract is a development-only convenience path. Production
  installs still depend on real HTTPS origins and matching deploy-time
  callback configuration.
