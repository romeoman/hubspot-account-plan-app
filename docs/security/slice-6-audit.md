# Slice 6 Security Audit

Date: 2026-04-17

Scope:

- tenant lifecycle state
- uninstall/offboarding behavior
- runtime revocation handling
- reinstall identity safety

## Results

### 1. Stale credential retention

PASS

Why:

- offboarding deletes `tenant_hubspot_oauth`
- refresh-token revocation path also deactivates the tenant and removes the
  OAuth row
- reinstall restores credentials through the normal OAuth callback flow

Residual risk:

- the primary lifecycle source is journal-based, so operational freshness
  still depends on the lifecycle ingestion mechanism being run correctly

### 2. Continued tenant access after uninstall

PASS

Why:

- `tenantMiddleware` rejects inactive tenants with `401 tenant_inactive`
- snapshot route converts mid-request credential revocation into
  `401 tenant_access_revoked`
- settings route is protected by the same tenant middleware

### 3. Reinstall identity drift

PASS

Why:

- reinstall upserts on `tenants.hubspot_portal_id`
- successful reinstall explicitly reactivates the same tenant row
- tests prove the same tenant id is reused after deactivation

### 4. Lifecycle signal verification gaps

PASS with documented limitation

Why:

- Slice 6 does not invent an inbound webhook contract that HubSpot does not
  actually provide for this flow
- the slice locks the authoritative model as hybrid:
  - lifecycle event processing is primary
  - unrecoverable OAuth refresh failure is fallback

Limitation:

- primary lifecycle ingestion is documented but not yet implemented as a live
  journal consumer in this slice checkpoint, so fallback coverage is stronger
  than primary-event automation

### 5. Cross-tenant leakage during transitions

PASS

Why:

- tenant identity remains keyed by `hubspot_portal_id`
- tenant-owned rows remain RLS-protected
- reactivation and deactivation operate on the resolved tenant row, not on
  caller-supplied tenant ids
- reinstall tests verify no duplicate tenant identity is created

## Conclusion

Slice 6 closes the main lifecycle security gaps left after Slice 5:

- revoked credentials no longer linger ambiguously
- uninstalled tenants no longer behave like healthy tenants
- reinstall is repeatable and identity-safe

The remaining gap is operational completeness of the primary HubSpot lifecycle
event ingestion path, not a known isolation or credential-retention flaw in
the implemented runtime behavior.
