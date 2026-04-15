/**
 * V1 mock LLM adapter.
 *
 * Three styles:
 *  - `short`: one-line response (default)
 *  - `long`: multi-line response
 *  - `error`: rejects so downstream error handling can be exercised
 *
 * Usage counts are naive char-based estimates — good enough for V1 tests;
 * Slice 2 adapters return real provider usage.
 *
 * @todo Slice 2: replace with provider-specific adapter factories
 * (anthropic, openai, gemini, openrouter, custom) driven by the resolved
 * `LlmProviderConfig` for the caller's tenant.
 */

import type { LlmAdapter, LlmOptions, LlmResponse } from "./llm-adapter";

export type MockLlmStyle = "short" | "long" | "error";

export interface MockLlmAdapterOptions {
  style?: MockLlmStyle;
}

/** Rough ~4 chars/token heuristic, clamped to at least 1 so short prompts still count. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function createMockLlmAdapter(opts: MockLlmAdapterOptions = {}): LlmAdapter {
  const style: MockLlmStyle = opts.style ?? "short";

  return {
    provider: "mock-llm",
    async complete(prompt: string, _options?: LlmOptions): Promise<LlmResponse> {
      if (style === "error") {
        throw new Error("mock-llm: simulated provider error");
      }

      const content =
        style === "long"
          ? [
              "Mock summary line 1: observed strong engagement signal.",
              "Mock summary line 2: funding round provides timely hook.",
              "Mock summary line 3: champion opened pricing email twice.",
            ].join("\n")
          : "Mock one-line summary of the account.";

      return {
        content,
        usage: {
          inputTokens: estimateTokens(prompt),
          outputTokens: estimateTokens(content),
        },
      };
    },
  };
}
