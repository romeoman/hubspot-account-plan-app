import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveTenantKek } from "../kek";

describe("deriveTenantKek (HKDF-SHA256)", () => {
  const rootKek = randomBytes(32);

  it("returns a 32-byte Buffer", () => {
    const kek = deriveTenantKek(rootKek, "tenant-a");
    expect(kek).toBeInstanceOf(Buffer);
    expect(kek.length).toBe(32);
  });

  it("is deterministic for the same (rootKek, tenantId)", () => {
    const a1 = deriveTenantKek(rootKek, "tenant-a");
    const a2 = deriveTenantKek(rootKek, "tenant-a");
    expect(a1.equals(a2)).toBe(true);
  });

  it("produces distinct keys for different tenant IDs", () => {
    const a = deriveTenantKek(rootKek, "tenant-a");
    const b = deriveTenantKek(rootKek, "tenant-b");
    expect(a.equals(b)).toBe(false);
  });

  it("produces distinct keys for different rootKek values", () => {
    const otherRoot = randomBytes(32);
    const a = deriveTenantKek(rootKek, "tenant-a");
    const b = deriveTenantKek(otherRoot, "tenant-a");
    expect(a.equals(b)).toBe(false);
  });

  it("throws when rootKek is shorter than 32 bytes", () => {
    expect(() => deriveTenantKek(randomBytes(31), "tenant-a")).toThrow(/32/);
  });

  it("throws when rootKek is longer than 32 bytes", () => {
    expect(() => deriveTenantKek(randomBytes(33), "tenant-a")).toThrow(/32/);
  });

  it("throws when tenantId is empty", () => {
    expect(() => deriveTenantKek(rootKek, "")).toThrow(/tenant/i);
  });
});
