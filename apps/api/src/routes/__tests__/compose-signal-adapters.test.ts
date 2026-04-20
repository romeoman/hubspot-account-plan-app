/**
 * Regression test for C1 (code-reviewer finding on PR #20):
 * `createExaSignalAdapters` was wired into `resolveSignalAdapter` via this
 * composite helper. Prior to the fix, only `createSignalAdapter` ran, so
 * tenants with `exa.settings.newsEnabled !== false` silently lost the News
 * evidence source in production.
 *
 * These tests lock the contract the snapshot assembler depends on:
 *  - the composite's `fetchSignals` calls EVERY sub-adapter,
 *  - flattens their evidence into one array,
 *  - rejects when any sub-adapter rejects (so the assembler marks the
 *    snapshot `degraded` the same way the single-adapter path would).
 */

import { createEvidence, type Evidence } from "@hap/config";
import { describe, expect, it, vi } from "vitest";
import type { ProviderAdapter, ProviderCompanyContext } from "../../adapters/provider-adapter";
import { composeSignalAdapters } from "../snapshot";

function stubAdapter(name: string, evidence: Evidence[]): ProviderAdapter {
  return {
    name,
    fetchSignals: vi.fn(async () => evidence),
  };
}

function stubRejector(name: string, err: Error): ProviderAdapter {
  return {
    name,
    fetchSignals: vi.fn(async () => {
      throw err;
    }),
  };
}

const TENANT_ID = "tenant-a";
const COMPANY: ProviderCompanyContext = {
  companyId: "123",
  companyName: "Acme",
};

function makeEvidence(source: string): Evidence {
  return createEvidence(TENANT_ID, {
    id: `${source}:1`,
    source,
    timestamp: new Date(),
    confidence: 0.5,
    content: `${source} finding`,
    isRestricted: false,
  });
}

describe("composeSignalAdapters", () => {
  it("calls every sub-adapter and flattens evidence from all of them", async () => {
    const exa = stubAdapter("exa", [makeEvidence("exa")]);
    const news = stubAdapter("news", [makeEvidence("nytimes.com"), makeEvidence("reuters.com")]);

    const composite = composeSignalAdapters([exa, news], "exa");
    const result = await composite.fetchSignals(TENANT_ID, COMPANY);

    expect(result).toHaveLength(3);
    expect(result.map((e) => e.source)).toEqual(["exa", "nytimes.com", "reuters.com"]);
    expect(exa.fetchSignals).toHaveBeenCalledTimes(1);
    expect(news.fetchSignals).toHaveBeenCalledTimes(1);
  });

  it("preserves the composite name (used by downstream logs/metrics)", async () => {
    const composite = composeSignalAdapters([stubAdapter("exa", [])], "exa");
    expect(composite.name).toBe("exa");
  });

  it("returns an empty array when all sub-adapters return empty", async () => {
    const composite = composeSignalAdapters(
      [stubAdapter("exa", []), stubAdapter("news", [])],
      "exa",
    );
    const result = await composite.fetchSignals(TENANT_ID, COMPANY);
    expect(result).toEqual([]);
  });

  it("rejects when any sub-adapter rejects (so the snapshot assembler marks degraded)", async () => {
    const exa = stubAdapter("exa", [makeEvidence("exa")]);
    const news = stubRejector("news", new Error("Exa news vertical failed"));

    const composite = composeSignalAdapters([exa, news], "exa");
    await expect(composite.fetchSignals(TENANT_ID, COMPANY)).rejects.toThrow(
      /Exa news vertical failed/,
    );
  });

  it("calls sub-adapters in parallel, not serially", async () => {
    const calls: string[] = [];
    const makeSlow = (name: string, delayMs: number): ProviderAdapter => ({
      name,
      fetchSignals: async () => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        calls.push(name);
        return [];
      },
    });

    const composite = composeSignalAdapters([makeSlow("exa", 20), makeSlow("news", 5)], "exa");
    const start = Date.now();
    await composite.fetchSignals(TENANT_ID, COMPANY);
    const elapsed = Date.now() - start;

    // news (5ms) should finish first; exa (20ms) determines total time.
    // If serial, total would be ~25ms. In parallel, ~20ms. Give generous
    // margin for CI flake.
    expect(calls).toEqual(["news", "exa"]);
    expect(elapsed).toBeLessThan(50);
  });
});
