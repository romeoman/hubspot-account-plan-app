import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptProviderKey, encryptProviderKey } from "../encryption";

/**
 * Decode a base64url segment to a Buffer (for test manipulation).
 */
function b64u(buf: Buffer): string {
  return buf.toString("base64url");
}

describe("encryption (AES-256-GCM, tenant-bound)", () => {
  it("roundtrips ASCII plaintext for the same tenant", () => {
    const tenantId = randomUUID();
    const plaintext = "sk-test-abc123";
    const ciphertext = encryptProviderKey(tenantId, plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(decryptProviderKey(tenantId, ciphertext)).toBe(plaintext);
  });

  it("roundtrips multi-byte UTF-8 plaintext", () => {
    const tenantId = randomUUID();
    const plaintext = "héllo 🔐 Ω key—with—unicode";
    const ciphertext = encryptProviderKey(tenantId, plaintext);
    expect(decryptProviderKey(tenantId, ciphertext)).toBe(plaintext);
  });

  it("roundtrips empty plaintext", () => {
    const tenantId = randomUUID();
    const ciphertext = encryptProviderKey(tenantId, "");
    expect(decryptProviderKey(tenantId, ciphertext)).toBe("");
  });

  it("ciphertext envelope starts with v1:", () => {
    const tenantId = randomUUID();
    const ciphertext = encryptProviderKey(tenantId, "secret");
    expect(ciphertext.startsWith("v1:")).toBe(true);
    // v{N}:iv:tag:payload — 4 segments
    expect(ciphertext.split(":").length).toBe(4);
  });

  it("generates a distinct ciphertext each call (fresh IV per encryption)", () => {
    const tenantId = randomUUID();
    const a = encryptProviderKey(tenantId, "same-plaintext");
    const b = encryptProviderKey(tenantId, "same-plaintext");
    expect(a).not.toBe(b);
    // But both decrypt to the same plaintext.
    expect(decryptProviderKey(tenantId, a)).toBe("same-plaintext");
    expect(decryptProviderKey(tenantId, b)).toBe("same-plaintext");
  });

  it("rejects ciphertext encrypted under a different tenant (GCM tag mismatch)", () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const ct = encryptProviderKey(tenantA, "super-secret");
    expect(() => decryptProviderKey(tenantB, ct)).toThrow();
    // Error must NOT leak the plaintext, nor the tenantId of the attacker/victim.
    try {
      decryptProviderKey(tenantB, ct);
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain("super-secret");
      expect(msg).not.toContain(tenantA);
      expect(msg).not.toContain(tenantB);
    }
  });

  it("rejects a tampered payload segment", () => {
    const tenantId = randomUUID();
    const ct = encryptProviderKey(tenantId, "payload-tamper");
    const parts = ct.split(":");
    const payload = Buffer.from(parts[3] as string, "base64url");
    // Flip one bit in the first byte of the payload.
    payload[0] = (payload[0] ?? 0) ^ 0x01;
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${b64u(payload)}`;
    expect(() => decryptProviderKey(tenantId, tampered)).toThrow();
  });

  it("rejects a tampered iv segment", () => {
    const tenantId = randomUUID();
    const ct = encryptProviderKey(tenantId, "iv-tamper");
    const parts = ct.split(":");
    const iv = Buffer.from(parts[1] as string, "base64url");
    iv[0] = (iv[0] ?? 0) ^ 0x01;
    const tampered = `${parts[0]}:${b64u(iv)}:${parts[2]}:${parts[3]}`;
    expect(() => decryptProviderKey(tenantId, tampered)).toThrow();
  });

  it("rejects a tampered auth tag segment", () => {
    const tenantId = randomUUID();
    const ct = encryptProviderKey(tenantId, "tag-tamper");
    const parts = ct.split(":");
    const tag = Buffer.from(parts[2] as string, "base64url");
    tag[0] = (tag[0] ?? 0) ^ 0x01;
    const tampered = `${parts[0]}:${parts[1]}:${b64u(tag)}:${parts[3]}`;
    expect(() => decryptProviderKey(tenantId, tampered)).toThrow();
  });

  it("rejects an unknown key version", () => {
    const tenantId = randomUUID();
    const ct = encryptProviderKey(tenantId, "unknown-version");
    const parts = ct.split(":");
    const bogus = `v9:${parts[1]}:${parts[2]}:${parts[3]}`;
    expect(() => decryptProviderKey(tenantId, bogus)).toThrow(/unknown key version/i);
  });

  it("rejects a malformed envelope with no v prefix", () => {
    const tenantId = randomUUID();
    expect(() => decryptProviderKey(tenantId, "nope:nope:nope:nope")).toThrow(/malformed/i);
  });

  it("rejects a malformed envelope missing segments", () => {
    const tenantId = randomUUID();
    expect(() => decryptProviderKey(tenantId, "v1:onlyone")).toThrow(/malformed/i);
    expect(() => decryptProviderKey(tenantId, "v1:a:b")).toThrow(/malformed/i);
  });

  it("rejects Slice 1 base64 ciphertext (intentional data-migration boundary)", () => {
    // Slice 1 encoded as base64("<tenantId>:<plaintext>").
    const tenantId = randomUUID();
    const sliceOne = Buffer.from(`${tenantId}:legacy-secret`, "utf8").toString("base64");
    expect(() => decryptProviderKey(tenantId, sliceOne)).toThrow();
  });

  it("rejects completely empty ciphertext", () => {
    const tenantId = randomUUID();
    expect(() => decryptProviderKey(tenantId, "")).toThrow(/malformed/i);
  });
});
