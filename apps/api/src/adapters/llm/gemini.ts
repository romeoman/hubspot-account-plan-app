/**
 * Google Gemini adapter — Slice 3 deferral stub.
 *
 * @todo Slice 3: implement Gemini adapter (record cassette via real key,
 * follow {@link ./openai.OpenAiAdapter} pattern). Endpoint:
 * `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`.
 * Auth: `x-goog-api-key` header (preferred) or `?key=` query param.
 */

import type { LlmAdapter, LlmOptions, LlmResponse } from "../llm-adapter";

export const GEMINI_PROVIDER_NAME = "gemini" as const;

export interface GeminiAdapterOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}

export class GeminiAdapter implements LlmAdapter {
  readonly provider = GEMINI_PROVIDER_NAME;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiAdapterOptions) {
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
        "Slice 3: real gemini adapter not yet implemented; record cassette with gemini key when available.",
      ),
    );
  }
}
