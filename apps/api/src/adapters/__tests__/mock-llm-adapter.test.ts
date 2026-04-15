import { describe, expect, it } from "vitest";
import { createMockLlmAdapter } from "../mock-llm-adapter";

describe("createMockLlmAdapter", () => {
  it("exposes a stable provider name", () => {
    const adapter = createMockLlmAdapter();
    expect(adapter.provider).toBe("mock-llm");
  });

  it("returns a single-line response for style='short'", async () => {
    const adapter = createMockLlmAdapter({ style: "short" });
    const res = await adapter.complete("Hi there");
    expect(res.content.split("\n").length).toBe(1);
    expect(res.content.length).toBeGreaterThan(0);
    expect(res.usage.inputTokens).toBeGreaterThan(0);
    expect(res.usage.outputTokens).toBeGreaterThan(0);
  });

  it("returns a multi-line response for style='long'", async () => {
    const adapter = createMockLlmAdapter({ style: "long" });
    const res = await adapter.complete("Hi there");
    expect(res.content.split("\n").length).toBeGreaterThan(1);
    expect(res.usage.outputTokens).toBeGreaterThan(10);
  });

  it("rejects for style='error'", async () => {
    const adapter = createMockLlmAdapter({ style: "error" });
    await expect(adapter.complete("anything")).rejects.toThrow();
  });

  it("usage input tokens scale with prompt length", async () => {
    const adapter = createMockLlmAdapter({ style: "short" });
    const short = await adapter.complete("a");
    const long = await adapter.complete("a".repeat(400));
    expect(long.usage.inputTokens).toBeGreaterThan(short.usage.inputTokens);
  });

  it("defaults to 'short' style", async () => {
    const adapter = createMockLlmAdapter();
    const res = await adapter.complete("anything");
    expect(res.content.split("\n").length).toBe(1);
  });
});
