/**
 * Tests for the real Gemini generateContent adapter (Slice 3).
 *
 * Cassette replay: a Gemini API response (shape verified against the docs
 * at https://generativelanguage.googleapis.com/v1beta) is stored as JSON
 * at `./cassettes/gemini-completion.json`. The test injects a fake `fetch`
 * that loads this cassette — no network access, no API key required in CI.
 * The cassette is SCRUBBED of any `x-goog-api-key` header value before commit.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { GEMINI_PROVIDER_NAME, GeminiAdapter, GeminiError } from "../gemini";

const here = dirname(fileURLToPath(import.meta.url));
const CASSETTE_PATH = join(here, "cassettes", "gemini-completion.json");

type Cassette = {
  request: {
    url: string;
    method: string;
    body: {
      contents: Array<{ parts: Array<{ text: string }> }>;
      generationConfig: { maxOutputTokens: number };
    };
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

describe("GeminiAdapter", () => {
  it("exposes the stable provider identifier", () => {
    const adapter = new GeminiAdapter({
      apiKey: "test-key",
      model: "gemini-3.1-flash-lite-preview",
      fetch: fakeFetchFromCassette(loadCassette()),
    });
    expect(adapter.provider).toBe(GEMINI_PROVIDER_NAME);
    expect(GEMINI_PROVIDER_NAME).toBe("gemini");
  });

  it("returns content + usage from the recorded cassette", async () => {
    const cassette = loadCassette();
    const adapter = new GeminiAdapter({
      apiKey: "test-key",
      model: "gemini-3.1-flash-lite-preview",
      fetch: fakeFetchFromCassette(cassette),
    });

    const res = await adapter.complete("Reply with the word OK and nothing else.");
    expect(res.content).toBe("OK");
    expect(res.usage.inputTokens).toBe(12);
    expect(res.usage.outputTokens).toBe(1);
  });

  it("sends the x-goog-api-key header and correct content-type", async () => {
    const spy = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify(loadCassette().response.body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new GeminiAdapter({
      apiKey: "gemini-secret-key-1234",
      model: "gemini-3.1-flash-lite-preview",
      fetch: spy as unknown as typeof fetch,
    });
    await adapter.complete("hello");

    expect(spy).toHaveBeenCalledTimes(1);
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("gemini-secret-key-1234");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("includes model name in the URL path", async () => {
    const spy = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify(loadCassette().response.body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new GeminiAdapter({
      apiKey: "test-key",
      model: "gemini-3.1-flash-lite-preview",
      fetch: spy as unknown as typeof fetch,
    });
    await adapter.complete("hello");

    const [url] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent",
    );
  });

  it("sends contents + generationConfig in the request body", async () => {
    const spy = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify(loadCassette().response.body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new GeminiAdapter({
      apiKey: "test-key",
      model: "gemini-3.1-flash-lite-preview",
      fetch: spy as unknown as typeof fetch,
    });
    await adapter.complete("hello", { maxTokens: 100 });

    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      contents: Array<{ parts: Array<{ text: string }> }>;
      generationConfig: { maxOutputTokens: number };
    };
    expect(body.contents).toEqual([{ parts: [{ text: "hello" }] }]);
    expect(body.generationConfig.maxOutputTokens).toBe(100);
  });

  it("throws GeminiError on 401, scrubbing the API key from the error", async () => {
    const apiKey = "gemini-leak-me-nope";
    const fakeFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 401,
            message: "API key not valid. Please pass a valid API key.",
            status: "UNAUTHENTICATED",
          },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    });
    const adapter = new GeminiAdapter({
      apiKey,
      model: "gemini-3.1-flash-lite-preview",
      fetch: fakeFetch as unknown as typeof fetch,
    });

    let caught: unknown;
    try {
      await adapter.complete("hi");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GeminiError);
    const err = caught as GeminiError;
    expect(err.name).toBe("GeminiError");
    expect(err.status).toBe(401);
    expect(err.code).toBe("UNAUTHENTICATED");
    // Scrub: the API key must NEVER appear in the error message or toString.
    expect(err.message).not.toContain(apiKey);
    expect(String(err)).not.toContain(apiKey);
  });

  it("throws GeminiError on 429 rate limit", async () => {
    const fakeFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 429,
            message: "Resource has been exhausted",
            status: "RESOURCE_EXHAUSTED",
          },
        }),
        { status: 429, headers: { "content-type": "application/json" } },
      );
    });
    const adapter = new GeminiAdapter({
      apiKey: "test-key",
      model: "gemini-3.1-flash-lite-preview",
      fetch: fakeFetch as unknown as typeof fetch,
    });

    let caught: unknown;
    try {
      await adapter.complete("hi");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GeminiError);
    const err = caught as GeminiError;
    expect(err.status).toBe(429);
    expect(err.code).toBe("RESOURCE_EXHAUSTED");
  });

  it("throws on malformed JSON response", async () => {
    const fakeFetch = vi.fn(async () => {
      return new Response("not json at all", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new GeminiAdapter({
      apiKey: "test-key",
      model: "gemini-3.1-flash-lite-preview",
      fetch: fakeFetch as unknown as typeof fetch,
    });
    await expect(adapter.complete("hi")).rejects.toThrow();
  });

  it("throws when response is missing candidates[0].content.parts[0].text", async () => {
    const fakeFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ candidates: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new GeminiAdapter({
      apiKey: "test-key",
      model: "gemini-3.1-flash-lite-preview",
      fetch: fakeFetch as unknown as typeof fetch,
    });
    await expect(adapter.complete("hi")).rejects.toThrow();
  });

  it("honours model override via options", async () => {
    const spy = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify(loadCassette().response.body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new GeminiAdapter({
      apiKey: "test-key",
      model: "gemini-3.1-flash-lite-preview",
      fetch: spy as unknown as typeof fetch,
    });
    await adapter.complete("hi", { model: "gemini-2.5-pro" });

    const [url] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("gemini-2.5-pro:generateContent");
  });

  it("uses AbortController with 30s timeout", async () => {
    const spy = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      // Verify the signal is present
      expect(init?.signal).toBeDefined();
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify(loadCassette().response.body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new GeminiAdapter({
      apiKey: "test-key",
      model: "gemini-3.1-flash-lite-preview",
      fetch: spy as unknown as typeof fetch,
    });
    await adapter.complete("hello");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
