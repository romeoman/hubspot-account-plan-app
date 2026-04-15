import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptProviderKey, encryptProviderKey } from "../lib/encryption";

describe("encryption stub (V1)", () => {
  it("roundtrips a plaintext provider key for the same tenant", () => {
    const tenantId = randomUUID();
    const plaintext = "sk-test-abc123";
    const ciphertext = encryptProviderKey(tenantId, plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(decryptProviderKey(tenantId, ciphertext)).toBe(plaintext);
  });

  it("throws when a different tenant attempts to decrypt another tenant's ciphertext (cross-tenant isolation)", () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const ciphertext = encryptProviderKey(tenantA, "super-secret");
    expect(() => decryptProviderKey(tenantB, ciphertext)).toThrow(/decryption: tenant mismatch/);
  });

  it("handles empty plaintext (roundtrip)", () => {
    const tenantId = randomUUID();
    const ciphertext = encryptProviderKey(tenantId, "");
    expect(decryptProviderKey(tenantId, ciphertext)).toBe("");
  });

  it("handles plaintext containing the delimiter ':' correctly", () => {
    const tenantId = randomUUID();
    const plaintext = "value:with:colons:and:more";
    const ciphertext = encryptProviderKey(tenantId, plaintext);
    expect(decryptProviderKey(tenantId, ciphertext)).toBe(plaintext);
  });

  it("throws on malformed ciphertext", () => {
    const tenantId = randomUUID();
    expect(() => decryptProviderKey(tenantId, "not-valid-base64-$$$")).toThrow();
  });
});
