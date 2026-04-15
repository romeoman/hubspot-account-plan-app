/**
 * Anthropic Messages API adapter — Slice 3 deferral stub.
 *
 * The factory ({@link ./factory.createLlmAdapter}) wires this class for tenants
 * configured with `provider='anthropic'`. Calling {@link complete} throws a
 * clear deferral error so operators see it immediately instead of hitting
 * silent failures.
 *
 * @todo Slice 3: implement Anthropic adapter (record cassette via real key,
 * follow {@link ./openai.OpenAiAdapter} pattern). Endpoint:
 * `POST https://api.anthropic.com/v1/messages`. Auth: `x-api-key` header.
 */

import type { LlmAdapter, LlmOptions, LlmResponse } from "../llm-adapter";

export const ANTHROPIC_PROVIDER_NAME = "anthropic" as const;

export interface AnthropicAdapterOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}

export class AnthropicAdapter implements LlmAdapter {
  readonly provider = ANTHROPIC_PROVIDER_NAME;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AnthropicAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetch ?? fetch;
  }

  complete(_prompt: string, _options?: LlmOptions): Promise<LlmResponse> {
    // Touch fields so `noUnusedLocals`-style linters stay quiet without losing
    // the closure capture the Slice 3 implementation will need.
    void this.apiKey;
    void this.model;
    void this.fetchImpl;
    return Promise.reject(
      new Error(
        "Slice 3: real anthropic adapter not yet implemented; record cassette with anthropic key when available.",
      ),
    );
  }
}
