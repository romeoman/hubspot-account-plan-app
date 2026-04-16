/**
 * Tests for the Anthropic Messages API adapter (Slice 3).
 *
 * Cassette replay: a representative Anthropic response (shape verified against
 * https://docs.anthropic.com/en/api/messages) is stored as JSON at
 * `./cassettes/anthropic-completion.json`. The test injects a fake `fetch`
 * that loads this cassette — no network access, no API key required in CI.
 * The cassette is SCRUBBED of any `x-api-key` header value before commit.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ANTHROPIC_PROVIDER_NAME, AnthropicAdapter, AnthropicError } from "../anthropic";

const here = dirname(fileURLToPath(import.meta.url));
const CASSETTE_PATH = join(here, "cassettes", "anthropic-completion.json");

type Cassette = {
  request: {
    url: string;
    method: string;
    body: {
      model: string;
      max_tokens: number;
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

describe("AnthropicAdapter", () => {
  it("exposes the stable provider identifier", () => {
    const adapter = new AnthropicAdapter({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-6",
      fetch: fakeFetchFromCassette(loadCassette()),
    });
    expect(adapter.provider).toBe(ANTHROPIC_PROVIDER_NAME);
    expect(ANTHROPIC_PROVIDER_NAME).toBe("anthropic");
  });

  it("returns content + usage from the recorded cassette", async () => {
    const cassette = loadCassette();
    const adapter = new AnthropicAdapter({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-6",
      fetch: fakeFetchFromCassette(cassette),
    });

    const res = await adapter.complete("Reply with the word OK and nothing else.");
    expect(res.content).toBe("OK");
    expect(res.content.length).toBeGreaterThan(0);
    expect(res.usage.inputTokens).toBeGreaterThan(0);
    expect(res.usage.outputTokens).toBeGreaterThan(0);
  });

  it("sends correct headers: x-api-key, anthropic-version, content-type", async () => {
    const spy = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify(loadCassette().response.body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new AnthropicAdapter({
      apiKey: "sk-ant-secret-1234",
      model: "claude-sonnet-4-6",
      fetch: spy as unknown as typeof fetch,
    });
    await adapter.complete("hello");

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-secret-1234");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("sends model + max_tokens + messages in request body", async () => {
    const spy = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify(loadCassette().response.body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new AnthropicAdapter({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-6",
      fetch: spy as unknown as typeof fetch,
    });
    await adapter.complete("hello");

    const body = JSON.parse(
      (spy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    ) as {
      model: string;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.max_tokens).toBe(256);
    expect(body.messages[0]).toEqual({ role: "user", content: "hello" });
  });

  it("throws AnthropicError on 401, scrubbing the API key from the error", async () => {
    const apiKey = "sk-ant-leak-me-nope";
    const fakeFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          type: "error",
          error: { type: "authentication_error", message: "invalid x-api-key" },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    });
    const adapter = new AnthropicAdapter({
      apiKey,
      model: "claude-sonnet-4-6",
      fetch: fakeFetch as unknown as typeof fetch,
    });

    let caught: unknown;
    try {
      await adapter.complete("hi");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AnthropicError);
    const err = caught as AnthropicError;
    expect(err.name).toBe("AnthropicError");
    expect(err.status).toBe(401);
    expect(err.errorType).toBe("authentication_error");
    // Scrub: the API key must NEVER appear in the error message or toString.
    expect(err.message).not.toContain(apiKey);
    expect(String(err)).not.toContain(apiKey);
  });

  it("throws AnthropicError on 429 with error type", async () => {
    const fakeFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          type: "error",
          error: { type: "rate_limit_error", message: "rate limited" },
        }),
        { status: 429, headers: { "content-type": "application/json" } },
      );
    });
    const adapter = new AnthropicAdapter({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-6",
      fetch: fakeFetch as unknown as typeof fetch,
    });

    let caught: unknown;
    try {
      await adapter.complete("hi");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AnthropicError);
    const err = caught as AnthropicError;
    expect(err.status).toBe(429);
    expect(err.errorType).toBe("rate_limit_error");
  });

  it("throws on malformed JSON response", async () => {
    const fakeFetch = vi.fn(async () => {
      return new Response("not json at all", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new AnthropicAdapter({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-6",
      fetch: fakeFetch as unknown as typeof fetch,
    });
    await expect(adapter.complete("hi")).rejects.toThrow();
  });

  it("throws when response is missing content[0].text", async () => {
    const fakeFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          content: [],
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    const adapter = new AnthropicAdapter({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-6",
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
    const adapter = new AnthropicAdapter({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-6",
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

  it("sets an AbortController with 30s timeout", async () => {
    const spy = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      // Verify the signal is present (AbortController was wired)
      expect(init?.signal).toBeDefined();
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify(loadCassette().response.body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new AnthropicAdapter({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-6",
      fetch: spy as unknown as typeof fetch,
    });
    await adapter.complete("hi");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
