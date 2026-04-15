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
