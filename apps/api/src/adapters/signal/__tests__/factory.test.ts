import type { ProviderConfig } from "@hap/config";
import type { Database } from "@hap/db";
import { describe, expect, it } from "vitest";
import { ExaAdapter } from "../exa";
import { createExaSignalAdapters, createSignalAdapter } from "../factory";
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

const stubDb = {} as unknown as Database;

describe("createSignalAdapter", () => {
  it("resolves exa to a real ExaAdapter", () => {
    const adapter = createSignalAdapter(cfg({ name: "exa" }));
    expect(adapter).toBeInstanceOf(ExaAdapter);
    expect(adapter.name).toBe("exa");
  });

  it("resolves hubspot-enrichment from tenantId + db deps", async () => {
    const adapter = createSignalAdapter(cfg({ name: "hubspot-enrichment" }), {
      db: stubDb,
      tenantId: "tenant-1",
    });
    expect(adapter).toBeInstanceOf(HubSpotEnrichmentAdapter);
    expect(adapter.name).toBe("hubspot-enrichment");
  });

  it("refuses hubspot-enrichment when tenantId/db deps are missing", () => {
    expect(() => createSignalAdapter(cfg({ name: "hubspot-enrichment" }))).toThrow(/tenantId.*db/i);
  });

  it("no longer treats 'news' as a top-level provider — factory throws", () => {
    // News is now driven from the Exa row via createExaSignalAdapters. Any
    // caller still asking for `name: "news"` is stale and must surface loudly.
    expect(() => createSignalAdapter(cfg({ name: "news" as "exa" }))).toThrow(
      /Unknown signal provider: news/,
    );
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
    const ev = await adapter.fetchSignals("t1", {
      companyId: "co-acme",
      companyName: "Acme",
    });
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

describe("createExaSignalAdapters", () => {
  it("returns [Exa, News] when the Exa row is enabled and newsEnabled is unset", () => {
    const adapters = createExaSignalAdapters(cfg({ name: "exa" }));
    expect(adapters).toHaveLength(2);
    expect(adapters[0]).toBeInstanceOf(ExaAdapter);
    expect(adapters[1]).toBeInstanceOf(NewsAdapter);
  });

  it("returns [Exa, News] when newsEnabled is explicitly true", () => {
    const adapters = createExaSignalAdapters(cfg({ name: "exa", settings: { newsEnabled: true } }));
    expect(adapters.map((a) => a.name)).toEqual(["exa", "news"]);
  });

  it("returns [Exa] only when settings.newsEnabled is false", () => {
    const adapters = createExaSignalAdapters(
      cfg({ name: "exa", settings: { newsEnabled: false } }),
    );
    expect(adapters).toHaveLength(1);
    expect(adapters[0]).toBeInstanceOf(ExaAdapter);
  });

  it("returns [] when Exa is disabled, disabling news with it", () => {
    const adapters = createExaSignalAdapters(cfg({ name: "exa", enabled: false }));
    expect(adapters).toEqual([]);
  });

  it("refuses any config whose name is not 'exa'", () => {
    expect(() => createExaSignalAdapters(cfg({ name: "hubspot-enrichment" }))).toThrow(
      /expects an exa provider config/,
    );
  });

  it("wires the same API key into both adapters", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : ((input as Request).url ?? String(input));
      const authHeader = new Headers(init?.headers).get("x-api-key");
      calls.push({ url, auth: authHeader });
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const adapters = createExaSignalAdapters(cfg({ name: "exa", apiKeyRef: "shared-exa-key" }), {
      fetch: fakeFetch,
    });
    expect(adapters).toHaveLength(2);
    await adapters[0]!.fetchSignals("tenant-1", {
      companyId: "co-1",
      companyName: "Acme",
    });
    await adapters[1]!.fetchSignals("tenant-1", {
      companyId: "co-1",
      companyName: "Acme",
    });
    // Both made requests using the same shared API key.
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.auth).toBe("shared-exa-key");
    }
  });
});
