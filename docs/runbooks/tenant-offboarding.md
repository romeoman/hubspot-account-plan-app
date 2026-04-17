# Tenant Offboarding Runbook

Date: 2026-04-17

Purpose: define the operational path for HubSpot uninstall, OAuth revocation,
tenant deactivation, and reinstall in Slice 6.

## Contract

Slice 6 uses a hybrid lifecycle model:

- primary signal: HubSpot app lifecycle events (`app_install`, `app_uninstall`)
- fallback signal: unrecoverable OAuth refresh failure (`invalid_grant` / revoked refresh token)

Offboarding policy:

- soft-deactivate the tenant
- clear stored HubSpot OAuth credentials
- preserve provider config, LLM config, snapshots, evidence, and people
- reactivate the same tenant identity on reinstall

Hard-delete is out of scope.

## What Offboarding Changes

When a tenant is offboarded:

- `tenants.is_active` is set to `false`
- `tenants.deactivated_at` is set
- `tenants.deactivation_reason` is set
- the `tenant_hubspot_oauth` row is removed
- config caches for the tenant are invalidated

This means:

- `tenantMiddleware` blocks normal API access with `401 tenant_inactive`
- the HubSpot client no longer treats missing OAuth as a generic runtime error
- revoked access discovered mid-request becomes `401 tenant_access_revoked`

## Trigger Paths

### 1. Lifecycle event: `app_uninstall`

Use this when HubSpot lifecycle processing confirms uninstall for a portal.

Expected system action:

- call the lifecycle service with reason `hubspot_app_uninstalled`
- deactivate the tenant
- remove tenant OAuth credentials

Verification:

- `tenants.is_active = false`
- `tenant_hubspot_oauth` row no longer exists
- snapshot/settings requests for that portal return `401`

### 2. Runtime fallback: OAuth refresh failure

Use this when HubSpot refresh fails with an unrecoverable auth error such as
`invalid_grant` or explicit revocation language.

Expected system action:

- HubSpot client deactivates the tenant with reason `oauth_refresh_failed`
- client throws `TenantAccessRevokedError`
- snapshot route returns `401 tenant_access_revoked`

Verification:

- tenant row is inactive
- OAuth row is gone
- card UI shows reconnect guidance instead of a generic error

## Reinstall Flow

Reinstall must reactivate the same tenant row for the same
`hubspot_portal_id`.

Expected behavior:

- existing tenant row is reused
- `is_active` is restored to `true`
- `deactivated_at` and `deactivation_reason` are cleared
- OAuth row is recreated from the fresh install tokens

Verification:

- tenant id before and after reinstall is identical
- exactly one tenant row exists for the portal
- tenant is active after callback success

## Manual Verification Checklist

1. Start from an installed tenant with valid OAuth credentials.
2. Confirm snapshot route succeeds for the portal.
3. Deactivate via lifecycle service or uninstall event path.
4. Confirm:
   - snapshot route returns `401 tenant_inactive`
   - settings route returns `401 tenant_inactive`
   - no `tenant_hubspot_oauth` row remains
5. Simulate refresh-token revocation.
6. Confirm:
   - HubSpot client throws `TenantAccessRevokedError`
   - snapshot route returns `401 tenant_access_revoked`
   - the card shows reconnect guidance
7. Reinstall the app for the same portal.
8. Confirm:
   - original tenant id is reused
   - tenant is active
   - deactivation metadata is cleared
   - snapshot route succeeds again

## Recovery Notes

- If lifecycle processing deactivates the wrong tenant, recover by:
  - restoring the portal mapping only if the `hubspot_portal_id` is confirmed
  - reactivating the tenant
  - re-running OAuth install to restore credentials
- Do not manually recreate `tenant_hubspot_oauth` rows with arbitrary values.
  Use the OAuth install flow.
- Do not hard-delete tenant data as part of normal uninstall recovery.

## Non-Goals

This runbook does not cover:

- billing cancellation
- customer-requested hard-delete
- marketplace listing removal
- analytics/reporting workflows
