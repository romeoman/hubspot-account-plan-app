# Security Architecture — Slice 1

This document is the single source of truth for how tenant isolation, authentication, authorization, encryption, and data minimization work in Slice 1 of the HubSpot Signal-First Account Workspace. It also explicitly enumerates what is deferred to Slice 2 so nothing is ambiguous.

Guiding rules from the project `CLAUDE.md`:

- Tenant-isolated by default. One customer must never see another customer's data, evidence, API keys, prompts, model settings, or DB rows.
- Restricted evidence must never be shown, summarized, or counted.
- No silent CRM writes.
- Behavior is config-driven; no hardcoded provider logic, secrets, thresholds, or env assumptions.
- Prefer explicit empty / suppressed state over bluffing.

---

## 1. Tenant Resolution

The API is a Hono app (`apps/api/src/index.ts`). Every `/api/*` request flows through a strictly ordered middleware chain:

```
request → cors → auth → tenant → route handler
```

### 1.1 `authMiddleware` — `apps/api/src/middleware/auth.ts`

Responsibility: turn an inbound bearer token into a `portalId` on the Hono context.

- Reads `Authorization: Bearer <token>` header (case-insensitive).
- Looks up the token in `API_TOKENS` env var (format: `token1:portalA,token2:portalB`). This keeps credentials config-driven and per-tenant — no shared secret is hardcoded.
- Bypass mode (`NODE_ENV === 'test'` OR `opts.bypassMode === true`) still requires a bearer header to be present (so a client forgetting `Authorization` is not silently accepted) and reads the portal from the `x-test-portal-id` header. Bypass is opt-in by environment — it can never trigger in production.
- On success: `c.set('portalId', <portalId>)` and `next()`.
- On failure (no header, empty token, unknown token): returns `401 { error: 'unauthorized' }`.

**Slice 2**: replace token lookup with real HubSpot private-app token validation (signature verification, portal-claim check, short-lived token exchange). The in-code `@todo Slice 2` on `authMiddleware` tracks this.

### 1.2 `tenantMiddleware` — `apps/api/src/middleware/tenant.ts`

Responsibility: turn the `portalId` into a `tenantId` + `tenant` row on the Hono context.

- Reads `portalId` from context (set by `authMiddleware`).
- Queries `tenants` for `hubspot_portal_id = portalId`.
- On success: `c.set('tenantId', tenant.id)` and `c.set('tenant', tenant)`.
- On missing `portalId` or no matching row: returns `401 { error: 'unauthorized', detail: 'tenant not found' }`.

Every downstream route handler reads `tenantId` via `c.get('tenantId')` — never from the URL, request body, or query string. Spoofed `tenantId` in request bodies is ignored by design; see `snapshot-route.test.ts` "returns 200 + valid snapshot JSON carrying tenantId from middleware (not path/body)".

---

## 2. Database Isolation

### 2.1 Schema-level rules

All tenant-owned tables carry `tenant_id uuid NOT NULL` with `REFERENCES tenants(id) ON DELETE CASCADE`. Tables in scope for Slice 1:

| Table             | `tenant_id` FK | Index including `tenant_id`              | File                                        |
| ----------------- | -------------- | ---------------------------------------- | ------------------------------------------- |
| `snapshots`       | cascade        | `snapshots_tenant_company_idx`           | `packages/db/src/schema/snapshots.ts`       |
| `evidence`        | cascade        | `evidence_tenant_timestamp_idx`          | `packages/db/src/schema/evidence.ts`        |
| `people`          | cascade        | `people_tenant_snapshot_idx`             | `packages/db/src/schema/people.ts`          |
| `provider_config` | cascade        | `provider_config_tenant_provider_unique` | `packages/db/src/schema/provider-config.ts` |
| `llm_config`      | cascade        | `llm_config_tenant_provider_unique`      | `packages/db/src/schema/llm-config.ts`      |

Cascade delete means: when a tenant is removed, every row owned by that tenant (snapshots, evidence, people, both config tables) is removed atomically. There is no cross-tenant orphan data path.

### 2.2 Query rules

Every Drizzle query against a tenant-owned table MUST scope by `tenant_id` using `eq(table.tenantId, ctx.tenantId)` — typically inside an `and(...)`. Representative examples:

- Eligibility: `apps/api/src/services/eligibility.ts` scopes `provider_config` lookup by `and(eq(providerConfig.tenantId, tenantId), eq(providerConfig.providerName, HUBSPOT_PROVIDER_NAME))`.
- Config resolver: `apps/api/src/lib/config-resolver.ts` scopes all `provider_config` and `llm_config` lookups by `tenantId` in both the DB query and the in-memory cache key.

### 2.3 Cache keys

In-memory caches that sit in front of tenant-owned data ALWAYS embed `tenantId` in the key. This is enforced in:

- `apps/api/src/services/eligibility.ts` — `buildCacheKey(tenantId, companyId, propertyName)`.
- `apps/api/src/lib/config-resolver.ts` — `${tenantId}:provider:${providerName}` and `${tenantId}:llm`.

Cross-tenant tests (`apps/api/src/__tests__/cross-tenant.test.ts`) assert that these caches never return tenant B's result for a tenant A key.

---

## 3. Encryption (V1 stub + Slice 2 plan)

### 3.1 V1 (Slice 1)

`apps/api/src/lib/encryption.ts` exposes `encryptProviderKey(tenantId, plaintext)` and `decryptProviderKey(tenantId, ciphertext)`.

V1 encoding is `base64("<tenantId>:<plaintext>")`. This is NOT cryptographically secure. Its purposes are:

1. Keep plaintext provider secrets out of logs and database dumps by accident.
2. Enforce **tenant binding at the interface level** — `decryptProviderKey(tenantB, ciphertextIssuedForTenantA)` throws `Error('decryption: tenant mismatch')`. This prevents cross-tenant key reuse even before real crypto lands.
3. Keep the string-in / string-out contract stable so Slice 2 can swap in real crypto without touching callers.

The `@todo Slice 2` markers on `encryptProviderKey` and `decryptProviderKey` track the replacement.

### 3.2 Slice 2 plan

- AES-256-GCM for at-rest encryption of `api_key_encrypted` columns in `provider_config` and `llm_config`.
- Envelope encryption: each tenant gets a tenant-derived KEK (key-encryption key) via KDF (HKDF-SHA256) from a root KMS key plus `tenantId` as context. Per-secret DEKs (data-encryption keys) are wrapped by the tenant KEK.
- Root KMS key lives outside the application process — AWS KMS / GCP KMS / HashiCorp Vault / Supabase Vault depending on deployment target. Application code never sees the raw root key.
- Ciphertext format: `v2:<kekVersion>:<iv>:<authTag>:<dekCiphertext>:<payloadCiphertext>`. Versioned so future rotation is a bump in the prefix.

### 3.3 Why tenant binding even at the stub

The stub's `tenantId` prefix is load-bearing. If Slice 2 swaps in AES-256-GCM tomorrow, callers expect `decryptProviderKey(tenantB, A)` to throw — the tenant-mismatch semantics are part of the contract, not an encryption detail. Tests in `encryption.test.ts` and `cross-tenant.test.ts` lock this in.

---

## 4. Authentication Flow

### 4.1 V1

Bearer token in `Authorization` header.

- Production: token resolved against `API_TOKENS` env var (`token:portal` mapping). One token per portal; no shared credentials.
- Test (`NODE_ENV === 'test'`): any non-empty bearer is accepted; portal read from `x-test-portal-id` (default `test-portal`). Bypass is environment-gated.

### 4.2 Slice 2

Real HubSpot private-app token validation:

- Verify signature against HubSpot's public keyset.
- Verify `portal_id` claim matches the tenant row (defense in depth against token injection).
- Short-lived exchange for downstream backend session, revocable per-install.
- Support token rotation without downtime (multi-active tokens in `API_TOKENS`-equivalent store).

---

## 5. Data Minimization

V1 rules applied by adapters and services:

- **Adapters do not log evidence content.** `mock-signal-adapter.ts` returns `Evidence[]` but never `console.log`s bodies. Slice 2 real adapters inherit this rule as part of their contract (see `provider-adapter.ts` interface comment).
- **LLM prompts are template-based in V1.** `reason-generator.ts` composes the reason text from a structured template rather than concatenating raw evidence into a free-form prompt — limits accidental PII inclusion. Slice 2 will add explicit PII scrubbing plus allow-listed evidence fields before any content crosses a provider boundary.
- **Restricted evidence is stripped before it reaches any downstream stage.** `apps/api/src/services/trust.ts` `applySuppression` removes `isRestricted: true` rows entirely — no id, source, content, count, or warning derived from a restricted row propagates. The only residual signal is `stateFlags.restricted = true`. The snapshot assembler (`snapshot-assembler.ts`) additionally short-circuits the rest of the pipeline the moment `stateFlags.restricted` is set, so no reason, no people, and no trust score is computed.

---

## 6. Cross-Tenant Test Coverage

`apps/api/src/__tests__/cross-tenant.test.ts` exercises isolation at every boundary. Each test proves one specific guarantee:

1. **DB query scoped by tenant A never returns tenant B rows.** Inserts snapshots, evidence, people under both tenants; asserts tenant-scoped `select` returns only A's rows.
2. **`provider_config` isolation.** Inserts per-tenant configs; asserts a tenant-scoped select for B never returns A's row (even for the same provider name).
3. **`decryptProviderKey(tenantA, ciphertextForB)` throws.** Locks in the tenant-mismatch contract even at the stub level.
4. **Eligibility cache is tenant-isolated.** Warms A's cache with an "eligible" result, then calls with tenant B and a fetcher that would return "ineligible" — asserts B gets its own result, not A's.
5. **Config-resolver cache is tenant-isolated.** Same shape as (4) for `getProviderConfig` and `getLlmConfig` over `provider_config` / `llm_config`.
6. **Snapshot route tenantId is middleware-sourced, not body-sourced.** POSTs with a body that attempts to spoof `tenantId` — asserts the response carries the middleware-resolved tenantId.
7. **Restricted suppression isolation.** Tenant A's fixture includes a restricted row; response for A is explicitly empty with `stateFlags.restricted = true` AND `tenantId = A`. Tenant B's request in the same test run returns B's own snapshot — not A's cached empty response. This proves restricted-state responses do not leak across tenants via any cache or memo layer.

---

## 7. Threat Model (STRIDE Summary)

| Category               | V1 surface                                                | Mitigation                                                                                                                                                                                        |
| ---------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spoofing               | Anyone can hit `/api/*` with a crafted bearer.            | Config-driven token-to-portal map (`API_TOKENS`). 401 on unknown token. Slice 2 adds HubSpot signature verification.                                                                              |
| Tampering              | Request body can carry a fake `tenantId`.                 | Routes never read `tenantId` from body/path; always from `c.get('tenantId')` set by middleware. Assembler re-stamps evidence with middleware id.                                                  |
| Repudiation            | No server-side audit log in V1.                           | Deferred to Slice 2 (append-only `audit_log` table, per-tenant). Noted here so it's not forgotten.                                                                                                |
| Information disclosure | Cross-tenant data leak via query or cache.                | `tenant_id NOT NULL` on every owned table; every query `and(eq(table.tenantId, ctx.tenantId))`; every cache key prefixed by `tenantId`; restricted suppression short-circuits the whole pipeline. |
| Denial of service      | Unbounded fetcher calls / cache growth.                   | Fetchers are injectable and test-bounded. In-memory caches have 5-min TTL. No unbounded loops in the V1 pipeline. Rate limiting is Slice 2.                                                       |
| Elevation of privilege | A tenant installs the app, gets access to another tenant. | Tenant resolution is DB-bound by `hubspot_portal_id`; no shared admin token path in V1.                                                                                                           |

---

## 8. V1 Compliance Checklist

- [x] Per-tenant API keys. No shared LLM provider credential.
- [x] Per-tenant LLM provider / model selection via `llm_config`.
- [x] Tenant isolation verified at DB, middleware, cache, adapter, and response layers (cross-tenant.test.ts).
- [x] Restricted evidence produces explicit empty response with zero leak (trust.ts + snapshot-assembler.ts + cross-tenant.test.ts).
- [x] No silent CRM writes (V1 writes nothing to HubSpot).
- [x] No hardcoded provider logic or thresholds — all resolved from `provider_config` / `llm_config` / tenant `settings`.
- [x] Config-resolver and eligibility caches TTL-bounded and tenant-scoped.
- [x] `Slice 2` markers present on every deferred security surface (encryption, auth, real adapters).

---

## 9. Slice 2 — Deferred Items

The following are explicitly out of scope for Slice 1. Each has a matching `@todo Slice 2` marker in code:

1. **Real encryption**: AES-256-GCM + tenant-derived KEK envelope encryption in `apps/api/src/lib/encryption.ts`.
2. **Real auth**: HubSpot private-app token signature + claim verification in `apps/api/src/middleware/auth.ts`.
3. **Real provider adapters**: Exa, HubSpot enrichment, news — plug into `ProviderAdapter` interface (`apps/api/src/adapters/provider-adapter.ts`). Mock-only in V1.
4. **Real LLM adapters**: Anthropic, OpenAI, Gemini, OpenRouter, custom OpenAI-compatible endpoints — plug into `LlmAdapter` interface (`apps/api/src/adapters/llm-adapter.ts`). Mock-only in V1.
5. **Provider-specific source allow-lists and blocklists** in `apps/api/src/services/trust.ts`.
6. **Audit logging**: append-only `audit_log` table, tenant-scoped, for all state-changing operations.
7. **Rate limiting**: per-tenant request quotas.
8. **PII scrubbing** before any evidence content crosses an LLM provider boundary.
9. **Config-resolver distributed cache**: swap in-memory Map for Redis / Supabase LISTEN-NOTIFY in multi-instance deployments.

---

## 10. Local Development & Docker

`docker-compose.yml` runs Postgres 16 on host port `5433` (remapped from the container's `5432`) to avoid conflicts with a host-installed Postgres. This remap is intentional; see commit `cea2a8f`.

Cross-tenant tests do NOT rely on a seed init SQL file. The Postgres official image only runs `/docker-entrypoint-initdb.d/*.sql` on first start (empty data dir), which is unreliable for a volume that persists across `docker compose down`. Instead, each test file creates its own isolated tenants with a unique `PORTAL_PREFIX` per run and cleans them up via `beforeEach` + FK cascades. This pattern is already used in `tenant.test.ts`, `snapshot-route.test.ts`, and the new `cross-tenant.test.ts`.

---

## 11. Migration

Slice 1 used a base64 encryption stub for `provider_config.api_key_encrypted` and `llm_config.api_key_encrypted`. Those rows existed only in dev/test fixtures. Slice 2 introduces AES-256-GCM (Step 3) and DOES NOT migrate any pre-existing ciphertext — dev/test rows are wiped and reseeded with proper ciphertext during Step 3's test setup. Production deployments do not yet hold any provider credentials, so there is no production migration path. If a Slice 1 environment somehow contains real ciphertext, it must be re-issued: rotate the provider key with the upstream provider, then write the new key through the Slice 2 encryption.

### Slice 2 Step 2 schema additions

Migration `packages/db/drizzle/0003_broad_ben_urich.sql` adds four columns to both `provider_config` and `llm_config`:

- `key_version integer NOT NULL DEFAULT 1` — rotation counter for the upcoming AES-256-GCM envelope (`v{N}:iv:tag:payload`).
- `rate_limit_config jsonb` (nullable) — per-tenant rate-limit shape owned by callers.
- `allow_list jsonb` (nullable) — permitted source identifiers/hostnames.
- `block_list jsonb` (nullable) — denied source identifiers/hostnames.

Existing rows get `key_version=1` automatically. The three jsonb columns are nullable with no backfill, preserving the Slice 1 "feature off unless configured" semantics.

---

## 12. Key Management (Slice 2 Step 3)

### 12.1 Envelope format

Every ciphertext written by `apps/api/src/lib/encryption.ts` uses the format:

```text
v{KEY_VERSION}:{iv}:{tag}:{ciphertext}
```

- The leading `v{KEY_VERSION}` is a literal `v` followed by a decimal
  integer (current: `1`) — NOT base64url. Only `iv`, `tag`, and
  `ciphertext` are base64url-encoded (RFC 4648 §5, no padding).
- `iv` is **12 random bytes** (GCM standard; generated per call via `crypto.randomBytes`).
- `iv` is **12 random bytes** (GCM standard; generated per call via `crypto.randomBytes`).
- `tag` is the **16-byte** AES-GCM authentication tag.
- `ciphertext` is AES-256-GCM of the UTF-8 plaintext.

Example shape (not a real secret): `v1:xBc8qK2mN5p0RtYu:AaBbCcDdEeFfGgHhIiJjKk:ZnVuY3Rpb25rZXlfMTIz`.

The envelope is parsed defensively: any input with fewer than 4 colon-separated parts, a missing `v` prefix, a wrong IV length, a wrong tag length, or an unknown key version is rejected before any crypto runs.

### 12.2 KEK derivation (HKDF-SHA256)

Per-tenant Key Encryption Keys are derived at each encrypt/decrypt call:

```text
tenantKek = HKDF-SHA256(
  ikm    = ROOT_KEK,                // 32 raw bytes from env
  salt   = "hap-tenant-kek-v1",     // constant per-app namespace
  info   = tenantId,                // raw UTF-8 tenant UUID
  length = 32,                      // AES-256 key
)
```

Implementation: `apps/api/src/lib/kek.ts` via Node's built-in `crypto.hkdfSync`. The salt is a constant namespace string — rotation is performed by bumping it (see §12.4) and adding a new envelope version. The `info` field carries the tenantId so that tenant A's KEK is cryptographically distinct from tenant B's KEK by construction; no caller has to remember to attach the tenantId as AAD.

`deriveTenantKek` is an **internal primitive**: it is not exported from any package barrel. The only legitimate caller is `encryption.ts`. Leaking a tenant KEK to other modules would defeat per-tenant key separation.

### 12.3 `ROOT_KEK` storage

- **Format**: exactly 32 random bytes, base64-encoded (not base64url) to fit `.env` line semantics.
- **Generation**: `openssl rand -base64 32` (run once per environment).
- **Location**: `.env` (gitignored) for local dev; deploy-time secret storage (e.g. Vercel/Render env vars, AWS Secrets Manager, GCP Secret Manager, Supabase Vault) for staging and production.
- **Validation**: enforced at boot by `packages/config/src/env.ts` (`loadEnv()`): the Zod schema decodes the base64 and requires exactly 32 bytes. A misconfigured env fails fast at the first `encryptProviderKey` / `decryptProviderKey` call — we never silently fall back to a weaker key.
- **Rotation of `ROOT_KEK` itself** is equivalent to a full re-encryption migration (see §12.4); plan for it with the same rollover procedure.

### 12.4 Rotation plan

Rotation is a **version bump**, not an in-place mutation. Procedure:

1. Introduce a new `KEY_VERSION` constant (e.g. `2`) in `encryption.ts`. Choose the new parameters that differ — typically either:
   - a new HKDF `salt` (e.g. `hap-tenant-kek-v2`), or
   - a new `ROOT_KEK` value, or
   - both.
2. Add `2` to `SUPPORTED_VERSIONS`. `decryptProviderKey` now accepts **both** `v1:` and `v2:` envelopes; `encryptProviderKey` writes only `v2:`.
3. Write a migration script that reads every `provider_config` / `llm_config` row with `key_version=1`, calls `decryptProviderKey` (reads the v1 envelope), then `encryptProviderKey` (writes a v2 envelope), and updates `key_version=2`. The `key_version` column on those tables (added in Step 2) exists for exactly this bookkeeping.
4. Once the migration is verified (count of `key_version=1` rows is zero and a random sample round-trips), remove `1` from `SUPPORTED_VERSIONS`. `decryptProviderKey` now rejects legacy envelopes with `unknown key version`.

The envelope prefix makes mixed-version state observable at all times: an operator can `SELECT key_version, count(*) FROM provider_config GROUP BY 1` to watch the migration progress.

**Slice 1 legacy**: Slice 1 shipped a base64 stub (`base64("<tenantId>:<plaintext>")`) with no envelope prefix. Step 3 intentionally does **NOT** accept those strings on decrypt; see §11 for the data-migration boundary. A test in `apps/api/src/lib/__tests__/encryption.test.ts` (`rejects Slice 1 base64 ciphertext`) locks this contract in.

### 12.5 Audit trail

Encryption and decryption errors are structured exceptions, not console side-effects. Callers that log them (today: none in Slice 1; Slice 2 routes/middleware will) must log the **caller's tenantId** (i.e. the `tenantId` passed to `decryptProviderKey`), **not** any fragment of the ciphertext or any parsed plaintext. This makes cross-tenant decrypt attempts visible in logs — tenant B reading tenant A's ciphertext fails with `decryption: authentication failed`, and the log line ties the failed attempt to tenant B's context.

Error messages are deliberately opaque: they never include the tenantId of either party, the envelope version, the IV, or any plaintext fragment. Tests (`encryption.test.ts` "rejects ciphertext encrypted under a different tenant") assert this non-leak property explicitly.

---

## 13. HubSpot Auth (Slice 2 Step 4)

Slice 2 replaces the Slice 1 bearer-token middleware (`API_TOKENS` env map) with HubSpot's v3 request-signature verification. The new middleware lives in `apps/api/src/middleware/hubspot-signature.ts`; `apps/api/src/middleware/auth.ts` re-exports it as `authMiddleware` so existing imports remain stable.

### 13.1 Signature spec

Re-verified against HubSpot's official docs on 2026-04-15 via Context7 (`/websites/developers_hubspot`):

- Source: https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/request-validation
- Source: https://developers.hubspot.com/docs/apps/developer-platform/add-features/ui-extensions/fetching-data

| Field                   | Value                                                                    |
| ----------------------- | ------------------------------------------------------------------------ |
| Signature header        | `X-HubSpot-Signature-v3`                                                 |
| Timestamp header        | `X-HubSpot-Request-Timestamp` (ms since epoch)                           |
| HMAC input (raw string) | `method + decodeURIComponent(uri) + body + timestamp`                    |
| HMAC algorithm          | HMAC-SHA256 using `HUBSPOT_CLIENT_SECRET` as the key                     |
| Encoding                | Base64 (standard, not URL-safe)                                          |
| Freshness window        | 5 minutes (`300000 ms`). Reject if `Math.abs(now − timestamp) > 300000`. |
| Comparison              | `crypto.timingSafeEqual` over equal-length buffers                       |

The raw `uri` used for hashing matches Hono's `c.req.url`, which already includes protocol + host + path + query, in line with HubSpot's reference Node.js implementation (`https://${hostname}${url}`).

### 13.2 Principal extraction

`portalId` and `userId` come from the signed payload — never from arbitrary headers:

- POST/PUT/PATCH: top-level `portalId` / `userId` fields on the JSON body.
- GET/DELETE: `portalId` / `userId` query-string parameters.

If `portalId` is missing, the request is rejected with 401. The downstream `tenantMiddleware` resolves the portal to an internal `tenantId` via the `tenants` table; unknown portals also produce 401.

### 13.3 Test bypass (defense in depth)

A `x-test-portal-id` header (and optional `x-test-user-id`) short-circuits signature verification — but ONLY when BOTH of the following are true:

- `process.env.NODE_ENV === "test"`
- `process.env.ALLOW_TEST_AUTH === "true"`

If either gate is absent, the bypass header is ignored and the request is rejected as unauthorized. `.env.test.local` sets `ALLOW_TEST_AUTH=true` for local tests; no deployed environment (staging, production) sets it.

### 13.4 Threat-model coverage (what the tests assert)

`apps/api/src/middleware/__tests__/hubspot-signature.test.ts` locks these in:

| Scenario                                                     | Expected                        |
| ------------------------------------------------------------ | ------------------------------- |
| Valid signature + current timestamp + known portal           | 200, `tenantId` populated       |
| Missing signature or timestamp header                        | 401                             |
| Tampered body (HMAC mismatch)                                | 401                             |
| Stale timestamp (> 5 min)                                    | 401                             |
| Replayed request once timestamp goes stale                   | 401                             |
| Forged `portalId` (valid signature, portal not in `tenants`) | 401                             |
| Malformed timestamp header                                   | 401                             |
| Test bypass when `ALLOW_TEST_AUTH` unset                     | 401 (bypass denied)             |
| Test bypass when `NODE_ENV=production`                       | 401 (bypass denied)             |
| Error logs never contain secret / signature / body           | asserted via `console.warn` spy |

### 13.5 Failure logging

`logAuthFailure()` writes a short `console.warn` line containing only the failure reason (`"signature mismatch"`, `"stale timestamp"`, etc). It NEVER includes the client secret, the presented signature, or the request body. Tests assert that a raw payload marker does not appear in any logged output.

---

## 14. Server-to-HubSpot Credential (Slice 2 Step 4)

The backend makes authenticated calls to HubSpot's CRM v3 API — today only from the adapters wired in Slice 2 Step 9 (company/contact enrichment). Those calls use a backend-only credential; no token flows through the inbound request.

### 14.1 Credential model (Slice 2)

- **Type**: HubSpot **Private App Access Token**, provisioned at the Slice 2 test portal (`147062576`) → Settings → Integrations → Private Apps.
- **Env var**: `HUBSPOT_DEV_PORTAL_TOKEN` (optional per `packages/config/src/env.ts`; required by Step 9 onward).
- **Required scopes (Slice 2)**:
  - `crm.objects.companies.read`
  - `crm.objects.contacts.read`
  - Seed-script steps that provision mock fixtures (Step 14) may require additional write scopes — Step 14 will document the delta in place.
- **Storage**: `.env` (gitignored) for local dev; deploy-time secret storage (Vercel / Render / AWS Secrets Manager / GCP Secret Manager / Supabase Vault) for staging and production. Never committed, never echoed to logs, never exposed to the UI extension.

### 14.2 Client class

`apps/api/src/lib/hubspot-client.ts` exposes a `HubSpotClient` class:

- Constructor reads `HUBSPOT_DEV_PORTAL_TOKEN` via `loadEnv()`. Throws if missing — Slice 2 Steps 4–8 never instantiate the client; Step 9 does, and missing credentials fail loudly at that point rather than silently bypassing enrichment.
- `getCompanyProperties(companyId, properties[])` hits `GET https://api.hubapi.com/crm/v3/objects/companies/{id}` with `Authorization: Bearer <token>`. Errors are surfaced as `hubspot: <status> <statusText>` — the token is never included in the error message.

### 14.3 OAuth (Slice 3+)

Marketplace distribution (multiple installing portals, per-install token storage) requires the OAuth 2.0 authorization-code flow plus refresh-token rotation. That is explicitly deferred to Slice 3; a `@todo Slice 3` JSDoc note on `HubSpotClient` tracks it.

## 15. Phase 1 Security Audit (Slice 2 Step 5)

Independent review of commits `9fbccc5` (provider config + env validator), `2b47c9d` (AES-256-GCM + KEK), `b3c63d7` (HubSpot signed-request auth) by the `security-auditor` agent.

**Verdict: PASS WITH 4 ADVISORIES.** All ten threat-model items (key leakage, AES-GCM correctness, HKDF correctness, signature verification, test-bypass safety, cross-tenant isolation, forged portal_id, replay attacks, server-to-HubSpot credential handling, documentation) returned PASS. No blocking findings. Phase 2 (Steps 6-7 platform infrastructure, Steps 8-10 live adapters, Steps 11-14 application + UX) cleared to proceed.

### 15.1 Advisory dispositions

- **A1 — Replay window within freshness bound** (`hubspot-signature.ts`). Within the 5-minute freshness window the same `(body, signature, timestamp)` triple can be replayed. Defense-in-depth fix is a nonce store with 5-minute TTL keyed on the signature hash. **Disposition:** `@todo Slice 3` marker added at the freshness constant; Slice 3 wires Redis-backed nonce tracking on top of the Step 6 cache adapter.
- **A2 — `HubSpotClient` token validation deferred to first call** (`hubspot-client.ts`). Missing `HUBSPOT_DEV_PORTAL_TOKEN` throws only when the class is first instantiated. **Disposition:** `@todo Slice 3` marker added at the class declaration; Step 9 (Exa + HubSpot signal adapters) adds a startup health-check that instantiates the client once, surfacing missing credentials at process start.
- **A3 — `safeEquals` unequal-length branch timing** (`hubspot-signature.ts`). When the inbound and expected signatures differ in length, the implementation runs `timingSafeEqual` against a zero-padded buffer sized to the inbound (attacker-controlled) length. The branch is distinguishable in wall time from the equal-length path but does not leak the expected signature — the expected length is the public 44-char base64 of SHA-256, and the timing reveals only the length the attacker already supplied. Risk is low and bounded; documented here for future readers.
- **A4 — HKDF salt as plaintext constant** (`kek.ts`). The salt `"hap-tenant-kek-v1"` is a correct design choice per RFC 5869 (HKDF salt is non-secret; per-tenant binding lives in `info`). Recorded so a future reviewer does not "fix" it to a random or per-tenant salt — that change would invalidate every existing ciphertext. An invariant comment was added at the constant declaration.

### 15.2 Acceptance criteria for Phase 2 entry

- Slice 1 + Phase 1 tests green: 269 passing, 0 lint, 0 typecheck. ✅
- All four advisory dispositions either applied (A2, A3, A4) or scheduled as Slice 3 work (A1). ✅
- This audit section appended to `SECURITY.md`. ✅

Phase 2 may proceed.

## 16. Slice 3 Auth Migration — `static + private` → `oauth + marketplace`

### 16.1 Current state (Slice 2 shipped)

Slice 2's HubSpot developer app is configured `auth.type: "static"`, `distribution: "private"` — a single-portal app installable ONLY on the dev portal that created it (`man-digital-development [dev account] 146425426`). Server-to-HubSpot calls (Step 9 enrichment adapter + Step 14 seed script) read a long-lived token from the env var `HUBSPOT_DEV_PORTAL_TOKEN`. This is a **dev-only bridge**, not the production auth model.

Verified limitations (HubSpot docs + Exa research, 2026-04-15):

- `auth.type: "static"` + `distribution: "private"` cannot be installed on any portal other than the dev portal. HubSpot docs verbatim: "used when you want to limit your app distribution to a single authorized account only."
- Legacy private apps (`Settings → Integrations → Private Apps`) are a separate, older model, being superseded by the Developer Platform. They are also single-portal by design.
- For any-portal install the app must be `auth.type: "oauth"` with `distribution: "marketplace"` (public, unlimited installs post-listing; cap 25 pre-listing) OR `distribution: "private"` + OAuth (allowlist, max 10 installs — 100 for Solution Partners).

### 16.2 Target state (Slice 3 delivers)

- `apps/hubspot-project/src/app/app-hsmeta.json`: `auth.type: "oauth"`, `distribution: "marketplace"` (or `"private"` with allowlist for pilot), add `redirectUrls` pointing at the installed-app OAuth callback on the API origin.
- New API endpoints: `GET /oauth/install` (redirects to HubSpot's authorize URL with `client_id`, scopes, `redirect_uri`) and `GET /oauth/callback` (receives `code`, exchanges for `access_token` + `refresh_token` via `POST https://api.hubspot.com/oauth/2026-03/token`, stores tokens encrypted per-tenant).
- New DB column(s) on `tenants` (or a sibling `tenant_hubspot_oauth` table): encrypted `hubspot_access_token`, encrypted `hubspot_refresh_token`, `access_token_expires_at`, `hub_id`, `scopes[]`. Encryption uses the Slice 2 AES-256-GCM envelope (Step 3) — infrastructure is already in place.
- `apps/api/src/lib/hubspot-client.ts` refactor: constructor takes a `tenantId`, reads the per-tenant access_token from DB, auto-refreshes on 401/expiry using the refresh_token, swaps the bearer header per request. `HUBSPOT_DEV_PORTAL_TOKEN` env var is retired.
- `scripts/seed-hubspot-test-portal.ts`: user first installs the app into their test portal via the install flow (one-click on HubSpot's side); seed script then reads the stored tenant token and proceeds. No env-variable token path.
- `packages/config/src/env.ts`: `HUBSPOT_DEV_PORTAL_TOKEN` removed from the schema. `HUBSPOT_CLIENT_ID` + `HUBSPOT_CLIENT_SECRET` stay (they drive OAuth + the existing Step 4 signed-request verification).

**OAuth state tradeoff (accepted for Slice 3):**

- OAuth `state` is a **stateless HMAC** over a short-lived payload (for example `nonce + expiresAt`) using `HUBSPOT_CLIENT_SECRET`.
- This provides **tamper detection + expiry enforcement**, which is the CSRF property Slice 3 requires.
- It does **not** provide single-use replay detection for an intercepted but still-unexpired `state` value, because there is no server-side nonce store.
- That gap is **accepted for Slice 3** and must be called out explicitly in tests and review: do not write tests that assert single-use replay rejection for OAuth `state` unless the implementation also introduces persistent nonce tracking.
- If single-use replay becomes a product or audit requirement, the mitigation is a dedicated `oauth_state_nonce` table (or equivalent bounded nonce store) in a later slice.

### 16.3 Why this is Slice 3, not Slice 2

- The OAuth install flow is a sizable architectural piece on its own — endpoints, redirect handling, state+CSRF, refresh-token rotation, DB schema, error UX.
- The Slice 2 security foundation (AES-256-GCM envelope, per-tenant encryption, `tenants` table with FK cascades, config-resolver caching, HubSpot signature verification for the extension→backend direction) is ALREADY correct for multi-tenant. The migration is a different TOKEN SOURCE, not a rewrite.
- `hubspot-signature.ts` (Step 4) is unchanged by this migration — it verifies extension→backend requests using `HUBSPOT_CLIENT_SECRET`, which is the same in both auth models.
- Slice 2 with `static + private` gives a working single-portal test harness for validating domain logic (hygiene, drill-in, next-move, trust evaluation, cross-tenant isolation at the DB + factory layer) BEFORE pivoting auth.

### 16.4 Migration checklist (Slice 3)

- [ ] `app-hsmeta.json`: swap `auth.type` to `"oauth"`, add `redirectUrls`, pick `distribution` (`"marketplace"` for public, `"private"` for pilot/allowlist).
- [ ] Re-upload the project via `pnpm tsx scripts/hs-project-upload.ts`. HubSpot provisions the OAuth config (same `client_id`/`client_secret`).
- [ ] Add DB migration: `tenants.hubspot_access_token_encrypted`, `tenants.hubspot_refresh_token_encrypted`, `tenants.hubspot_token_expires_at`, `tenants.hubspot_hub_id`, `tenants.hubspot_scopes`. (Or a sibling table if we want a 1:many relation for multi-install-per-tenant scenarios.)
- [ ] `GET /oauth/install` endpoint — builds HubSpot authorize URL with state (CSRF-signed via the Slice 2 `HUBSPOT_CLIENT_SECRET`), redirects.
- [ ] `GET /oauth/callback` endpoint — verifies state for tampering + expiry, calls HubSpot token exchange, encrypts + stores per-tenant, redirects to a success page.
- [ ] `hubspot-client.ts` refactor as above. Tests updated.
- [ ] `seed-hubspot-test-portal.ts` refactor to use post-install tenant token. Tests updated.
- [ ] Remove `HUBSPOT_DEV_PORTAL_TOKEN` from `.env.example`, the Zod validator, and `docs/qa/slice-2-walkthrough.md`.
- [ ] New cross-tenant isolation tests: token refresh does not leak across tenants; token exchange errors do not leak codes/secrets to logs.
- [ ] New security audit pass covering OAuth flow (CSRF, token storage, refresh race conditions, 401 loops).

### 16.5 Acceptance criteria for completing the migration

- Two tenants can install the app into two different HubSpot portals and use it independently. Cross-tenant tests prove isolation at both the DB and the HubSpot-client levels.
- `HUBSPOT_DEV_PORTAL_TOKEN` grep returns zero hits in `apps/`, `packages/`, and `scripts/`.
- OAuth `state` tests prove tampering + expiry rejection. Single-use replay of an unexpired state is explicitly documented as out of scope for the stateless Slice 3 design.
- Security audit PASS on the OAuth flow.
- Deployable to `distribution: "marketplace"` (listing submission is a separate business step, but the CODE is ready for it).
