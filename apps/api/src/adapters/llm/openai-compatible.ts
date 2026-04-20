/**
 * Custom OpenAI-compatible adapter — Slice 3 deferral stub.
 *
 * Used by tenants configured with `provider='custom'` who host an
 * OpenAI-compatible inference endpoint (vLLM, Together, Groq, self-hosted,
 * etc.). Requires a per-tenant `endpointUrl` from `llm_config`.
 *
 * @todo Slice 3: implement custom adapter (record cassette via real key,
 * follow {@link ./openai.OpenAiAdapter} pattern — most of the code is
 * verbatim; only the URL is swappable).
 */

import type { LlmAdapter, LlmOptions, LlmResponse } from "../llm-adapter.js";

export const CUSTOM_PROVIDER_NAME = "custom" as const;

export interface OpenAiCompatibleAdapterOptions {
  apiKey: string;
  model: string;
  /** Fully-qualified base URL of the OpenAI-compatible endpoint. Required. */
  baseUrl: string;
  fetch?: typeof fetch;
}

export class OpenAiCompatibleAdapter implements LlmAdapter {
  readonly provider = CUSTOM_PROVIDER_NAME;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiCompatibleAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = options.baseUrl;
    this.fetchImpl = options.fetch ?? fetch;
  }

  complete(_prompt: string, _options?: LlmOptions): Promise<LlmResponse> {
    void this.apiKey;
    void this.model;
    void this.baseUrl;
    void this.fetchImpl;
    return Promise.reject(
      new Error(
        "Slice 3: real custom adapter not yet implemented; record cassette with custom key when available.",
      ),
    );
  }
}
