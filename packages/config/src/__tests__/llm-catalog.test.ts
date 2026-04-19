import { describe, expect, it } from "vitest";
import type { LlmProviderType } from "../domain-types";
import { LLM_CATALOG, type LlmCatalogEntry } from "../llm-catalog";

const ALL_PROVIDERS: LlmProviderType[] = ["openai", "anthropic", "gemini", "openrouter", "custom"];

const VALID_TIERS = new Set<LlmCatalogEntry["tier"]>(["premium", "standard", "free", undefined]);

describe("LLM_CATALOG shape", () => {
  it("covers every LlmProviderType key, including 'custom'", () => {
    for (const provider of ALL_PROVIDERS) {
      expect(LLM_CATALOG).toHaveProperty(provider);
    }
    // No extra keys.
    expect(Object.keys(LLM_CATALOG).sort()).toEqual([...ALL_PROVIDERS].sort());
  });

  it("has at least one entry for every provider except possibly 'custom'", () => {
    for (const provider of ALL_PROVIDERS) {
      if (provider === "custom") continue;
      expect(LLM_CATALOG[provider].length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate values within a provider", () => {
    for (const provider of ALL_PROVIDERS) {
      const values = LLM_CATALOG[provider].map((e) => e.value);
      const unique = new Set(values);
      expect(unique.size).toBe(values.length);
    }
  });

  it("uses only valid tier values", () => {
    for (const provider of ALL_PROVIDERS) {
      for (const entry of LLM_CATALOG[provider]) {
        expect(VALID_TIERS.has(entry.tier)).toBe(true);
      }
    }
  });

  it("ensures every entry has non-empty value and label", () => {
    for (const provider of ALL_PROVIDERS) {
      for (const entry of LLM_CATALOG[provider]) {
        expect(entry.value.length).toBeGreaterThan(0);
        expect(entry.label.length).toBeGreaterThan(0);
      }
    }
  });

  it("includes at least 3 :free entries in OpenRouter", () => {
    const freeEntries = LLM_CATALOG.openrouter.filter((e) => e.value.endsWith(":free"));
    expect(freeEntries.length).toBeGreaterThanOrEqual(3);
    // Also asserts tier is correctly marked for free entries.
    for (const entry of freeEntries) {
      expect(entry.tier).toBe("free");
    }
  });

  it("OpenRouter catalog includes at least one DeepSeek entry", () => {
    const hasDeepseek = LLM_CATALOG.openrouter.some((e) => e.value.startsWith("deepseek/"));
    expect(hasDeepseek).toBe(true);
  });

  it("OpenRouter catalog includes at least one MiniMax entry", () => {
    const hasMiniMax = LLM_CATALOG.openrouter.some((e) => e.value.startsWith("minimax/"));
    expect(hasMiniMax).toBe(true);
  });
});
