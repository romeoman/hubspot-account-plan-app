/**
 * OpenRouter adapter — Slice 3 deferral stub.
 *
 * @todo Slice 3: implement OpenRouter adapter (record cassette via real key,
 * follow {@link ./openai.OpenAiAdapter} pattern). OpenRouter exposes an
 * OpenAI-compatible surface at `https://openrouter.ai/api/v1/chat/completions`;
 * auth is `Authorization: Bearer <key>`. Model strings are
 * provider-prefixed (e.g. `anthropic/claude-3.5-sonnet`).
 */

import type { LlmAdapter, LlmOptions, LlmResponse } from "../llm-adapter";

export const OPENROUTER_PROVIDER_NAME = "openrouter" as const;

export interface OpenRouterAdapterOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}

export class OpenRouterAdapter implements LlmAdapter {
  readonly provider = OPENROUTER_PROVIDER_NAME;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenRouterAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetch ?? fetch;
  }

  complete(_prompt: string, _options?: LlmOptions): Promise<LlmResponse> {
    void this.apiKey;
    void this.model;
    void this.fetchImpl;
    return Promise.reject(
      new Error(
        "Slice 3: real openrouter adapter not yet implemented; record cassette with openrouter key when available.",
      ),
    );
  }
}
