/**
 * Provider-key encryption (V1 stub).
 *
 * V1 uses a tenant-bound base64 encoding. This is NOT cryptographically
 * secure — its only purpose is to:
 *   1. Keep plaintext provider secrets out of logs and dumps by accident
 *   2. Prevent cross-tenant key swapping (tenant A's ciphertext cannot be
 *      decrypted under tenant B) — so the interface enforces tenant binding
 *      today and Slice 2 can swap in real crypto without breaking callers.
 *
 * The string-in / string-out contract (throws on failure) is stable: Slice 2
 * will replace this with AES-256-GCM using a tenant-derived KEK plus envelope
 * encryption.
 *
 * @todo Slice 2: replace with AES-256-GCM using tenant-derived KEK + envelope encryption. See docs/security/SECURITY.md (TBD).
 */

const DELIMITER = ":";

/**
 * Encrypt a provider key, tenant-bound.
 *
 * V1: returns `base64("<tenantId>:<plaintext>")`.
 *
 * @param tenantId - tenant UUID the secret belongs to
 * @param plaintext - provider key / secret
 * @returns ciphertext string (opaque — do not parse)
 * @todo Slice 2: replace with AES-256-GCM using tenant-derived KEK + envelope encryption. See docs/security/SECURITY.md (TBD).
 */
export function encryptProviderKey(tenantId: string, plaintext: string): string {
  const payload = `${tenantId}${DELIMITER}${plaintext}`;
  return Buffer.from(payload, "utf8").toString("base64");
}

/**
 * Decrypt a provider key, verifying tenant binding.
 *
 * V1: base64-decodes and verifies the `<tenantId>:` prefix matches the caller.
 * Throws `Error('decryption: tenant mismatch')` if the ciphertext was issued
 * for a different tenant. This prevents cross-tenant key reuse even at the
 * stub level.
 *
 * @param tenantId - tenant UUID expected to own the secret
 * @param ciphertext - string produced by {@link encryptProviderKey}
 * @returns plaintext
 * @throws on malformed ciphertext or tenant mismatch
 * @todo Slice 2: replace with AES-256-GCM using tenant-derived KEK + envelope encryption. See docs/security/SECURITY.md (TBD).
 */
export function decryptProviderKey(tenantId: string, ciphertext: string): string {
  let decoded: string;
  try {
    const buf = Buffer.from(ciphertext, "base64");
    // Reject inputs that don't round-trip cleanly as base64.
    if (buf.toString("base64").replace(/=+$/u, "") !== ciphertext.replace(/=+$/u, "")) {
      throw new Error("decryption: malformed ciphertext");
    }
    decoded = buf.toString("utf8");
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("decryption:")) throw err;
    throw new Error("decryption: malformed ciphertext");
  }

  const idx = decoded.indexOf(DELIMITER);
  if (idx < 0) {
    throw new Error("decryption: malformed ciphertext");
  }

  const embeddedTenant = decoded.slice(0, idx);
  const plaintext = decoded.slice(idx + DELIMITER.length);

  if (embeddedTenant !== tenantId) {
    throw new Error("decryption: tenant mismatch");
  }
  return plaintext;
}
