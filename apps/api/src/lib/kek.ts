/**
 * Tenant-scoped Key Encryption Key (KEK) derivation.
 *
 * INTERNAL-ONLY primitive. DO NOT export from any package barrel. The only
 * legitimate caller is `apps/api/src/lib/encryption.ts` — leaking the tenant
 * KEK to any other module defeats the purpose of per-tenant key separation.
 *
 * Algorithm: HKDF-SHA256(rootKek, salt, info=tenantId, length=32 bytes).
 *
 * Design choices:
 *  - `salt` is a fixed per-app namespace string (`hap-tenant-kek-v1`) rather
 *    than random or per-row. HKDF's salt primarily de-duplicates keys across
 *    protocols that share the same rootKek; we only use rootKek for one
 *    purpose (tenant KEK derivation) so a constant namespace is sufficient
 *    and gives us deterministic derivation (required: the same tenantId must
 *    always produce the same KEK so we can decrypt old ciphertext).
 *  - `info` is the raw tenantId. Per RFC 5869 `info` is the context-binding
 *    field — binding tenantId here means tenant A's KEK differs from tenant
 *    B's KEK by construction. No caller has to remember to pass the tenantId
 *    as AAD; the key itself IS tenant-scoped.
 *  - Rotation plan: bump the salt to `hap-tenant-kek-v2` (or change the
 *    HKDF parameters) and introduce a `v2` envelope in encryption.ts. See
 *    `docs/security/SECURITY.md` §Key Management.
 */

import { hkdfSync } from "node:crypto";

// HKDF salt is a deterministic per-app namespace constant — NOT a secret and
// NOT per-tenant. Per RFC 5869 it can be public; the per-tenant binding lives
// in the `info` parameter (the tenant ID). Do NOT change this to a random or
// per-tenant salt — that would break decryption of all existing ciphertext.
// Rotation is handled via key versioning (encryption.ts KEY_VERSION) and the
// `-v1` suffix here, NOT by changing the salt in place. See SECURITY.md §12.4.
const SALT = Buffer.from("hap-tenant-kek-v1");
const KEK_BYTES = 32;
const ROOT_KEK_BYTES = 32;

/**
 * Derive a 32-byte tenant-scoped KEK from the application root KEK.
 *
 * @param rootKek - 32 raw bytes (the decoded `ROOT_KEK` env var).
 * @param tenantId - non-empty tenant identifier (UUID in practice).
 * @returns 32-byte Buffer suitable as an AES-256 key.
 * @throws if rootKek is not exactly 32 bytes or tenantId is empty.
 * @internal Not exported from the package barrel. Callers outside
 *   `encryption.ts` must not use this — encrypt/decrypt are the public API.
 */
export function deriveTenantKek(rootKek: Buffer, tenantId: string): Buffer {
  if (rootKek.length !== ROOT_KEK_BYTES) {
    throw new Error(`deriveTenantKek: rootKek must be exactly ${ROOT_KEK_BYTES} bytes`);
  }
  if (tenantId.length === 0) {
    throw new Error("deriveTenantKek: tenantId must not be empty");
  }
  const info = Buffer.from(tenantId, "utf8");
  // `hkdfSync` returns an ArrayBuffer; wrap as Buffer for ergonomic equality
  // checks + downstream `createCipheriv` compatibility.
  const derived = hkdfSync("sha256", rootKek, SALT, info, KEK_BYTES);
  return Buffer.from(derived);
}
