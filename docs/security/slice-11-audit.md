# Slice 11 Security Audit — Lifecycle Subscription Bootstrap

Date: 2026-04-18
Scope: Slice 11 subscription-bootstrap surface only (axis B). Axis A (Slice 7
receiver) and axis D (Slice 6 fallback) are preserved unchanged. Axis C
(journal/cursor ingestion) is explicitly out of scope.

Sources:

- Plan: `.claude/tasks/2026-04-18-slice-11-lifecycle-subscription-bootstrap.md`
- Preflight: `docs/slice-11-preflight-notes.md`
- Code under review:
  - `apps/api/src/lib/hubspot-app-auth.ts`
  - `apps/api/src/lib/hubspot-subscription-bootstrap.ts`
  - `apps/api/src/routes/admin/lifecycle-bootstrap.ts`
  - `apps/api/scripts/lifecycle-bootstrap.ts`
- Unchanged (read-only reference):
  - `apps/api/src/routes/lifecycle.ts` (Slice 7 receiver)
  - `apps/api/src/lib/tenant-lifecycle.ts` (Slice 6 service)
  - `apps/api/src/middleware/hubspot-signature.ts` (constant-time pattern)

Verdict: PASS.

## 1. Scope boundaries — explicitly app-level, not tenant-level

The bootstrap operates at the HubSpot **app** level, not the tenant level.
HubSpot's `APP_LIFECYCLE_EVENT` subscription API is app-scoped by design: a
single subscription covers install and uninstall events for every portal that
installs the app. Consequently:

- No code path in Slice 11 reads or writes `tenant_id`.
- No RLS policy is affected. No tenant-scoped table is touched.
- There is no cross-tenant surface added by this slice — there is no
  per-tenant row the bootstrap could leak across boundaries in the first
  place.
- The admin route is mounted OUTSIDE `/api/*` and OUTSIDE
  `tenantMiddleware`. This is deliberate, not an oversight — wrapping an
  app-level operation in tenant middleware would be semantically wrong and
  would require a synthetic tenantId that has no real-world meaning.

This non-regression of tenant isolation is asserted by the shape of the
change itself: no tenant-scoped file in the repo is modified.

## 2. Admin route exposure

- Path: `POST /admin/lifecycle/bootstrap`
- Mounted: OUTSIDE `/api/*`, OUTSIDE tenant middleware.
- Guard: `X-Internal-Bootstrap-Token` header, compared against
  `INTERNAL_BOOTSTRAP_TOKEN` env with a length-safe **constant-time**
  comparison following the `timingSafeEqual` pattern already used in
  `apps/api/src/middleware/hubspot-signature.ts`.
- No anonymous access path. No fallback unauthenticated trigger.
- Response status contract:
  - `503 { error: "bootstrap_not_configured" }` when the server-side env
    is missing the token. This is intentionally distinct from 401/403
    so a missing-env misconfiguration is not conflated with a bad
    client-side header.
  - `401 { error: "missing_internal_token" }` when the header is missing.
  - `403 { error: "invalid_internal_token" }` when the header is present but wrong.
  - `200` with the typed JSON report on success.
  - `502 { error: "upstream_failure", stage, ... }` when HubSpot's
    token / list / create call fails. The stage is safe to surface.

The route does NOT echo the presented token in any log, error message, or
response. The constant-time check avoids leaking token length via timing for
the equal-length branch; the unequal-length branch's timing reveals only the
attacker-supplied length, which the attacker already knows.

## 3. Secret handling

### 3.1 `HUBSPOT_APP_CLIENT_SECRET`

- Read from env by `hubspot-app-auth.ts`.
- Sent only as the `client_secret` form field on
  `POST https://api.hubapi.com/oauth/v1/token` over TLS.
- Never logged. `AppAuthError` carries `stage` and `status` but NOT the
  request body.
- Never echoed in responses.

### 3.2 `INTERNAL_BOOTSTRAP_TOKEN`

- Read from env by the admin route handler only.
- Compared constant-time. Never logged. Never echoed.
- Missing-env returns 503 with a generic message that does not indicate
  whether the client header is correct (the client check never runs if the
  server has no token configured).

### 3.3 HubSpot client-credentials bearer token

- Acquired via client-credentials on `/oauth/v1/token`.
- Kept in an in-memory module cache in `hubspot-app-auth.ts`.
- Cache TTL is `response.expires_in - 60s` as a skew buffer; the code
  trusts `expires_in` rather than hardcoding a lifetime.
- Never logged. Never returned to clients. Never included in any error
  payload. `SubscriptionBootstrapError` carries `stage`, optional `status`,
  and (for creates) `eventTypeId` — not the bearer value.
- Process restart invalidates the cache; there is no persistent token
  storage.

### 3.4 `HUBSPOT_APP_ID` and `LIFECYCLE_TARGET_URL`

Safe to log. Used for correlation and operator-visible reporting.

## 4. Slice 6 fallback preservation

`apps/api/src/lib/tenant-lifecycle.ts` is UNCHANGED by Slice 11. The
oauth-refresh-failure soft-deactivate path still fires at runtime when a
tenant's refresh token is revoked:

- `tenants.is_active = false`
- `deactivation_reason = oauth_refresh_failed`
- tenant OAuth credentials removed
- snapshot route returns `401 tenant_access_revoked`

Security consequence: even if the subscription bootstrap is missed, delayed,
or misconfigured for a given environment, a revoked install cannot leave the
tenant active. The runtime fallback catches it on the next HubSpot-backed
request.

A `git diff --stat origin/main -- apps/api/src/routes/lifecycle.ts apps/api/src/lib/tenant-lifecycle.ts`
must return zero changed files; this is part of the validator's acceptance
criteria.

## 5. Preserved invariants

- `apps/api/src/routes/lifecycle.ts` (Slice 7 receiver) is unchanged.
- HMAC v3 verification (`verifyHubSpotSignatureV3`) is unchanged.
- Event-id mapping (`HUBSPOT_LIFECYCLE_EVENT_IDS` — `4-1909196` app install,
  `4-1916193` app uninstall) is unchanged. The bootstrap service IMPORTS
  these ids from the receiver module rather than re-declaring them, keeping
  receiver and bootstrap in lockstep.
- Signed-request nonce, RLS policies, tenant middleware, encryption envelope,
  and every other Slice 1–10 security surface are untouched.

## 6. Attack surface delta

- +1 HTTP route: `POST /admin/lifecycle/bootstrap` (token-guarded).
- +1 module cache: in-memory HubSpot app-token cache (process-local,
  discarded on restart, never persisted).
- +1 script entrypoint: `pnpm --filter @hap/api lifecycle:bootstrap`.
  Reads env directly; no network surface beyond the token endpoint and the
  subscriptions API.
- 0 new public-anonymous surfaces.
- 0 new cross-tenant surfaces.
- 0 new data-at-rest.
- 0 new cookies or sessions.
- 0 changes to `/api/*` auth, tenant resolution, RLS, or encryption.

## 7. Residual risks and mitigations

### R1 — Operator forgets to run the bootstrap in a new environment

Receiver is live, but HubSpot delivers no events to it. Install and uninstall
drift in tenant state until the Slice 6 oauth-failure backstop triggers on
the next HubSpot-backed request.

Mitigation:

- Runbook §3 documents the first-run step per environment.
- CI can safely invoke the script on every prod deploy as an idempotent
  guardrail (runbook §4).

### R2 — Weak or reused `INTERNAL_BOOTSTRAP_TOKEN`

An attacker who recovers a weak or env-reused token can trigger bootstraps.
Worst case: subscriptions are re-upserted to their existing app-scoped
state. There is no data exfiltration path.

Mitigation:

- Runbook §2 and §6 require a per-environment 32+ byte CSPRNG value.
- The operation itself is idempotent and creates no side effects beyond
  (re-)registering the two app-scoped subscriptions, so impact is bounded.

### R3 — HubSpot rate limit (50 req/s per app) during retry storms

Sequential creates under a retry loop could hit the limit.

Mitigation:

- Bootstrap runs are infrequent (first-run + deploy guardrail).
- Creates are sequential, not parallel.
- Errors are surfaced per `eventTypeId` so the operator can retry only the
  failed one after the rate-limit window (runbook §9).

### R4 — Drifted `LIFECYCLE_TARGET_URL` vs `app-hsmeta.json` webhooks config

HubSpot's subscription API does not carry a per-subscription target URL, so
the bootstrap cannot detect drift programmatically.

Mitigation:

- `LIFECYCLE_TARGET_URL` is passed through into the JSON report.
- Runbook §3.4 makes the visual comparison against the app's webhooks
  config a mandatory first-run step.
- A drifted target URL produces no security leak — the receiver endpoint
  still requires valid HMAC v3 verification against `HUBSPOT_CLIENT_SECRET`
  and a known portal, so a misrouted HubSpot event cannot be spoofed into
  tenant state changes.

### R5 — Log surface of `correlationId`

HubSpot's error payloads include a `correlationId`. The bootstrap surfaces
it for operator debugging. This is safe: `correlationId` is a HubSpot-side
request marker, not a secret, and HubSpot docs designate it as the field to
quote when filing support tickets.

## 8. Compliance check against project rules

- Tenant isolation: N/A (app-level operation by design) — explicitly called
  out above so this is not mistaken for a regression.
- No silent CRM writes: the bootstrap writes only to HubSpot's
  subscriptions API (app-scope), not to any CRM object or tenant data.
- Config-driven: all behavior is driven by the five env vars in the locked
  contract (preflight §7). No hardcoded secrets, thresholds, or URLs beyond
  documented HubSpot API paths.
- No log leakage: verified above in §3.

## 9. Verdict

Slice 11 introduces a narrow, auditable, app-scope bootstrap surface with a
token-guarded admin route, constant-time comparison, strict no-log posture
on secrets, and zero regression of tenant isolation, RLS, encryption, HMAC
verification, or the Slice 6 oauth-failure fallback.

Approved for merge subject to:

- All three targeted test suites green
  (`hubspot-app-auth.test.ts`, `hubspot-subscription-bootstrap.test.ts`,
  `lifecycle-bootstrap.test.ts`).
- `git diff --stat origin/main -- apps/api/src/routes/lifecycle.ts apps/api/src/lib/tenant-lifecycle.ts` returns zero files.
- Workspace `pnpm typecheck`, `pnpm lint`, `pnpm test` green.
