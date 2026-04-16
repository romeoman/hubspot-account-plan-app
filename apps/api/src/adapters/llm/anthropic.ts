/**
 * Anthropic Messages API adapter (Slice 3).
 *
 * Docs: https://docs.anthropic.com/en/api/messages
 * Retrieval date: 2026-04-15
 *
 * Confirmed shape (verified against the public API reference):
 *  - Endpoint: `POST https://api.anthropic.com/v1/messages`
 *  - Auth:    `x-api-key: <apiKey>`, `anthropic-version: 2023-06-01`
 *  - Request: `{ model, max_tokens, messages: [{ role, content }], temperature? }`
 *  - Response: `{ content: [{ type: "text", text: "..." }], usage: { input_tokens, output_tokens }, stop_reason }`
 *  - Errors:   `{ type: "error", error: { type: "<error_type>", message: "..." } }`
 *
 * Security:
 *  - The API key is NEVER interpolated into error messages, logs, or
 *    toString() output. {@link AnthropicError} carries only the HTTP status,
 *    the provider error type (from the JSON body), and a REDACTED message.
 *  - Rate-limit enforcement + observability live one layer up
 *    ({@link ./factory.wrapWithGuards}). This adapter is transport-only.
 *
 * Testability: the constructor accepts an injected `fetch` so replay-cassette
 * tests ({@link ./__tests__/anthropic.test.ts}) can drive deterministic
 * responses without network access. Cassette file:
 * `__tests__/cassettes/anthropic-completion.json` (scrubbed of the API key).
 */

import type { LlmAdapter, LlmOptions, LlmResponse } from "../llm-adapter";

/** Stable provider identifier — used by the factory and `llm_config.provider_name`. */
export const ANTHROPIC_PROVIDER_NAME = "anthropic" as const;

/** Endpoint locked at the module level so tests can assert it verbatim. */
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

/** API version header required by Anthropic. */
const ANTHROPIC_VERSION = "2023-06-01";

/** Defaults picked to keep reason-text bounded and stable across runs. */
const DEFAULT_MAX_TOKENS = 256;
const DEFAULT_TEMPERATURE = 0.7;

/**
 * Per-request timeout. Anthropic Messages API normally finishes in 2–15s at
 * max_tokens~256; anything over this is a network-layer problem. Keeps the
 * snapshot route from hanging.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Constructor options. `fetch` is injectable so cassette tests can load a
 * recorded response without hitting the network. Production wiring passes the
 * global {@link fetch}.
 */
export interface AnthropicAdapterOptions {
  apiKey: string;
  model: string;
  /** Defaults to the global `fetch`. Inject in tests. */
  fetch?: typeof fetch;
}

/**
 * Error thrown on every non-2xx response from Anthropic.
 *
 * Fields exposed:
 *  - `status`    – HTTP status from the response.
 *  - `errorType` – provider error type when present (e.g. `"rate_limit_error"`).
 *
 * `message` is a stable, redacted description; it NEVER includes the API key,
 * URL query parameters, or response body excerpts that could smuggle secrets
 * into shared log aggregators.
 */
export class AnthropicError extends Error {
  readonly status: number;
  readonly errorType: string | null;

  constructor(args: { status: number; errorType: string | null }) {
    super(`anthropic request failed (status=${args.status})`);
    this.name = "AnthropicError";
    this.status = args.status;
    this.errorType = args.errorType;
  }
}

interface MessagesResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

function extractErrorType(body: unknown): string | null {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const err = (body as Record<string, unknown>).error;
    if (err && typeof err === "object" && !Array.isArray(err)) {
      const errType = (err as Record<string, unknown>).type;
      if (typeof errType === "string") return errType;
    }
  }
  return null;
}

/**
 * Real Anthropic Messages API adapter. Tenant isolation is handled upstream:
 * the factory decrypts the tenant's key and passes it into this constructor.
 * This class holds the plaintext key only in its closure; it never logs it.
 */
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

  async complete(prompt: string, options?: LlmOptions): Promise<LlmResponse> {
    const body = JSON.stringify({
      model: options?.model ?? this.model,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
      temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
    });

    // AbortController-based timeout: prevents the snapshot route from hanging
    // indefinitely on a stalled Anthropic connection. Cleared in the finally.
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), DEFAULT_REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await this.fetchImpl(ANTHROPIC_MESSAGES_URL, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body,
        signal: abortController.signal,
      });
    } catch (err) {
      clearTimeout(timeoutHandle);
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new AnthropicError({ status: 408, errorType: "timeout" });
      }
      throw err;
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (!res.ok) {
      let errorType: string | null = null;
      try {
        const errorBody: unknown = await res.json();
        errorType = extractErrorType(errorBody);
      } catch {
        // Non-JSON error body — keep errorType null. NEVER log the raw body:
        // it can include request URLs, model IDs, or server-side detail that
        // shouldn't leak into aggregators.
      }
      throw new AnthropicError({
        status: res.status,
        errorType,
      });
    }

    let parsed: MessagesResponse;
    try {
      parsed = (await res.json()) as MessagesResponse;
    } catch (_err) {
      throw new AnthropicError({
        status: res.status,
        errorType: "malformed_json",
      });
    }

    const textBlock = parsed.content?.find((block) => block.type === "text");
    const content = textBlock?.text;
    if (typeof content !== "string" || content.length === 0) {
      throw new AnthropicError({
        status: res.status,
        errorType: "missing_content",
      });
    }

    return {
      content,
      usage: {
        inputTokens: parsed.usage?.input_tokens ?? 0,
        outputTokens: parsed.usage?.output_tokens ?? 0,
      },
    };
  }
}
