# Slice 3 Preflight Notes

**Date verified:** 2026-04-15
**Sources:** Context7 (`/websites/developers_hubspot`, `/websites/anthropic`, `/websites/ai_google_dev_gemini-api`).

This doc is the hard gate required by the Slice 3 plan (Task 0, `preflight-docs`). It captures current-as-of-today platform facts that the implementation tasks depend on. If any of these change before Slice 3 merges, re-verify.

---

## 1. HubSpot `app-hsmeta.json` — OAuth + marketplace

Current schema (from `/docs/apps/developer-platform/build-apps/app-configuration` + `/docs/apps/developer-platform/add-features/app-objects/reference`):

```json
{
  "uid": "hap_signal_workspace_app",
  "type": "app",
  "config": {
    "description": "...",
    "name": "Signal-First Account Workspace",
    "distribution": "marketplace",
    "auth": {
      "type": "oauth",
      "redirectUrls": ["http://${DOMAIN}/oauth/callback"],
      "requiredScopes": ["crm.objects.companies.read", "crm.objects.contacts.read"],
      "optionalScopes": [],
      "conditionallyRequiredScopes": []
    },
    "permittedUrls": {
      "fetch": ["https://api.hubapi.com"],
      "iframe": [],
      "img": []
    },
    "support": { ... }
  }
}
```

**Hard rules:**

- `redirectUrls` MUST use HTTPS. **Exception**: `http://localhost` is explicitly allowed for testing. Docs verbatim: _"Each app must have at least one auth redirect URL, and it must use HTTPS. The only exception is that http://localhost is allowed for testing."_
- Slice 3 decision: start with `http://localhost:3000/oauth/callback` in the `dev` profile; production URL added at listing time (out of scope for Slice 3).
- `distribution: "marketplace"` per Romeo's decision — unlimited installs, marketplace-listable (listing submission itself is a later business step).

## 2. Config profiles — `${DOMAIN}` substitution

Confirmed workflow (`/docs/developer-tooling/local-development/build-with-config-profiles`):

1. Add profiles via CLI: `hs project profile add dev` (and `prod` later).
2. Edit `src/hsprofile.dev.json` (sits next to `hsproject.json`):
   ```json
   { "accountId": 146425426, "variables": { "DOMAIN": "localhost:3000" } }
   ```
3. Reference in `app-hsmeta.json` via `${DOMAIN}` (and any other var).
4. Upload with `hs project upload -p dev`.

**Slice 3 decision: use config profiles, not per-env manifests.** Rationale: single committed `app-hsmeta.json`, profile files gitignored, zero JSON duplication, matches HubSpot's documented pattern.

Files to add in Task 5 (`project-config-flip`):

- `apps/hubspot-project/src/hsprofile.dev.json` (gitignored — contains account ID)
- `apps/hubspot-project/src/hsprofile.dev.example.json` (committed template)

## 3. OAuth token endpoints

Two API versions are live; both accept `authorization_code` and `refresh_token` grants.

**Preferred (newest, explicit path version):**

- `POST https://api.hubapi.com/oauth/2026-03/token`
- `Content-Type: application/x-www-form-urlencoded`
- Body: `client_id`, `client_secret`, `grant_type` (`authorization_code` | `refresh_token`), `code`/`refresh_token`, `redirect_uri`, optional `scope`, optional `code_verifier` (PKCE).
- Returns: `{ access_token, refresh_token, expires_in, token_type, hub_id?, scopes[] }`.

**Legacy but still working:** `POST /oauth/v1/token` (exchange), `POST /oauth/v3/token` (refresh).

**Slice 3 decision: use `/oauth/2026-03/token` for both** — single endpoint, versioned path, matches the project's 2026.03 platform version.

## 4. Token identity (OAuth callback needs this to get `hub_id`)

**Endpoint:** `GET https://api.hubapi.com/oauth/v1/access-tokens/{token}`

Returns (relevant fields only):

```json
{
  "token": "...",
  "user": "user@domain.com",
  "hub_domain": "example.com",
  "scopes": ["oauth", "crm.objects.contacts.read", ...],
  "hub_id": 1234567,
  "app_id": 111111,
  "expires_in": 1754,
  "user_id": 293199,
  "token_type": "access"
}
```

**Slice 3 decision: callback flow uses this endpoint** (not the `/token/introspect` variant, which is for active-check). `hub_id` is the value we store as `tenants.hubspot_portal_id` (stringified). No duplication into `tenant_hubspot_oauth`.

## 5. Request validation (`X-HubSpot-Signature-v3`) — unchanged from Slice 2

Re-verified: the canonicalization, header name, and 5-minute freshness window Slice 2 implemented still match HubSpot's current `request-validation` spec. No Slice 3 migration needed here; the existing `apps/api/src/middleware/hubspot-signature.ts` remains the auth path for extension→backend requests.

## 6. Anthropic Messages API

- `POST https://api.anthropic.com/v1/messages`
- Header: `x-api-key: ${ANTHROPIC_API_KEY}`, `anthropic-version: 2023-06-01`, `content-type: application/json`
- Body (minimum):
  ```json
  {
    "model": "claude-sonnet-4-6",
    "max_tokens": 512,
    "messages": [{ "role": "user", "content": "..." }]
  }
  ```
- Response: `{ content: [{ type: "text", text: "..." }], usage: { input_tokens, output_tokens }, stop_reason }`

**Slice 3 decision:** default model `claude-sonnet-4-6` (matches CLAUDE.md "latest most capable"). `max_tokens` budget = `MAX_NEXT_MOVE_CHARS / 4` rounded up (token≈4 chars heuristic). Reuse OpenAI adapter's AbortController 30s timeout pattern.

## 7. Gemini `generateContent`

- `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- Header: `x-goog-api-key: ${GEMINI_API_KEY}`, `Content-Type: application/json`
- Body:
  ```json
  {
    "contents": [{ "parts": [{ "text": "..." }] }],
    "generationConfig": { "temperature": 0.7, "maxOutputTokens": 512 }
  }
  ```
- Response: `{ candidates: [{ content: { role: "model", parts: [{ text: "..." }] } }], usageMetadata: {...} }`

**Slice 3 decision:** default model `gemini-2.5-flash` (current stable, fast, low cost). `maxOutputTokens` same budget as Anthropic.

## 8. Environment variables added/removed in Slice 3

**Removed:**

- `HUBSPOT_DEV_PORTAL_TOKEN` — the static-private-app bridge token. Replaced by per-tenant OAuth tokens in `tenant_hubspot_oauth`.

**Added:**

- `ANTHROPIC_API_KEY` — optional (required only when a tenant's `llm_config.provider = 'anthropic'`).
- `GEMINI_API_KEY` — optional, same pattern.
- `HUBSPOT_DISTRIBUTION` — optional env used only in config-profile variable substitution; defaults to `marketplace`.

**Unchanged:**

- `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`, `ROOT_KEK`, `DATABASE_URL` — all still required.
- `OPENAI_API_KEY`, `EXA_API_KEY` — still optional, still tenant-gated.

## 9. Slice 3 architectural invariants (preflight-confirmed)

1. `tenants.hubspot_portal_id` is the **single source of truth** for portal identity. `tenant_hubspot_oauth` has NO `hub_id` column.
2. OAuth callback flow order: verify state → exchange code (`/oauth/2026-03/token`) → fetch identity (`/oauth/v1/access-tokens/{token}`) → upsert `tenants` on `hubspot_portal_id` → upsert `tenant_hubspot_oauth` on `tenant_id` → redirect via `returnUrl` query param if present.
3. Stateless OAuth state detects tampering + expiry. Single-use replay is an accepted gap (documented in Solution Approach + SECURITY.md §17).
4. RLS covers every tenant-scoped table EXCEPT `tenants` (bootstrap lookup happens before `app.tenant_id` is set).
5. Replay-nonce dedup key is tenant-scoped: `PRIMARY KEY (tenant_id, timestamp, body_hash)`.
6. Card bundling requires a new entry file `apps/hubspot-extension/src/hubspot-card-entry.tsx` with a default export; `src/index.tsx` (side-effect `hubspot.extend` only, no default) cannot be re-exported.

## 10. Known gaps / follow-ups

- **Production domain for marketplace listing**: not resolved in Slice 3. Listing submission requires an HTTPS production URL; Slice 3 ships with dev-profile `http://localhost:3000/oauth/callback` only. Prod-profile creation + deployment are post-Slice-3 business steps.
- **Second test portal for two-portal proof**: Romeo has one. Portal ID captured in Task 14 (`slice-3-walkthrough`).
- **Anthropic + Gemini API keys**: Romeo has both. Cassette recording happens once per adapter in Task 6 + Task 7.

---

**Gate status:** OPEN. All six architectural invariants verified against current HubSpot + Anthropic + Gemini docs. Phase 1 (Tasks 1–8) may proceed.
