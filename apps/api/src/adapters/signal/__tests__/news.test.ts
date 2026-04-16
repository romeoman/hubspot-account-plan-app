/**
 * Slice 3 Task 11 — real News signal adapter tests (Exa news vertical).
 *
 * Decision (preflight notes §7 + plan Task 9): uses the same Exa search
 * API as the existing Exa adapter, with a news-focused query builder. No
 * new dependency — reuses EXA_API_KEY.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { NEWS_PROVIDER_NAME, NewsAdapter } from "../news";

const here = dirname(fileURLToPath(import.meta.url));
const CASSETTE_PATH = join(here, "cassettes", "news-search.json");

type Cassette = {
  request: { url: string; method: string; body: Record<string, unknown> };
  response: {
    status: number;
    body: {
      results: Array<{
        url: string;
        title: string;
        text: string;
        publishedDate?: string;
      }>;
    };
  };
};

function loadCassette(): Cassette {
  return JSON.parse(readFileSync(CASSETTE_PATH, "utf8")) as Cassette;
}

function fakeFetch(cassette: Cassette): typeof fetch {
  return vi.fn(async () => {
    return new Response(JSON.stringify(cassette.response.body), {
      status: cassette.response.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("NewsAdapter", () => {
  it("exposes the 'news' provider name", () => {
    const adapter = new NewsAdapter({
      apiKey: "exa-test-key",
      fetch: fakeFetch(loadCassette()),
    });
    expect(adapter.name).toBe(NEWS_PROVIDER_NAME);
    expect(NEWS_PROVIDER_NAME).toBe("news");
  });

  it("returns Evidence[] from the cassette with source 'news'", async () => {
    const cassette = loadCassette();
    const adapter = new NewsAdapter({
      apiKey: "exa-test-key",
      fetch: fakeFetch(cassette),
    });

    const evidence = await adapter.fetchSignals("tenant-uuid", {
      companyId: "co-acme",
      companyName: "Acme Corp",
      domain: "acme.example.com",
    });
    expect(evidence.length).toBeGreaterThan(0);
    for (const e of evidence) {
      expect(e.source).toMatch(/\./); // hostname from URL, e.g. "techcrunch.example.com"
      expect(e.tenantId).toBe("tenant-uuid");
      expect(e.content.length).toBeGreaterThan(0);
      expect(e.confidence).toBeGreaterThan(0);
      expect(e.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("sends the query as '{companyName} news' to the Exa search endpoint", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    const cassette = loadCassette();
    const spy = vi.fn(async (url: string | URL, init?: RequestInit) => {
      capturedUrl = url.toString();
      capturedBody = String(init?.body ?? "");
      return new Response(JSON.stringify(cassette.response.body), {
        status: cassette.response.status,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const adapter = new NewsAdapter({ apiKey: "exa-test-key", fetch: spy });
    await adapter.fetchSignals("t1", { companyId: "co-acme", companyName: "Acme Corp" });

    expect(capturedUrl).toBe("https://api.exa.ai/search");
    const body = JSON.parse(capturedBody);
    expect(body.query).toContain("Acme Corp");
    expect(body.query.toLowerCase()).toContain("news");
  });

  it("sends x-api-key header with the provided API key", async () => {
    let capturedHeaders: Record<string, string> = {};
    const cassette = loadCassette();
    const spy = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      capturedHeaders = Object.fromEntries(headers.entries());
      return new Response(JSON.stringify(cassette.response.body), {
        status: cassette.response.status,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const adapter = new NewsAdapter({ apiKey: "secret-exa-key", fetch: spy });
    await adapter.fetchSignals("t1", { companyId: "co-acme", companyName: "Acme Corp" });

    expect(capturedHeaders["x-api-key"]).toBe("secret-exa-key");
  });

  it("throws on non-2xx responses", async () => {
    const spy = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const adapter = new NewsAdapter({ apiKey: "key", fetch: spy });
    await expect(
      adapter.fetchSignals("t1", { companyId: "co-acme", companyName: "Acme Corp" }),
    ).rejects.toThrow();
  });

  it("returns empty array when Exa returns zero results", async () => {
    const spy = vi.fn(async () => {
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const adapter = new NewsAdapter({ apiKey: "key", fetch: spy });
    const evidence = await adapter.fetchSignals("t1", {
      companyId: "co-unknown",
      companyName: "Unknown Corp",
    });
    expect(evidence).toEqual([]);
  });
});
