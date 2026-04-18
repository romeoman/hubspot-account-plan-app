# Lifecycle Subscription Bootstrap Runbook

Date: 2026-04-18

## 1. Purpose

This runbook bootstraps the HubSpot `APP_LIFECYCLE_EVENT` subscriptions so the
Slice 7 webhook receiver (`POST /webhooks/hubspot/lifecycle`) actually receives
install and uninstall events for the installed portals.

Without this bootstrap, the receiver is live but never called, and the system
is relying solely on the Slice 6 oauth-refresh-failure fallback as the signal
for tenant offboarding. That is a marketplace-submission blocker: HubSpot
requires the app to subscribe to `APP_LIFECYCLE_EVENT` and prove install and
uninstall handling.

Cross-links:

- `docs/runbooks/tenant-offboarding.md` — Slice 6 fallback
- `.claude/tasks/2026-04-18-slice-11-lifecycle-subscription-bootstrap.md` — plan
- `docs/slice-11-preflight-notes.md` — contract + source docs
- `docs/security/slice-11-audit.md` — security audit

## 2. Config

Exactly five env vars feed the bootstrap. See
`docs/slice-11-preflight-notes.md` §7 for the locked contract.

| Env var                     | Required | Purpose                                                                                                                                                                        |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HUBSPOT_APP_ID`            | required | Numeric app id. Used for log correlation only. NOT sent to the token endpoint.                                                                                                 |
| `HUBSPOT_APP_CLIENT_ID`     | required | App client id for the client-credentials flow.                                                                                                                                 |
| `HUBSPOT_APP_CLIENT_SECRET` | required | App client secret. Never log. Never echo.                                                                                                                                      |
| `LIFECYCLE_TARGET_URL`      | required | Public HTTPS URL of the Slice 7 receiver. NOT sent in the HubSpot subscription body (see §8). Kept as a passthrough field in the JSON report for operator visual verification. |
| `INTERNAL_BOOTSTRAP_TOKEN`  | required | Shared secret for the admin route guard. 32+ bytes from a CSPRNG. Per-env, never reused. Never log.                                                                            |

Credential owners:

- `HUBSPOT_APP_*`: owned by the HubSpot developer-account admin. Lives in the
  developer UI under the app's Auth tab.
- `LIFECYCLE_TARGET_URL`: owned by the deploy-environment config. MUST match
  what the app's `app-hsmeta.json` webhooks feature component (or
  developer-UI webhooks settings) points at.
- `INTERNAL_BOOTSTRAP_TOKEN`: owned by the deploy-environment operator.
  Generated per environment (dev, preview, prod) and not shared across envs.

## 3. First-run

Two equivalent entry points. Pick the one that matches the environment.

### 3.1 Script (preferred for CI and dev)

```
pnpm --filter @hap/api lifecycle:bootstrap
```

Reads env directly, calls `ensureLifecycleSubscriptions`, prints the JSON
report to stdout.

Exit codes:

- `0` — success (any report, including one where both subscriptions were
  already present)
- `2` — missing env (one of the five vars above is unset)
- `3` — upstream HubSpot failure (token fetch, list, or create call failed)
- `1` — any other unexpected internal error

### 3.2 HTTP (preferred for prod after first deploy)

```
curl -X POST \
  -H "X-Internal-Bootstrap-Token: $INTERNAL_BOOTSTRAP_TOKEN" \
  https://<api-host>/admin/lifecycle/bootstrap
```

Mounted outside `/api/*` and outside tenant middleware — this is an app-level,
not tenant-level, operation.

### 3.3 Expected report shape

```json
{
  "targetUrl": "https://api.example.com/webhooks/hubspot/lifecycle",
  "created": [
    { "eventTypeId": "4-1909196", "subscriptionId": 60001005 },
    { "eventTypeId": "4-1916193", "subscriptionId": 60001006 }
  ],
  "alreadyPresent": []
}
```

On an already-subscribed app:

```json
{
  "targetUrl": "https://api.example.com/webhooks/hubspot/lifecycle",
  "created": [],
  "alreadyPresent": [
    { "eventTypeId": "4-1909196", "subscriptionId": 60001005 },
    { "eventTypeId": "4-1916193", "subscriptionId": 60001006 }
  ]
}
```

### 3.4 Mandatory visual check

The operator MUST visually confirm that the returned `targetUrl` matches what
is configured in the app's `app-hsmeta.json` webhooks feature component (or
the developer-UI "Webhooks target URL" field). HubSpot's subscription API is
app-scoped and does NOT expose a per-subscription target URL, so the
bootstrap cannot assert this programmatically — see §8.

## 4. Idempotency

Re-running the bootstrap on an already-subscribed app is safe. The diff is on
`(subscriptionType, eventTypeId)` only. If both `APP_LIFECYCLE_EVENT` /
`4-1909196` and `APP_LIFECYCLE_EVENT` / `4-1916193` already exist for the
app, the report returns `created: []` and `alreadyPresent` contains both
subscription rows.

CI can safely call the bootstrap on every production deploy as a guardrail —
it is a no-op when nothing needs to change.

## 5. Rotation — `HUBSPOT_APP_CLIENT_SECRET`

1. Rotate the client secret in the HubSpot developer UI (Auth → rotate).
2. Update the new value in the deploy-environment secret store.
3. Restart the API process so the new env is picked up. The in-memory token
   cache in `apps/api/src/lib/hubspot-app-auth.ts` is process-local and is
   discarded on restart.
4. Re-run the bootstrap (script or HTTP). It will acquire a fresh
   client-credentials token using the new secret and return `alreadyPresent`
   for both event types.

The old client secret is invalidated on the HubSpot side immediately. Any
bootstrap run that races the rotation will either use the old secret (may
401 on the token endpoint) or the new secret (succeeds). Neither path can
corrupt subscription state — it either succeeds or fails cleanly.

## 6. Rotation — `INTERNAL_BOOTSTRAP_TOKEN`

1. Generate a new 32+ byte random value (for example
   `openssl rand -base64 48`) in the deploy-environment secret store.
2. Restart the API so the new env is picked up.
3. Update the operator's local `curl` env to use the new token.
4. No code change required.

There is no grace period for the old token — the admin route compares the
presented token against the current env value with constant-time equality.
Keep rotation coordinated so a bootstrap is not mid-flight.

## 7. Rollback

Leaving the subscriptions in place is safe. The Slice 7 receiver treats
unknown events as no-ops, and the existing install/uninstall handling is the
expected behavior. No rollback action is required for normal code rollback.

If the subscriptions must be explicitly torn down (for example during
developer-account cleanup), do it manually, out of band:

- Via the HubSpot developer UI, delete the two APP_LIFECYCLE_EVENT
  subscriptions from the app.
- Or, as an operator-only one-off:
  `DELETE https://api.hubapi.com/webhooks-journal/subscriptions/2026-03/{subscriptionId}`
  for each of the two subscription ids returned in the last bootstrap report.

The shipped code path does NOT wrap the delete call. Slice 11 only creates
subscriptions.

## 8. `LIFECYCLE_TARGET_URL` and the subscription API

HubSpot's `APP_LIFECYCLE_EVENT` subscription API is app-scoped. The
subscription record itself does NOT carry a `targetUrl` or `portalId`;
HubSpot delivers events to the single target URL configured on the app in
`app-hsmeta.json` (or the developer-UI webhooks settings).

Operational consequence:

- The bootstrap service cannot programmatically detect a drifted target URL.
- `LIFECYCLE_TARGET_URL` is a passthrough field in the JSON report so the
  operator can visually compare it to the app's webhooks config.
- If the operator sees `targetUrl` in the report diverge from what the app
  is actually configured to deliver to, fix the app webhooks config in
  HubSpot (not the bootstrap env) — the env is a label, the app config is
  the source of truth.

## 9. Troubleshooting

| Symptom                                                           | Likely cause                                                    | Next step                                                                                                                                                                                |
| ----------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 { error: "unauthorized" }` from the admin route              | `X-Internal-Bootstrap-Token` header missing                     | Add the header.                                                                                                                                                                          |
| `403 { error: "forbidden" }` from the admin route                 | Header present but wrong value                                  | Check the env var vs the header value. Do NOT echo either in logs.                                                                                                                       |
| `503 { error: "bootstrap_not_configured" }`                       | Server-side `INTERNAL_BOOTSTRAP_TOKEN` env is unset             | Set the env var in the deploy environment and restart.                                                                                                                                   |
| `502 { error: "upstream_failure", stage: "token" }`               | Token fetch against `/oauth/v1/token` failed                    | Check `HUBSPOT_APP_CLIENT_ID` / `HUBSPOT_APP_CLIENT_SECRET` / network egress. Never echo the secret.                                                                                     |
| `502 { error: "upstream_failure", stage: "list" }`                | GET subscriptions failed                                        | Check scopes (`developer.webhooks_journal.subscriptions.read`) and the HubSpot `correlationId` in the error.                                                                             |
| `502 { error: "upstream_failure", stage: "create", eventTypeId }` | POST create-subscription failed for one event type              | Check write scope (`developer.webhooks_journal.subscriptions.write`). If `429`, wait out `Retry-After` and re-run — the bootstrap is idempotent. HubSpot rate limit is 50 req/s per app. |
| Bootstrap reports success but receiver never fires                | App's webhooks target URL does not match `LIFECYCLE_TARGET_URL` | Fix the target URL in `app-hsmeta.json` / developer-UI webhooks settings (see §8).                                                                                                       |

## 10. Security notes

- `HUBSPOT_APP_CLIENT_SECRET`, the client-credentials bearer token, and
  `INTERNAL_BOOTSTRAP_TOKEN` MUST NOT appear in logs, error payloads, or
  test snapshots. The bootstrap and app-auth client are designed to surface
  only `correlationId`, status, stage, and (for creates) `eventTypeId`.
- The admin route is mounted OUTSIDE `/api/*` and outside tenant middleware.
  It is intentionally app-scoped, not tenant-scoped — subscriptions are a
  property of the HubSpot app, not of any one installed portal.
- Full security review in `docs/security/slice-11-audit.md`.
