# Slice 5 Pilot Walkthrough

Date: 2026-04-17

Purpose: provide a repeatable pilot-validation checklist for two-portal install
and configuration testing.

## Goal

Prove that two separate HubSpot portals can:

1. install the app
2. complete settings configuration
3. load the company-record card successfully
4. remain tenant-isolated throughout the flow

## Preconditions

- staging or production API is deployed and reachable over HTTPS
- `HUBSPOT_OAUTH_REDIRECT_URI` matches the deployed API origin
- HubSpot app config has been uploaded with the correct profile:
  - `local`
  - `staging`
  - or `production`
- real `hsprofile.<env>.json` file exists locally for the target environment
- at least two HubSpot portals are available for testing

## Portal A flow

1. Open the app install URL from HubSpot.
2. Choose Portal A.
3. Complete OAuth consent.
4. If HubSpot returns to the app, confirm the install completes without error.
5. Open the app's Settings page in HubSpot.
6. Save valid tenant settings:
   - at least one signal provider enabled
   - required API keys present
   - LLM provider/model configured or intentionally disabled
7. Open a company record that should qualify for the wedge.
8. Confirm the card loads and does not stay in `unconfigured`.

## Portal B flow

Repeat the same steps in Portal B with a different tenant configuration where
possible, for example:

- different enabled signal providers
- different thresholds
- different LLM provider/model

## Validation checklist

- Portal A install succeeds
- Portal B install succeeds
- Portal A settings save succeeds
- Portal B settings save succeeds
- Portal A card loads with Portal A config
- Portal B card loads with Portal B config
- Portal A does not reflect Portal B configuration
- Portal B does not reflect Portal A configuration
- no redirect returns to `localhost` during staging/production testing
- no API call is blocked by `permittedUrls.fetch`

## Failure notes to capture

For every failed pilot run, record:

- environment/profile used
- portal id
- exact install or settings step that failed
- visible error message
- request id / correlation id if available
- whether the failure is config, backend, HubSpot app config, or UX
