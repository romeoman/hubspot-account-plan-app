/**
 * Provider-key encryption — AES-256-GCM with a tenant-derived KEK.
 *
 * Envelope format (colon-separated, all segments base64url):
 *   v{KEY_VERSION}:{iv}:{tag}:{ciphertext}
 *
 *   - `v1`      — current envelope version. Rotation bumps this.
 *   - `iv`      — 12 random bytes per encryption (GCM standard).
 *   - `tag`     — 16-byte GCM authentication tag.
 *   - `ciphertext` — AES-256-GCM ciphertext of the UTF-8 plaintext.
 *
 * Tenant binding is structural: the KEK is derived from `(ROOT_KEK, tenantId)`
 * via HKDF-SHA256 ({@link deriveTenantKek}). A ciphertext produced for tenant
 * A cannot be decrypted by tenant B — GCM's tag will not verify under B's
 * KEK, and `createDecipheriv.final()` throws. We propagate that as a generic
 * "authentication failed" error without leaking plaintext fragments, the
 * tenantId of either party, or the ciphertext envelope.
 *
 * Public API (stable across Slice 1 → Slice 2):
 *   - `encryptProviderKey(tenantId, plaintext) -> ciphertext`
 *   - `decryptProviderKey(tenantId, ciphertext) -> plaintext`
 *
 * Rotation: when the key-derivation parameters change (salt, HKDF family,
 * root key), introduce a new `KEY_VERSION` constant and accept both in
 * `decryptProviderKey` during the rollover. See
 * `docs/security/SECURITY.md` §Key Management.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { loadEnv } from "@hap/config";
import { deriveTenantKek } from "./kek.js";

/** Current envelope version. Bump on rotation; `decryptProviderKey` accepts
 * all versions known to this module. */
const KEY_VERSION = 1;
const SUPPORTED_VERSIONS: ReadonlySet<number> = new Set([KEY_VERSION]);

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Lazily-resolved 32-byte root KEK. Resolved on first use to avoid crashing
 * import-time for tooling that doesn't need encryption (e.g. typegen scripts).
 * Once resolved, cached for the process lifetime — the env is immutable.
 */
let rootKekCache: Buffer | null = null;
function getRootKek(): Buffer {
  if (rootKekCache) return rootKekCache;
  const env = loadEnv();
  // env.ROOT_KEK is validated as base64 → 32 bytes by the Zod schema, but we
  // re-decode here rather than trust a length assumption.
  const buf = Buffer.from(env.ROOT_KEK, "base64");
  if (buf.length !== 32) {
    throw new Error("encryption: ROOT_KEK must decode to 32 bytes");
  }
  rootKekCache = buf;
  return buf;
}

/**
 * TEST-ONLY hook to clear the cached ROOT_KEK (so a test that mutates
 * process.env.ROOT_KEK can force a re-read). Not exported from the package.
 * @internal
 */
export function __resetEncryptionCacheForTests(): void {
  rootKekCache = null;
}

/**
 * Encrypt a plaintext secret for a specific tenant.
 *
 * @param tenantId - tenant UUID that owns the secret. Binds the ciphertext
 *   to this tenant via HKDF; a different tenantId will not decrypt it.
 * @param plaintext - UTF-8 string to encrypt. Empty strings are allowed.
 * @returns `v1:{iv}:{tag}:{ciphertext}` envelope, all base64url.
 */
export function encryptProviderKey(tenantId: string, plaintext: string): string {
  const kek = deriveTenantKek(getRootKek(), tenantId);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    `v${KEY_VERSION}`,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

/**
 * Decrypt a ciphertext produced by {@link encryptProviderKey}.
 *
 * @param tenantId - tenant UUID expected to own the ciphertext. MUST match
 *   the tenantId used at encryption time; otherwise the GCM tag will not
 *   verify and this throws.
 * @param ciphertext - `v{N}:{iv}:{tag}:{ciphertext}` envelope.
 * @throws on malformed envelope, unknown key version, or authentication
 *   failure (wrong tenant / tampered bytes / Slice 1 legacy). Errors do NOT
 *   leak plaintext fragments, tenantIds, or the offending ciphertext.
 */
export function decryptProviderKey(tenantId: string, ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 4) {
    throw new Error("decryption: malformed ciphertext envelope");
  }
  const [versionTag, ivB64, tagB64, payloadB64] = parts as [string, string, string, string];

  const vMatch = versionTag.match(/^v(\d+)$/);
  if (!vMatch) {
    throw new Error("decryption: malformed ciphertext envelope");
  }
  const version = Number.parseInt(vMatch[1] as string, 10);
  if (!SUPPORTED_VERSIONS.has(version)) {
    throw new Error(`decryption: unknown key version (v${version})`);
  }

  let iv: Buffer;
  let tag: Buffer;
  let payload: Buffer;
  try {
    iv = Buffer.from(ivB64, "base64url");
    tag = Buffer.from(tagB64, "base64url");
    payload = Buffer.from(payloadB64, "base64url");
  } catch {
    throw new Error("decryption: malformed ciphertext envelope");
  }
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("decryption: malformed ciphertext envelope");
  }

  const kek = deriveTenantKek(getRootKek(), tenantId);
  const decipher = createDecipheriv("aes-256-gcm", kek, iv);
  decipher.setAuthTag(tag);
  try {
    const plain = Buffer.concat([decipher.update(payload), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    // Collapse all GCM failures to a single opaque message — do NOT include
    // the tenantId, the ciphertext, or any plaintext fragment.
    throw new Error("decryption: authentication failed");
  }
}
