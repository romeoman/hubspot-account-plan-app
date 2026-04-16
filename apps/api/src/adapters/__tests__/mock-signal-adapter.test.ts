import { describe, expect, it } from "vitest";
import { createMockSignalAdapter } from "../mock-signal-adapter";

describe("createMockSignalAdapter", () => {
  it("exposes a stable `name` property", () => {
    const adapter = createMockSignalAdapter();
    expect(adapter.name).toBe("mock-signal");
  });

  it("defaults to the 'strong' fixture", async () => {
    const adapter = createMockSignalAdapter();
    const ev = await adapter.fetchSignals("tenant-a", { companyId: "co-acme" });
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.every((e) => e.confidence >= 0.8)).toBe(true);
  });

  it("propagates the caller's tenantId onto every Evidence row", async () => {
    const adapter = createMockSignalAdapter({ fixture: "strong" });
    const ev = await adapter.fetchSignals("tenant-xyz", { companyId: "co-acme" });
    expect(ev.length).toBeGreaterThan(0);
    for (const row of ev) {
      expect(row.tenantId).toBe("tenant-xyz");
    }
  });

  it("returns an empty array for the 'empty' fixture", async () => {
    const adapter = createMockSignalAdapter({ fixture: "empty" });
    const ev = await adapter.fetchSignals("tenant-a", { companyId: "co-acme" });
    expect(ev).toEqual([]);
  });

  it("returns stale-timestamped Evidence for the 'stale' fixture", async () => {
    const adapter = createMockSignalAdapter({ fixture: "stale" });
    const ev = await adapter.fetchSignals("tenant-a", { companyId: "co-acme" });
    expect(ev.length).toBeGreaterThan(0);
    const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000; // 60 days
    for (const row of ev) {
      expect(row.timestamp.getTime()).toBeLessThan(cutoff);
      expect(row.tenantId).toBe("tenant-a");
    }
  });

  it("returns partial/low-confidence Evidence for the 'degraded' fixture", async () => {
    const adapter = createMockSignalAdapter({ fixture: "degraded" });
    const ev = await adapter.fetchSignals("tenant-a", { companyId: "co-acme" });
    expect(ev.length).toBeGreaterThan(0);
    // Degraded fixture from @hap/config has partial-data note and lower confidence.
    expect(ev[0]?.content.toLowerCase()).toContain("partial");
  });

  it("never leaks a tenantId across two calls with different tenants", async () => {
    const adapter = createMockSignalAdapter();
    const a = await adapter.fetchSignals("tenant-a", { companyId: "co-acme" });
    const b = await adapter.fetchSignals("tenant-b", { companyId: "co-acme" });
    expect(a.every((row) => row.tenantId === "tenant-a")).toBe(true);
    expect(b.every((row) => row.tenantId === "tenant-b")).toBe(true);
  });
});
