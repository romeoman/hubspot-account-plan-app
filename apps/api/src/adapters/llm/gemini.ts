/**
 * Google Gemini generateContent adapter (Slice 3).
 *
 * Docs: https://generativelanguage.googleapis.com/v1beta
 * Retrieval date: 2026-04-15
 *
 * Confirmed shape (verified against the public API reference):
 *  - Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
 *  - Auth:    `x-goog-api-key: <apiKey>` header
 *  - Request: `{ contents: [{ parts: [{ text }] }], generationConfig: { maxOutputTokens } }`
 *  - Response: `{ candidates: [{ content: { role, parts: [{ text }] } }], usageMetadata: { promptTokenCount, candidatesTokenCount } }`
 *  - Errors:   `{ error: { code, message, status } }`
 *
 * Security:
 *  - The API key is NEVER interpolated into error messages, logs, or
 *    toString() output. {@link GeminiError} carries only the HTTP status,
 *    the provider error status string, and a REDACTED message.
 *  - Rate-limit enforcement + observability live one layer up
 *    ({@link ./factory.wrapWithGuards}). This adapter is transport-only.
 *
 * Testability: the constructor accepts an injected `fetch` so replay-cassette
 * tests ({@link ./__tests__/gemini.test.ts}) can drive deterministic
 * responses without network access. Cassette file:
 * `__tests__/cassettes/gemini-completion.json` (scrubbed of the API key).
 */

import type { LlmAdapter, LlmOptions, LlmResponse } from "../llm-adapter";

/** Stable provider identifier — used by the factory and `llm_config.provider_name`. */
export const GEMINI_PROVIDER_NAME = "gemini" as const;

/** Base URL for the Gemini generateContent API. */
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Defaults picked to keep reason-text bounded and stable across runs. */
const DEFAULT_MAX_OUTPUT_TOKENS = 256;

/**
 * Per-request timeout. Gemini generateContent normally finishes in 2–10s at
 * maxOutputTokens~256; anything over this is a network-layer problem.
 * Keeps the snapshot route from hanging.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Constructor options. `fetch` is injectable so cassette tests can load a
 * recorded response without hitting the network. Production wiring passes the
 * global {@link fetch}.
 */
export interface GeminiAdapterOptions {
  apiKey: string;
  model: string;
  /** Defaults to the global `fetch`. Inject in tests. */
  fetch?: typeof fetch;
}

/**
 * Error thrown on every non-2xx response from Gemini.
 *
 * Fields exposed:
 *  - `status` – HTTP status from the response.
 *  - `code`   – provider error status string when present (e.g. `"UNAUTHENTICATED"`).
 *
 * `message` is a stable, redacted description; it NEVER includes the API key,
 * URL query parameters, or response body excerpts that could smuggle secrets
 * into shared log aggregators.
 */
export class GeminiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(args: { status: number; code: string | null }) {
    super(`gemini request failed (status=${args.status})`);
    this.name = "GeminiError";
    this.status = args.status;
    this.code = args.code;
  }
}

/** Shape of the Gemini generateContent response body. */
interface GenerateContentResponse {
  candidates?: Array<{
    content?: {
      role?: string;
      parts?: Array<{ text?: string }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

/** Extract the error status string from a Gemini error body. */
function extractErrorStatus(body: unknown): string | null {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const err = (body as Record<string, unknown>).error;
    if (err && typeof err === "object" && !Array.isArray(err)) {
      const status = (err as Record<string, unknown>).status;
      if (typeof status === "string") return status;
    }
  }
  return null;
}

/**
 * Real Gemini generateContent adapter. Tenant isolation is handled upstream:
 * the factory decrypts the tenant's key and passes it into this constructor.
 * This class holds the plaintext key only in its closure; it never logs it.
 */
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

  async complete(prompt: string, options?: LlmOptions): Promise<LlmResponse> {
    const model = options?.model ?? this.model;
    const url = `${GEMINI_API_BASE}/${model}:generateContent`;

    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: options?.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      },
    });

    // AbortController-based timeout: prevents the snapshot route from hanging
    // indefinitely on a stalled Gemini connection. Cleared in the finally.
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), DEFAULT_REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "x-goog-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body,
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (!res.ok) {
      let errorCode: string | null = null;
      try {
        const errorBody: unknown = await res.json();
        errorCode = extractErrorStatus(errorBody);
      } catch {
        // Non-JSON error body — keep code null. NEVER log the raw body: it can
        // include request URLs, model IDs, or server-side detail that shouldn't
        // leak into aggregators.
      }
      throw new GeminiError({
        status: res.status,
        code: errorCode,
      });
    }

    let parsed: GenerateContentResponse;
    try {
      parsed = (await res.json()) as GenerateContentResponse;
    } catch (_err) {
      throw new GeminiError({
        status: res.status,
        code: "malformed_json",
      });
    }

    const content = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof content !== "string" || content.length === 0) {
      throw new GeminiError({
        status: res.status,
        code: "missing_content",
      });
    }

    return {
      content,
      usage: {
        inputTokens: parsed.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: parsed.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}
