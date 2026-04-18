# Slice 11 Preflight Notes

Date: 2026-04-18

Purpose: lock the HubSpot lifecycle-subscription-bootstrap contract before any
Slice 11 implementation begins. Re-verifies the endpoints, auth model,
idempotency semantics, and config surface the bootstrap service will consume.

Sources (verified 2026-04-18):

- Webhooks journal management APIs (version label `2026-03`):
  `https://developers.hubspot.com/docs/api-reference/latest/webhooks-journal/subscriptions/guide`
- Webhooks journal overview + auth/scopes:
  `https://developers.hubspot.com/docs/api-reference/latest/webhooks-journal/guide`
- Authentication overview (client-credentials section):
  `https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/overview`
- Slice 6 preflight (lifecycle event ids, hybrid-model posture):
  `docs/slice-6-preflight-notes.md`
- Live receiver (read-only reference):
  `apps/api/src/routes/lifecycle.ts`

## 1. Critical finding — the plan's endpoint and body shape must be corrected

The Slice 11 plan (`.claude/tasks/2026-04-18-slice-11-lifecycle-subscription-bootstrap.md`)
implicitly assumes the subscription-management API lives at
`/webhooks/v4/subscriptions` and that a subscription carries a `targetUrl`.
**Neither assumption matches the current (2026-03) docs.** The shipped
receiver route comment in `apps/api/src/routes/lifecycle.ts` also mentions
`POST /webhooks/v4/subscriptions`, which is stale.

Correct values, per docs:

- Base URL: `https://api.hubapi.com`
- Management API path prefix: `/webhooks-journal/subscriptions/2026-03`
  (the `2026-03` segment is the docs-versioned path, not a query param).
- **A subscription does NOT carry a `targetUrl`.** Subscriptions are
  app-global; HubSpot delivers events to the webhook target URL configured
  in the app itself (via `app-hsmeta.json` webhooks config or the developer
  UI). Slice 11's `LIFECYCLE_TARGET_URL` env is therefore consumed by the
  app-config / receiver-mount side, **not** sent in the subscription body.
- **APP_LIFECYCLE_EVENT subscriptions do NOT carry `portalId`** — they are
  app-scope. Only `OBJECT` / `ASSOCIATION` / `LIST_MEMBERSHIP` subscription
  types take a `portalId` (those are install-scoped).

These two corrections drop the "mismatched target URL" diff case from the
bootstrap service entirely — there is no per-subscription target URL to
diff against. The service only needs to diff on `(subscriptionType,
eventTypeId)`.

## 2. Subscription management endpoints

All require a **client-credentials** access token in `Authorization: Bearer <token>`.

| Action                                  | Method   | Path                                                         | Success      |
| --------------------------------------- | -------- | ------------------------------------------------------------ | ------------ |
| List all subscriptions (for the app)    | `GET`    | `/webhooks-journal/subscriptions/2026-03`                    | `200` + body |
| Create or update a subscription         | `POST`   | `/webhooks-journal/subscriptions/2026-03`                    | `200`/`201`  |
| Delete a subscription by id             | `DELETE` | `/webhooks-journal/subscriptions/2026-03/{subscriptionId}`   | `204`        |
| Delete all subscriptions for one portal | `DELETE` | `/webhooks-journal/subscriptions/2026-03/portals/{portalId}` | `204`        |

Required scopes on the client-credentials token:

- `developer.webhooks_journal.subscriptions.read` — for `GET`
- `developer.webhooks_journal.subscriptions.write` — for `POST` / `DELETE`

Rate limit: **50 req/s per app** on the subscriptions API.

Auth header shape (same for all three):

```
Authorization: Bearer <client-credentials access token>
Content-Type: application/json   (POST only)
```

### Body shape — APP_LIFECYCLE_EVENT

Per HubSpot's "Create an app install or uninstall event subscription" section:

```json
{
  "subscriptionType": "APP_LIFECYCLE_EVENT",
  "eventTypeId": "4-1909196",
  "properties": ["string"]
}
```

There is no `targetUrl`, no `portalId`, no `actions` array for this
subscription type. Slice 11's bootstrap creates **two** such subscriptions —
one per event type id.

### List response shape (relevant fields)

```json
{
  "results": [
    {
      "id": 60001005,
      "appId": 936515,
      "subscriptionType": "APP_LIFECYCLE_EVENT",
      "eventTypeId": "4-1909196",
      "createdAt": "2025-07-10T18:30:38.062Z",
      "updatedAt": "2025-07-10T18:30:38.062Z"
    }
  ]
}
```

For Slice 11's diff, match on `subscriptionType === "APP_LIFECYCLE_EVENT"`
AND `eventTypeId` in `{"4-1909196", "4-1916193"}`.

## 3. Client-credentials flow (app-level auth)

- Endpoint: `POST https://api.hubapi.com/oauth/v1/token`
- Content-Type: `application/x-www-form-urlencoded`
- Required form fields:
  - `grant_type=client_credentials`
  - `client_id=<HUBSPOT_APP_CLIENT_ID>`
  - `client_secret=<HUBSPOT_APP_CLIENT_SECRET>`
  - `scope=developer.webhooks_journal.subscriptions.read developer.webhooks_journal.subscriptions.write`
    (space-separated; omit `read`/`write` the bootstrap does not use; Slice 11
    bootstrap needs both read and write)
- Response shape (standard OAuth2):

  ```json
  {
    "access_token": "CO...",
    "expires_in": 1800,
    "token_type": "bearer"
  }
  ```

- Token lifetime: HubSpot's docs describe these as "short-term expiry windows
  that must be refreshed after a certain amount of time" without pinning a
  single number. Community/reference material typically cites 30 minutes
  (1800s) for client-credentials tokens, but the authoritative value is
  whatever comes back in `expires_in` on each fetch. **The app-auth client
  MUST trust `expires_in` from the response and NOT hardcode a constant.**
  A safe in-memory cache TTL is `expires_in - 60s` as a skew buffer.
- No refresh-token flow: client-credentials tokens are re-fetched on expiry
  by re-POSTing to the token endpoint with the same credentials.

Note: `HUBSPOT_APP_ID` is NOT sent to `/oauth/v1/token` — only `client_id` and
`client_secret`. `HUBSPOT_APP_ID` is still useful (logging, correlating to
the app's numeric id in HubSpot, constructing admin UI links) but is not a
required auth input. The plan's config contract correctly lists it.

## 4. Idempotency semantics — "Create or update a subscription"

The HubSpot endpoint is explicitly titled **"Create or update a subscription"**
in the 2026-03 docs, and the subscriptions API guide repeatedly uses that
phrasing. HubSpot does not document a `409 Conflict` path for duplicate
subscription creation; it documents a single POST that either creates or
updates.

Confirmed behavior from the docs:

- Success codes are `200 OK` and `204 No Content`; there is no
  `409 Conflict` in the documented error-code list.
- The response payload includes an `id`; re-posting an equivalent subscription
  returns a subscription row (HubSpot treats the endpoint as upsert rather
  than strict-create).

**Implication for the bootstrap diff-and-create strategy:** the service can
be implemented as either:

1. **Diff-first (preferred for Slice 11):** `GET` the list, compare against
   the desired set of two `(APP_LIFECYCLE_EVENT, eventTypeId)` pairs, and
   only `POST` the missing ones. Report `alreadyPresent` for matches. This
   is idempotent by construction and gives a clean operator-facing report.
2. **Upsert-unconditional:** `POST` both subscriptions every run, trust
   HubSpot's upsert. This is also idempotent but produces a less useful
   report (no "alreadyPresent" signal).

Slice 11 should use **diff-first**. Reasoning: the plan's acceptance
criteria explicitly require the typed report `{ created, alreadyPresent }`,
and the diff-first path is what produces that without a second GET after
each POST.

No `409` handling branch is required. The bootstrap should still surface
non-2xx responses as errors with the HubSpot `correlationId` (see §6).

## 5. APP_LIFECYCLE_EVENT + event-id cross-check

Confirmed current (2026-03 docs, 2026-04-14 last-modified):

- `subscriptionType`: `APP_LIFECYCLE_EVENT` ✓
- `4-1909196` → App install event ✓
- `4-1916193` → App uninstall event ✓

These match `apps/api/src/routes/lifecycle.ts` line 42-45:

```ts
export const HUBSPOT_LIFECYCLE_EVENT_IDS = {
  APP_INSTALL: "4-1909196",
  APP_UNINSTALL: "4-1916193",
} as const;
```

The bootstrap service MUST reuse the ids from `HUBSPOT_LIFECYCLE_EVENT_IDS`
rather than re-declaring them, to keep the receiver and bootstrap in lockstep.

Journal event payload reference (for cross-check only; journal ingestion is
deferred out of Slice 11):

```json
{
  "type": "app_lifecycle_event",
  "action": "APP_INSTALL",
  "portalId": 123456,
  "eventTypeId": "4-1909196",
  "properties": { "hs_app_id": 1234567, "hs_app_install_level": "PORTAL", ... }
}
```

## 6. Error handling the bootstrap should surface

Per the webhooks-journal overview:

- `400` invalid request body
- `401` missing/invalid token — auth-client should re-fetch once and retry
- `403` missing scopes — surface as "insufficient scopes" with the correlationId
- `429` rate-limited — respect `Retry-After`; bootstrap runs are infrequent
  so a simple single retry is acceptable
- `5xx` upstream error — surface as `502` from the admin route

Error payload shape:

```json
{
  "status": "error",
  "message": "...",
  "correlationId": "...",
  "category": "VALIDATION_ERROR"
}
```

`correlationId` is safe to log. `message` is safe to log. The bearer token
and `client_secret` are NOT safe to log.

## 7. Locked config contract

Exactly five env vars feed Slice 11. Nothing else.

| Env var                     | Required | Purpose                                                                                                                                                                                                 | Consumer                                        | Example shape (redacted)                             |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| `HUBSPOT_APP_ID`            | required | Numeric app id. Not sent to `/oauth/v1/token` — used for log correlation and error messages only.                                                                                                       | app-auth client (logging), bootstrap service    | `1234567`                                            |
| `HUBSPOT_APP_CLIENT_ID`     | required | App client id for client-credentials flow. Form field `client_id`.                                                                                                                                      | app-auth client only                            | `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`               |
| `HUBSPOT_APP_CLIENT_SECRET` | required | App client secret for client-credentials flow. Form field `client_secret`. **NEVER log.**                                                                                                               | app-auth client only                            | `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`               |
| `LIFECYCLE_TARGET_URL`      | required | Public HTTPS URL of the Slice 7 receiver. **NOT sent in the subscription body** (see §1). Used by the operator runbook + `app-hsmeta.json` webhooks config + consistency check in the bootstrap report. | bootstrap service (report), runbook, app-hsmeta | `https://api.example.com/webhooks/hubspot/lifecycle` |
| `INTERNAL_BOOTSTRAP_TOKEN`  | required | Shared secret for the admin route guard. Compared with length-safe constant-time equality. **NEVER log.**                                                                                               | admin route only                                | 32+ byte random string                               |

**Handling rules (security audit consumes these):**

- `HUBSPOT_APP_CLIENT_SECRET`, `INTERNAL_BOOTSTRAP_TOKEN`, and any bearer
  token from `/oauth/v1/token` MUST NOT appear in logs, error payloads, or
  test snapshots.
- Missing-env failures must name the missing env var but never print its
  suspected value.
- `HUBSPOT_APP_ID` and `LIFECYCLE_TARGET_URL` ARE safe to log.

## 8. Consistency-check caveat for `LIFECYCLE_TARGET_URL`

Because HubSpot does not accept a per-subscription `targetUrl` on
APP_LIFECYCLE_EVENT subscriptions, the bootstrap service CANNOT assert
via the subscriptions API that HubSpot will deliver to the expected URL.
The target URL is owned by the app's webhooks config (e.g.,
`app-hsmeta.json`'s webhooks feature component, or the developer UI
"Webhooks target URL" field).

Recommendation for Slice 11:

- The bootstrap report SHOULD include `targetUrl` it was configured with
  as a passthrough field in the JSON output, so the operator runbook can
  visually compare it to what's set in the HubSpot developer UI / app
  config.
- The bootstrap service does NOT fail on mismatched URLs — it cannot see
  them. The plan's "mismatched target URL" diff case should be REMOVED
  from the acceptance criteria for the bootstrap service. It remains a
  valid runbook check, not a programmatic check.

This is the single largest plan adjustment needed before the
`builder-subscription-bootstrap` task starts.

## 9. Explicit non-goals (confirming Slice 11 scope boundary)

Out of scope, per the Slice 11 plan and confirmed here:

- **Journal polling / cursor checkpointing** (`GET /webhooks-journal/journal/2026-03/*`).
  The receiver in `apps/api/src/routes/lifecycle.ts` handles webhook
  delivery directly; journal ingestion is deferred to a later slice.
- **`DELETE /appinstalls/v3/external-install`** (app uninstall by API).
  Remains operator-only; Slice 11 does not wrap it.
- **Delete-all-subscriptions-for-portal**
  (`DELETE /webhooks-journal/subscriptions/2026-03/portals/{portalId}`).
  Not used — Slice 11 only creates APP_LIFECYCLE_EVENT subscriptions at the
  app level. Tenant offboarding is already handled by Slice 6.
- **Subscription filters** (`/webhooks-journal/subscriptions/2026-03/filters`).
  Not applicable to APP_LIFECYCLE_EVENT subscriptions.
- **Slice 6 oauth-failure fallback** preserved unchanged —
  `apps/api/src/lib/tenant-lifecycle.ts` is read-only for Slice 11.

## 10. Downstream builder checklist

This section is the contract `builder-app-auth`, `builder-subscription-bootstrap`,
and `builder-admin-route` consume.

- **Token endpoint:** `POST https://api.hubapi.com/oauth/v1/token`, form-urlencoded,
  grant `client_credentials`, scopes `developer.webhooks_journal.subscriptions.read developer.webhooks_journal.subscriptions.write`.
- **Cache TTL:** trust `expires_in` from the response; expire the cache
  `expires_in - 60s` after fetch.
- **List subscriptions:** `GET https://api.hubapi.com/webhooks-journal/subscriptions/2026-03`
  with `Authorization: Bearer <token>`.
- **Create subscription:** `POST https://api.hubapi.com/webhooks-journal/subscriptions/2026-03`
  with `Authorization: Bearer <token>`, `Content-Type: application/json`,
  body `{ "subscriptionType": "APP_LIFECYCLE_EVENT", "eventTypeId": "<id>" }`
  (omit `properties` unless we later need specific event properties).
- **Delete subscription:** `DELETE https://api.hubapi.com/webhooks-journal/subscriptions/2026-03/{subscriptionId}`
  with `Authorization: Bearer <token>`. Slice 11 does not call this in the
  primary path, but the app-auth client should support it for future use.
- **Diff key:** `(subscriptionType === "APP_LIFECYCLE_EVENT", eventTypeId)`.
  No target-URL comparison.
- **Desired set:** exactly two entries — one with `eventTypeId === "4-1909196"`,
  one with `eventTypeId === "4-1916193"`. Both pulled from
  `HUBSPOT_LIFECYCLE_EVENT_IDS` in `apps/api/src/routes/lifecycle.ts`.
- **Idempotency:** diff-first — create only the missing ones. Re-runs with
  both present return `{ created: [], alreadyPresent: ["4-1909196", "4-1916193"] }`.
- **Admin route guard:** `X-Internal-Bootstrap-Token` compared with
  length-safe constant-time equality against `INTERNAL_BOOTSTRAP_TOKEN`.
  401 if header missing, 403 if present-but-wrong, 200 on success, 502 on
  upstream HubSpot failure.
- **Mount point:** `POST /admin/lifecycle/bootstrap`, OUTSIDE `/api/*`,
  outside tenant middleware.
