/**
 * Tests for the real Exa search adapter (Slice 2 Step 9).
 *
 * Cassette replay: a real Exa response (shape verified against the docs at
 * https://exa.ai/docs/reference/search) is stored as JSON at
 * `./cassettes/exa-search.json`. The test injects a fake `fetch` that loads
 * this cassette — no network access, no API key required in CI. The cassette
 * is SCRUBBED of the `x-api-key` header value before commit.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { EXA_PROVIDER_NAME, ExaAdapter, ExaError } from "../exa";

const here = dirname(fileURLToPath(import.meta.url));
const CASSETTE_PATH = join(here, "cassettes", "exa-search.json");

type Cassette = {
  request: {
    url: string;
    method: string;
    body: { query: string; numResults: number };
  };
  response: {
    status: number;
    body: unknown;
  };
};

function loadCassette(): Cassette {
  return JSON.parse(readFileSync(CASSETTE_PATH, "utf8")) as Cassette;
}

function fakeFetchFromCassette(cassette: Cassette): typeof fetch {
  return vi.fn(async (_url: string | URL, _init?: RequestInit) => {
    return new Response(JSON.stringify(cassette.response.body), {
      status: cassette.response.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("ExaAdapter", () => {
  it("exposes the stable provider identifier", () => {
    const adapter = new ExaAdapter({
      apiKey: "test-key",
      fetch: fakeFetchFromCassette(loadCassette()),
    });
    expect(adapter.name).toBe(EXA_PROVIDER_NAME);
    expect(EXA_PROVIDER_NAME).toBe("exa");
  });

  it("returns Evidence[] from the recorded cassette with tenantId bound", async () => {
    const cassette = loadCassette();
    const adapter = new ExaAdapter({
      apiKey: "test-key",
      fetch: fakeFetchFromCassette(cassette),
    });

    const evidence = await adapter.fetchSignals("tenant-A", { companyId: "OpenAI" });
    expect(evidence.length).toBe(2);
    for (const ev of evidence) {
      expect(ev.tenantId).toBe("tenant-A");
      expect(ev.isRestricted).toBe(false);
      expect(ev.confidence).toBeGreaterThan(0);
      expect(ev.confidence).toBeLessThanOrEqual(1);
      expect(ev.timestamp).toBeInstanceOf(Date);
      expect(ev.content.length).toBeGreaterThan(0);
      // Source = URL host, not the raw URL.
      expect(ev.source).not.toContain("https://");
      expect(ev.source).not.toContain("/");
    }
    // First result's publishedDate should round-trip into Evidence.timestamp.
    expect(evidence[0]?.timestamp.toISOString()).toBe("2026-04-01T13:32:59.000Z");
    expect(evidence[0]?.source).toBe("www.financialexpress.com");
  });

  it("sends x-api-key header verbatim and POSTs the expected body shape", async () => {
    const spy = vi.fn(async () => {
      return new Response(JSON.stringify(loadCassette().response.body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new ExaAdapter({
      apiKey: "exa-secret-1234",
      fetch: spy as unknown as typeof fetch,
    });
    await adapter.fetchSignals("t1", {
      companyId: "co-acme",
      companyName: "Acme",
      domain: "acme.com",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.exa.ai/search");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("exa-secret-1234");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string) as {
      query: string;
      numResults: number;
      contents?: { text?: { maxCharacters?: number } };
    };
    // Domain is appended to company name so Exa can bias results toward the
    // right entity when the company name is ambiguous.
    expect(body.query).toBe("Acme acme.com");
    expect(typeof body.numResults).toBe("number");
    expect(body.contents?.text?.maxCharacters).toBeGreaterThan(0);
  });

  it("throws ExaError on 401, scrubbing the API key from the error", async () => {
    const apiKey = "exa-leak-me-nope";
    const fakeFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: { message: "invalid API key", code: "unauthorized" },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    });
    const adapter = new ExaAdapter({
      apiKey,
      fetch: fakeFetch as unknown as typeof fetch,
    });

    let caught: unknown;
    try {
      await adapter.fetchSignals("t1", { companyId: "Acme" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ExaError);
    const err = caught as ExaError;
    expect(err.name).toBe("ExaError");
    expect(err.status).toBe(401);
    // Scrub: the API key must NEVER appear in the error message or toString.
    expect(err.message).not.toContain(apiKey);
    expect(String(err)).not.toContain(apiKey);
  });

  it("throws ExaError on 429 and preserves Retry-After header", async () => {
    const fakeFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "30" },
      });
    });
    const adapter = new ExaAdapter({
      apiKey: "test",
      fetch: fakeFetch as unknown as typeof fetch,
    });

    let caught: unknown;
    try {
      await adapter.fetchSignals("t1", { companyId: "Acme" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ExaError);
    const err = caught as ExaError;
    expect(err.status).toBe(429);
    expect(err.retryAfterSeconds).toBe(30);
  });

  it("throws on malformed JSON response", async () => {
    const fakeFetch = vi.fn(async () => {
      return new Response("not json at all", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new ExaAdapter({
      apiKey: "test",
      fetch: fakeFetch as unknown as typeof fetch,
    });
    await expect(adapter.fetchSignals("t1", { companyId: "Acme" })).rejects.toBeInstanceOf(
      ExaError,
    );
  });

  it("throws when response is missing the results array", async () => {
    const fakeFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ requestId: "x" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new ExaAdapter({
      apiKey: "test",
      fetch: fakeFetch as unknown as typeof fetch,
    });
    await expect(adapter.fetchSignals("t1", { companyId: "Acme" })).rejects.toBeInstanceOf(
      ExaError,
    );
  });

  it("propagates tenantId to every Evidence row even across tenants", async () => {
    const adapter = new ExaAdapter({
      apiKey: "test",
      fetch: fakeFetchFromCassette(loadCassette()),
    });

    const a = await adapter.fetchSignals("tenant-A", { companyId: "OpenAI" });
    const b = await adapter.fetchSignals("tenant-B", { companyId: "OpenAI" });
    for (const ev of a) expect(ev.tenantId).toBe("tenant-A");
    for (const ev of b) expect(ev.tenantId).toBe("tenant-B");
  });

  it("falls back to now() when Exa result has no publishedDate", async () => {
    const fakeFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          results: [{ id: "r1", url: "https://example.com/a", title: "t", text: "c" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const adapter = new ExaAdapter({
      apiKey: "test",
      fetch: fakeFetch as unknown as typeof fetch,
    });
    const before = Date.now();
    const ev = await adapter.fetchSignals("t", { companyId: "Acme" });
    const after = Date.now();
    expect(ev.length).toBe(1);
    const ts = ev[0]?.timestamp.getTime() ?? 0;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
