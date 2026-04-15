/**
 * Tests for the real OpenAI chat completions adapter (Slice 2 Step 8).
 *
 * Cassette replay: a real OpenAI response (shape verified against the docs
 * at https://platform.openai.com/docs/api-reference/chat) is stored as JSON
 * at `./cassettes/openai-completion.json`. The test injects a fake `fetch`
 * that loads this cassette — no network access, no API key required in CI.
 * The cassette is SCRUBBED of any `authorization` header value before commit.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { OPENAI_PROVIDER_NAME, OpenAiAdapter, OpenAiError } from "../openai";

const here = dirname(fileURLToPath(import.meta.url));
const CASSETTE_PATH = join(here, "cassettes", "openai-completion.json");

type Cassette = {
  request: {
    url: string;
    method: string;
    body: {
      model: string;
      messages: Array<{ role: string; content: string }>;
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

describe("OpenAiAdapter", () => {
  it("exposes the stable provider identifier", () => {
    const adapter = new OpenAiAdapter({
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      fetch: fakeFetchFromCassette(loadCassette()),
    });
    expect(adapter.provider).toBe(OPENAI_PROVIDER_NAME);
    expect(OPENAI_PROVIDER_NAME).toBe("openai");
  });

  it("returns content + usage from the recorded cassette", async () => {
    const cassette = loadCassette();
    const adapter = new OpenAiAdapter({
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      fetch: fakeFetchFromCassette(cassette),
    });

    const res = await adapter.complete("Reply with the word OK and nothing else.");
    expect(res.content.length).toBeGreaterThan(0);
    expect(res.usage.inputTokens).toBeGreaterThan(0);
    expect(res.usage.outputTokens).toBeGreaterThan(0);
  });

  it("sends the Authorization header with Bearer <apiKey>", async () => {
    const spy = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify(loadCassette().response.body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new OpenAiAdapter({
      apiKey: "sk-secret-1234",
      model: "gpt-4o-mini",
      fetch: spy as unknown as typeof fetch,
    });
    await adapter.complete("hello");

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-secret-1234");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages[0]).toEqual({ role: "user", content: "hello" });
  });

  it("throws OpenAiError on 401, scrubbing the API key from the error", async () => {
    const apiKey = "sk-leak-me-nope";
    const fakeFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: { message: "Incorrect API key", type: "auth", code: "401" },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    });
    const adapter = new OpenAiAdapter({
      apiKey,
      model: "gpt-4o-mini",
      fetch: fakeFetch as unknown as typeof fetch,
    });

    let caught: unknown;
    try {
      await adapter.complete("hi");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OpenAiError);
    const err = caught as OpenAiError;
    expect(err.name).toBe("OpenAiError");
    expect(err.status).toBe(401);
    // Scrub: the API key must NEVER appear in the error message or toString.
    expect(err.message).not.toContain(apiKey);
    expect(String(err)).not.toContain(apiKey);
  });

  it("throws OpenAiError on 429 and preserves Retry-After header", async () => {
    const fakeFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "30" },
      });
    });
    const adapter = new OpenAiAdapter({
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      fetch: fakeFetch as unknown as typeof fetch,
    });

    let caught: unknown;
    try {
      await adapter.complete("hi");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OpenAiError);
    const err = caught as OpenAiError;
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
    const adapter = new OpenAiAdapter({
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      fetch: fakeFetch as unknown as typeof fetch,
    });
    await expect(adapter.complete("hi")).rejects.toThrow();
  });

  it("throws when response is missing choices[0].message.content", async () => {
    const fakeFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new OpenAiAdapter({
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      fetch: fakeFetch as unknown as typeof fetch,
    });
    await expect(adapter.complete("hi")).rejects.toThrow();
  });

  it("honours maxTokens and temperature options", async () => {
    const spy = vi.fn(async () => {
      return new Response(JSON.stringify(loadCassette().response.body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new OpenAiAdapter({
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      fetch: spy as unknown as typeof fetch,
    });
    await adapter.complete("hi", { maxTokens: 42, temperature: 0.25 });
    const body = JSON.parse(
      (spy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    ) as {
      max_tokens: number;
      temperature: number;
    };
    expect(body.max_tokens).toBe(42);
    expect(body.temperature).toBe(0.25);
  });
});
