# Stack, Hosting, and Test Environment Notes

## Decision summary
- **Vercel CLI** is treated as deployment / preview / environment tooling.
- **Vercel is not the primary data host** for application data in the current plan.
- **Postgres** is the primary data store.
- **Supabase** is allowed as the managed Postgres host / app service layer.
- **HubSpot CLI** is required.

## Why this matters
The project needs both:
1. local/deployment tooling
2. realistic HubSpot test infrastructure

These are separate concerns.

### Vercel CLI role
Use Vercel CLI for:
- deploys
- preview environments
- environment pulls
- project linking
- logs / deployment workflow

Do not treat Vercel as the actual source of stored relational application data in this plan.

### HubSpot CLI role
Use HubSpot CLI for:
- project/app creation
- local extension development (`hs project dev`)
- test account creation
- app upload/install/test workflows
- mock data import into test accounts

## HubSpot test-account requirement
Before meaningful E2E validation, create a separate HubSpot developer/configurable test account and import mock data.

The test data should cover:
- target account (`hs_is_target_account`)
- 0 contacts
- 1 to 2 usable contacts
- 3+ contacts
- strong evidence
- stale state
- degraded state
- low-confidence / weak evidence
- ineligible state

## Docs checked
- Vercel CLI docs: https://vercel.com/docs/cli
- HubSpot configurable test accounts: https://developers.hubspot.com/docs/developer-tooling/local-development/configurable-test-accounts
- HubSpot create app using CLI: https://developers.hubspot.com/docs/apps/developer-platform/build-apps/create-an-app
- HubSpot quickstart / local dev: https://developers.hubspot.com/docs/getting-started/quickstart

## Tenant-owned data and LLM/provider model

### LLM/provider requirement
The app should support tenant-configured LLM providers rather than forcing one shared provider account.

Supported provider categories should include:
- Anthropic
- OpenAI
- Gemini
- OpenRouter
- custom OpenAI-compatible endpoints

Each tenant/workspace should be able to provide its own:
- API keys
- provider choice
- model choice
- thresholds / settings

### Database ownership requirement
Customer data ownership is mandatory.

That means:
- one installed customer should not expose data to another
- app data, caches, logs, config, and provider settings must be tenant-isolated
- Supabase can be a managed default for teams that do not want to host Postgres themselves
- the plan should still preserve clear tenant isolation and customer-owned data boundaries

### Clear platform principle
The system should be understandable as:
- their HubSpot data
- their LLM/API keys
- their app data boundary
- their tenant/workspace configuration

Not a shared operator-visible data pool.
