/**
 * LLM adapter interface (tenant-specific, config-driven).
 *
 * V1 ships with a single mock implementation ({@link ./mock-llm-adapter}).
 * Slice 2 shipped real adapters via `apps/api/src/adapters/llm/factory.ts`
 * (OpenAI real + cassette-backed; Anthropic / Gemini / OpenRouter / custom
 * scaffolded as Slice 3 stubs that throw on call). Customers bring their
 * own API keys; provider and model selection live in `llm_config` per
 * tenant.
 */

export interface LlmOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmResponse {
  content: string;
  usage: LlmUsage;
}

export interface LlmAdapter {
  /** Stable provider identifier (`anthropic`, `openai`, `mock-llm`, …). */
  readonly provider: string;
  complete(prompt: string, options?: LlmOptions): Promise<LlmResponse>;
}
