import type { LlmProviderConfig } from "@hap/config";
import { describe, expect, it } from "vitest";
import { createLlmAdapter } from "../factory";
import { OpenAiAdapter } from "../openai";

function cfg(
  partial: Partial<LlmProviderConfig> & Pick<LlmProviderConfig, "provider">,
): LlmProviderConfig {
  return {
    model: "gpt-4o-mini",
    apiKeyRef: "sk-test",
    ...partial,
  } as LlmProviderConfig;
}

describe("createLlmAdapter", () => {
  it("resolves openai to a real OpenAiAdapter", () => {
    const adapter = createLlmAdapter(cfg({ provider: "openai" }));
    expect(adapter).toBeInstanceOf(OpenAiAdapter);
    expect(adapter.provider).toBe("openai");
  });

  it("resolves anthropic to a stub that throws a clear Slice 3 error", async () => {
    const adapter = createLlmAdapter(cfg({ provider: "anthropic" }));
    expect(adapter.provider).toBe("anthropic");
    await expect(adapter.complete("hi")).rejects.toThrow(/Slice 3: real anthropic adapter/);
  });

  it("resolves gemini to a stub that throws a clear Slice 3 error", async () => {
    const adapter = createLlmAdapter(cfg({ provider: "gemini" }));
    expect(adapter.provider).toBe("gemini");
    await expect(adapter.complete("hi")).rejects.toThrow(/Slice 3: real gemini adapter/);
  });

  it("resolves openrouter to a stub that throws a clear Slice 3 error", async () => {
    const adapter = createLlmAdapter(cfg({ provider: "openrouter" }));
    expect(adapter.provider).toBe("openrouter");
    await expect(adapter.complete("hi")).rejects.toThrow(/Slice 3: real openrouter adapter/);
  });

  it("resolves custom to a stub (requires endpointUrl)", async () => {
    const adapter = createLlmAdapter(
      cfg({
        provider: "custom",
        endpointUrl: "https://inference.example.com/v1",
      }),
    );
    expect(adapter.provider).toBe("custom");
    await expect(adapter.complete("hi")).rejects.toThrow(/Slice 3: real custom adapter/);
  });

  it("refuses custom config when endpointUrl is missing", () => {
    expect(() => createLlmAdapter(cfg({ provider: "custom" }))).toThrow(/endpointUrl/);
  });

  it("throws on unknown provider", () => {
    // Defense-in-depth path: the domain type narrows to the five known
    // providers, but a malformed DB row escaping the resolver would carry a
    // string literal the factory does not recognise. Cast via unknown to
    // simulate that scenario without using `any`.
    const bogus = {
      provider: "mystery",
      model: "x",
      apiKeyRef: "y",
    } as unknown as LlmProviderConfig;
    expect(() => createLlmAdapter(bogus)).toThrow(/Unknown LLM provider: mystery/);
  });

  it("passes an injected fetch through to the adapter", async () => {
    let called = false;
    const fakeFetch: typeof fetch = async () => {
      called = true;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 3, completion_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const adapter = createLlmAdapter(cfg({ provider: "openai" }), {
      fetch: fakeFetch,
    });
    const res = await adapter.complete("hi");
    expect(called).toBe(true);
    expect(res.content).toBe("ok");
  });

  it("does not leak the API key across factory calls for different tenants", () => {
    // Two configs with distinct plaintext keys — the factory MUST produce two
    // adapters whose underlying fetch calls use the correct per-tenant key.
    const a = createLlmAdapter(cfg({ provider: "openai", apiKeyRef: "sk-tenantA" }));
    const b = createLlmAdapter(cfg({ provider: "openai", apiKeyRef: "sk-tenantB" }));
    expect(a).not.toBe(b);
    // We assert this via the API-key-in-header test in openai.test.ts; here
    // we just confirm distinct instances (no shared singleton).
    expect(a.provider).toBe("openai");
    expect(b.provider).toBe("openai");
  });
});
