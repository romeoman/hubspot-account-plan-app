import type { ProviderConfig } from "@hap/config";
import { describe, expect, it } from "vitest";
import type { HubSpotClient } from "../../../lib/hubspot-client";
import { ExaAdapter } from "../exa";
import { createSignalAdapter } from "../factory";
import { HubSpotEnrichmentAdapter } from "../hubspot-enrichment";
import { NewsAdapter } from "../news";

function cfg(partial: Partial<ProviderConfig> & Pick<ProviderConfig, "name">): ProviderConfig {
  return {
    enabled: true,
    apiKeyRef: "key-test",
    thresholds: { freshnessMaxDays: 30, minConfidence: 0.5 },
    ...partial,
  } as ProviderConfig;
}

// Minimal HubSpotClient stub — the Slice 3 stub adapter just captures and
// rejects, so we only need a plausibly-typed object.
const stubHubSpotClient = {} as unknown as HubSpotClient;

describe("createSignalAdapter", () => {
  it("resolves exa to a real ExaAdapter", () => {
    const adapter = createSignalAdapter(cfg({ name: "exa" }));
    expect(adapter).toBeInstanceOf(ExaAdapter);
    expect(adapter.name).toBe("exa");
  });

  it("resolves hubspot-enrichment to a stub that throws a clear Slice 3 error", async () => {
    const adapter = createSignalAdapter(cfg({ name: "hubspot-enrichment" }), {
      hubspotClient: stubHubSpotClient,
    });
    expect(adapter).toBeInstanceOf(HubSpotEnrichmentAdapter);
    expect(adapter.name).toBe("hubspot-enrichment");
    await expect(adapter.fetchSignals("t1", "Acme")).rejects.toThrow(
      /Slice 3: real HubSpot enrichment adapter/,
    );
  });

  it("refuses hubspot-enrichment when no client is injected", () => {
    expect(() => createSignalAdapter(cfg({ name: "hubspot-enrichment" }))).toThrow(/HubSpotClient/);
  });

  it("resolves news to a real NewsAdapter", () => {
    const adapter = createSignalAdapter(cfg({ name: "news" }));
    expect(adapter).toBeInstanceOf(NewsAdapter);
    expect(adapter.name).toBe("news");
  });

  it("throws on unknown provider", () => {
    const bogus = {
      name: "mystery",
      enabled: true,
      apiKeyRef: "y",
      thresholds: { freshnessMaxDays: 30, minConfidence: 0.5 },
    } as unknown as ProviderConfig;
    expect(() => createSignalAdapter(bogus)).toThrow(/Unknown signal provider: mystery/);
  });

  it("passes an injected fetch through to the Exa adapter", async () => {
    let called = false;
    const fakeFetch: typeof fetch = async () => {
      called = true;
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const adapter = createSignalAdapter(cfg({ name: "exa" }), {
      fetch: fakeFetch,
    });
    const ev = await adapter.fetchSignals("t1", "Acme");
    expect(called).toBe(true);
    expect(ev).toEqual([]);
  });

  it("does not leak the API key across factory calls for different tenants", () => {
    // Two configs with distinct plaintext keys — the factory MUST produce two
    // adapters whose underlying fetch calls use the correct per-tenant key.
    // We assert distinctness at the instance level here; per-request header
    // correctness is covered in exa.test.ts.
    const a = createSignalAdapter(cfg({ name: "exa", apiKeyRef: "exa-tenantA" }));
    const b = createSignalAdapter(cfg({ name: "exa", apiKeyRef: "exa-tenantB" }));
    expect(a).not.toBe(b);
    expect(a.name).toBe("exa");
    expect(b.name).toBe("exa");
  });
});
