/**
 * LLM adapter interface (tenant-specific, config-driven).
 *
 * V1 ships with a single mock implementation ({@link ./mock-llm-adapter}).
 * Slice 2 adds real adapters for Anthropic, OpenAI, Gemini, OpenRouter, and
 * "custom" (OpenAI-compatible) endpoints. Customers bring their own API keys;
 * provider and model selection live in `llm_config` per tenant.
 *
 * @todo Slice 2: real adapter factory — one factory per provider family that
 * accepts a resolved `LlmProviderConfig` and returns an {@link LlmAdapter}.
 * Do not hardcode a shared provider here.
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
