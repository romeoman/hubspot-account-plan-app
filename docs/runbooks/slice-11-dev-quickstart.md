# Slice 11 Dev Quickstart

Date: 2026-04-19

This runbook walks a developer from zero to a live APP_INSTALL and
APP_UNINSTALL delivery against the Slice 7 receiver
(`POST /webhooks/hubspot/lifecycle`) using the Slice 11 bootstrap pipeline.

See also:

- `.claude/tasks/2026-04-19-slice-11-dev-operationalization.md` — plan
- `docs/runbooks/lifecycle-subscription-bootstrap.md` — full runbook
- `docs/slice-11-preflight-notes.md` — contract + source docs
- `apps/hubspot-project/UPLOAD.md` — real HubSpot project upload workflow
- `apps/hubspot-project/src/app/webhooks/webhooks-hsmeta.json` — webhooks
  feature component that declares the delivery URL

## 1. Env contract

Exactly five env vars gate the first dev run. Missing any of the last four
causes the bootstrap script to exit non-zero before contacting HubSpot. See
`docs/slice-11-preflight-notes.md §7` for the locked contract.

| Env var                     | Source                                                                                                                  | Notes                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `HUBSPOT_APP_ID`            | Numeric app id from the HubSpot developer UI → your app → Auth tab.                                                     | Safe to log. Used for correlation only. NOT sent to the token endpoint.                |
| `HUBSPOT_APP_CLIENT_ID`     | HubSpot developer UI → your app → Auth tab → "Client ID".                                                               | Form field `client_id` in the client-credentials flow.                                 |
| `HUBSPOT_APP_CLIENT_SECRET` | HubSpot developer UI → your app → Auth tab → "Client secret".                                                           | **Never log. Never echo.** Rotate per env.                                             |
| `LIFECYCLE_TARGET_URL`      | The public HTTPS URL of your dev receiver (ngrok / Cloudflare tunnel / Vercel preview) + `/webhooks/hubspot/lifecycle`. | MUST resolve to the same URL the webhooks feature component points HubSpot at. See §2. |
| `INTERNAL_BOOTSTRAP_TOKEN`  | 32+ bytes from a CSPRNG. Generate per env, never reuse.                                                                 | Shared secret for the `POST /admin/lifecycle/bootstrap` guard. **Never log.**          |

Copy this snippet into a `.env` file (gitignored) at the repo root.
Placeholders only — never paste real secrets into a checked-in file.

```bash
# Slice 11 — lifecycle bootstrap
HUBSPOT_APP_ID=$HUBSPOT_APP_ID
HUBSPOT_APP_CLIENT_ID=$HUBSPOT_APP_CLIENT_ID
HUBSPOT_APP_CLIENT_SECRET=$HUBSPOT_APP_CLIENT_SECRET
LIFECYCLE_TARGET_URL=$LIFECYCLE_TARGET_URL
INTERNAL_BOOTSTRAP_TOKEN=$INTERNAL_BOOTSTRAP_TOKEN
```

Generate a fresh `INTERNAL_BOOTSTRAP_TOKEN`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 2. URL contract rule

Slice 11's bootstrap registers APP_LIFECYCLE_EVENT subscriptions via the
webhooks-journal subscriptions API. Those subscriptions do NOT carry a
`targetUrl`. HubSpot delivers events to the URL declared in the app's
webhooks feature component:

- File: `apps/hubspot-project/src/app/webhooks/webhooks-hsmeta.json`
- Target: `${API_ORIGIN}/webhooks/hubspot/lifecycle`

**Rule:** `LIFECYCLE_TARGET_URL` in your `.env` MUST resolve to the exact
same HTTPS URL that HubSpot resolves the webhooks feature component's
`settings.targetUrl` to for the active profile.

How to eyeball it:

1. Open `apps/hubspot-project/hsprofile.local.json` (or whichever profile
   you upload with). Note `variables.API_ORIGIN`.
2. Concatenate: `<API_ORIGIN>/webhooks/hubspot/lifecycle`.
3. Compare, byte for byte, with your `.env` `LIFECYCLE_TARGET_URL`.
4. The bootstrap report echoes `LIFECYCLE_TARGET_URL` as a passthrough for
   visual cross-check (see `docs/slice-11-preflight-notes.md §8`). The
   bootstrap service does NOT programmatically verify the webhooks config
   target — HubSpot does not expose it through the subscriptions API.

If these diverge, HubSpot will accept subscriptions but silently deliver
events somewhere your receiver is not listening.

## 3. First bootstrap run

From the repo root:

```bash
pnpm --filter @hap/api lifecycle:bootstrap
```

The script reads env directly, calls `ensureLifecycleSubscriptions`, and
prints a JSON report to stdout.

Expected report shape (cross-link: `docs/runbooks/lifecycle-subscription-bootstrap.md §3.3`):

```json
{
  "appId": "$HUBSPOT_APP_ID",
  "targetUrl": "$LIFECYCLE_TARGET_URL",
  "created": ["4-1909196", "4-1916193"],
  "alreadyPresent": []
}
```

Across `created` + `alreadyPresent`, both event ids `4-1909196` (install)
and `4-1916193` (uninstall) must be covered. Re-running the command must
produce `created: []` and both ids in `alreadyPresent`.

Exit codes:

| Code | Meaning                                                                |
| ---- | ---------------------------------------------------------------------- |
| 0    | Success — desired subscriptions are present.                           |
| 1    | Upstream HubSpot failure (token endpoint or subscriptions API).        |
| 2    | Missing or malformed env var.                                          |
| 3    | Unexpected runtime error. Check stderr; do NOT paste secrets anywhere. |

## 4. Install + uninstall verification

### 4.1 Upload the HubSpot project

From the repo root, using the real workflow from
`apps/hubspot-project/UPLOAD.md`:

```bash
pnpm tsx scripts/hs-project-upload.ts --profile local
```

This copies `apps/hubspot-project/` to a temp directory outside any git
worktree (works around a `@hubspot/cli` worktree bug) and runs
`hs project upload`. The uploaded project now carries the webhooks feature
component, so HubSpot knows where to deliver lifecycle events after
subscriptions are registered.

### 4.2 Install into a dev test portal

1. In the HubSpot developer UI, open the app's "Install URL" for your dev
   test portal (a non-production portal you own).
2. Approve the requested scopes.
3. Tail your receiver logs. You should see, within a few seconds, a line
   like:

   ```
   [lifecycle] APP_INSTALL received portalId=<id> timestamp=<iso>
   ```

4. Record that log line (redact nothing — `portalId` and timestamp are
   safe to share; no secrets are emitted by the Slice 7 receiver).

### 4.3 Uninstall

1. In the dev test portal, go to Settings → Connected apps → your app →
   Uninstall.
2. Tail the receiver logs. Expect:

   ```
   [lifecycle] APP_UNINSTALL received portalId=<id> timestamp=<iso>
   ```

3. Record that log line.

Two bootstrap reports + two receiver log lines = verification evidence
called for in the Slice 11 dev operationalization plan, acceptance
criteria 5–8.

## 5. If you get stuck

- Missing env → exit 2. Re-read §1. Check that `.env` is loaded.
- Upstream 401/403 from `/oauth/v1/token` → wrong `CLIENT_ID` or
  `CLIENT_SECRET`, or the app lacks the
  `developer.webhooks_journal.subscriptions.read/write` scopes at the
  client-credentials level.
- Subscriptions created, but no install webhook arrives →
  `LIFECYCLE_TARGET_URL` and `webhooks-hsmeta.json settings.targetUrl`
  diverged. Re-read §2.
- Receiver never sees the request → your public HTTPS tunnel died.
  Restart it and re-install.
- Do NOT paste `HUBSPOT_APP_CLIENT_SECRET`, `INTERNAL_BOOTSTRAP_TOKEN`,
  or any bearer token into logs, Slack, or PRs.
