# Slice 6 Preflight Notes

Date: 2026-04-17

Purpose: lock the install-lifecycle and tenant-offboarding contract before any
Slice 6 implementation begins.

## 1. Verified external inputs

### 1.1 HubSpot app lifecycle events exist

Official HubSpot docs now expose app lifecycle events through the Webhooks
Journal API:

- `subscriptionType: "APP_LIFECYCLE_EVENT"`
- install event type id: `4-1909196`
- uninstall event type id: `4-1916193`

The docs say to create these subscriptions with a **client credentials token**
via `POST /webhooks/v4/subscriptions`, then read lifecycle events from the
journal.

Verified source:

- HubSpot docs: `Webhooks journal and management APIs (BETA)`
  - lines 203-215 in the current public docs snapshot

### 1.2 HubSpot explicitly supports app uninstall by API

HubSpot now documents a public uninstall endpoint:

- `DELETE /appinstalls/v3/external-install`

This endpoint:

- requires an active OAuth access token for the installed account
- uninstalls the app from that customer account
- removes app features from the account
- unsubscribes configured webhooks for that account

Verified sources:

- HubSpot docs: `App Uninstalls / Uninstall app`
- HubSpot changelog: `Public Beta: New API for uninstalling a public app from a HubSpot account`

### 1.3 HubSpot certification guidance implies a token-failure fallback rule

HubSpot marketplace/certification guidance explicitly says:

- apps should refresh OAuth tokens before expiry
- if the app starts receiving `401` errors for 100% of requests and is unable
  to refresh the access token, the app should treat the account as uninstalled
  and stop making requests until the user re-authenticates

This is important because it means lifecycle handling cannot rely only on a
future webhook arriving. Runtime token failure is an officially recommended
signal for lifecycle handling too.

Verified source:

- HubSpot docs: `HubSpot Marketplace certification requirements`

### 1.4 Current HubSpot auth/platform guidance still matches the shipped app

Current authentication docs still confirm:

- OAuth is required for multi-account installs
- `distribution` must be `marketplace` or `private` for OAuth apps
- client credentials tokens are used for app-global management features, and
  the Webhooks Journal API is the current documented example

Verified source:

- HubSpot docs: `Authentication overview`

## 2. Verified repo-local starting point

### 2.1 Current tenant lifecycle model is partial, not explicit

The current `tenants` schema already has:

- `id`
- `hubspot_portal_id`
- `name`
- `is_active`

This means Slice 6 does **not** need to invent lifecycle from nothing.
However:

- `isActive` is now enforced in tenant middleware
- the tenant schema now includes explicit offboarding reason/timestamp metadata
- reinstall/reactivation is now explicit and keyed to the same tenant identity

### 2.2 Current OAuth storage model is still correct

The current token storage model remains:

- `tenant_hubspot_oauth`
- keyed 1:1 by `tenant_id`
- no duplicated `hub_id`
- protected by RLS

This should remain the core credential store in Slice 6.

### 2.3 Current runtime behavior is not yet lifecycle-aware

Current runtime shape:

- `tenantMiddleware()` resolves tenants by `hubspot_portal_id`
- it now rejects inactive/deactivated tenants with a lifecycle-specific `401`
- `HubSpotClient` resolves tokens from `tenant_hubspot_oauth`
- missing tenant OAuth becomes `TenantAccessRevokedError`

So Slice 6 should add explicit lifecycle handling rather than treating token
loss as an incidental backend failure.

## 3. Locked Slice 6 lifecycle-event-source decision

### Decision: hybrid model

Slice 6 should use a **hybrid lifecycle signal model**:

1. **Primary source:** HubSpot app lifecycle events through the Webhooks
   Journal API (`APP_LIFECYCLE_EVENT`, including `app_uninstall`)
2. **Fallback source:** token-failure-driven revocation/uninstall inference
   when:
   - HubSpot API calls start failing with unrecoverable auth errors
   - token refresh fails or becomes impossible
   - continued app activity should stop immediately

### Why this is the right choice

- HubSpot now provides a real lifecycle signal path, so we should use it
- HubSpot certification guidance also explicitly treats unrecoverable auth
  failure as an uninstall/disconnect indicator
- relying on only one of these would be too brittle:
  - webhook-only risks lag or subscription misconfiguration
  - token-failure-only loses the explicit install/uninstall lifecycle signal

## 4. Locked offboarding data policy

### Decision: soft-deactivate tenant, disable OAuth access, preserve app data

Default Slice 6 offboarding policy:

- tenant is **soft-deactivated**
- stored HubSpot OAuth credentials are **cleared or made unusable**
- provider/LLM config and historical app data are **preserved**
- reinstall for the same portal **reactivates the same tenant identity**
- hard-delete is **out of scope** unless a later legal/compliance requirement
  forces it

### Why this is the right choice

- it matches the existing tenant-centric data model better than destructive
  cleanup
- it supports reinstall without identity duplication
- it avoids turning uninstall into irreversible data loss
- it keeps future explicit delete flows available without conflating them with
  normal uninstall

## 5. Implementation implications

### 5.1 Schema/model

Slice 6 should start by evaluating whether the current `tenants.is_active`
column can become the lifecycle backbone, possibly extended with fields like:

- `deactivated_at`
- `deactivation_reason`
- optional OAuth invalidation metadata

The slice should avoid over-modeling until tests prove extra fields are needed.

### 5.2 Runtime guards

After offboarding:

- snapshot route must not behave as if the tenant is still healthy/installed
- settings route must not allow normal mutation under a deactivated tenant
- HubSpot client must stop retrying as if credentials are still valid forever

### 5.3 Reinstall

Reinstall for the same portal should:

- reuse the same tenant row
- restore OAuth access cleanly
- avoid duplicate tenant identity or split lifecycle state

## 6. What Slice 6 will not do

Still out of scope:

- billing
- marketplace listing copy/assets submission
- analytics/admin dashboards
- hard-delete customer data as the default uninstall path

## 7. Recommended task order

Implementation should begin with:

1. `lifecycle-preflight` — complete with this note
2. `slice6-scope-contract` — lock hybrid lifecycle source + soft-deactivate policy
3. `tenant-lifecycle-model`
4. `lifecycle-service`

No route/client implementation should start before the lifecycle source and
offboarding policy are treated as hard decisions.

## 8. Source summary

Verified from official HubSpot docs:

- Webhooks Journal API supports `APP_LIFECYCLE_EVENT` subscriptions and
  `app_install` / `app_uninstall` events
- HubSpot supports `DELETE /appinstalls/v3/external-install` for uninstalling
  an app from a customer account
- marketplace/certification guidance treats unrecoverable OAuth failure as a
  signal to stop treating the account as installed
- client credentials tokens are the documented auth model for Webhooks Journal
  management
