/**
 * OpenAI chat completions adapter (Slice 2 Step 8).
 *
 * Docs: https://platform.openai.com/docs/api-reference/chat/create
 * Retrieval date: 2026-04-15
 *
 * Confirmed shape (verified against the public API reference):
 *  - Endpoint: `POST https://api.openai.com/v1/chat/completions`
 *  - Auth:    `Authorization: Bearer <apiKey>`
 *  - Request: `{ model, messages: [{ role, content }], max_tokens?, temperature? }`
 *  - Response: `{ choices: [{ message: { content } }], usage: { prompt_tokens, completion_tokens } }`
 *  - Errors:   `{ error: { message, type, code } }` with a `Retry-After` header on 429
 *
 * Security:
 *  - The API key is NEVER interpolated into error messages, logs, or
 *    toString() output. {@link OpenAiError} carries only the HTTP status,
 *    the provider error code (from the JSON body), a REDACTED message, and
 *    the optional Retry-After hint.
 *  - Rate-limit enforcement + observability live one layer up
 *    ({@link ./factory.wrapWithGuards}). This adapter is transport-only.
 *
 * Testability: the constructor accepts an injected `fetch` so replay-cassette
 * tests ({@link ./__tests__/openai.test.ts}) can drive deterministic
 * responses without network access. Cassette file:
 * `__tests__/cassettes/openai-completion.json` (scrubbed of the API key).
 */

import type { LlmAdapter, LlmOptions, LlmResponse } from "../llm-adapter";

/** Stable provider identifier — used by the factory and `llm_config.provider_name`. */
export const OPENAI_PROVIDER_NAME = "openai" as const;

/** Endpoint locked at the module level so tests can assert it verbatim. */
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

/** Defaults picked to keep reason-text bounded and stable across runs. */
const DEFAULT_MAX_TOKENS = 256;
const DEFAULT_TEMPERATURE = 0.7;

/**
 * Per-request timeout. OpenAI chat completions normally finish in 2–10s at
 * max_tokens≈256; anything over this is a network-layer problem (rate-limit
 * queue, transient upstream). Keeps the snapshot route from hanging.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Constructor options. `fetch` is injectable so cassette tests can load a
 * recorded response without hitting the network. Production wiring passes the
 * global {@link fetch}.
 */
export interface OpenAiAdapterOptions {
  apiKey: string;
  model: string;
  /** Defaults to the global `fetch`. Inject in tests. */
  fetch?: typeof fetch;
}

/**
 * Error thrown on every non-2xx response from OpenAI.
 *
 * Fields exposed:
 *  - `status`            – HTTP status from the response.
 *  - `code`              – provider error code when present (e.g. `"rate_limit_exceeded"`).
 *  - `retryAfterSeconds` – parsed `Retry-After` header when the server supplied one.
 *
 * `message` is a stable, redacted description; it NEVER includes the API key,
 * URL query parameters, or response body excerpts that could smuggle secrets
 * into shared log aggregators.
 */
export class OpenAiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(args: {
    status: number;
    code: string | null;
    retryAfterSeconds: number | null;
  }) {
    super(`openai request failed (status=${args.status})`);
    this.name = "OpenAiError";
    this.status = args.status;
    this.code = args.code;
    this.retryAfterSeconds = args.retryAfterSeconds;
  }
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const n = Number.parseInt(header, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function extractErrorCode(body: unknown): string | null {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const err = (body as Record<string, unknown>).error;
    if (err && typeof err === "object" && !Array.isArray(err)) {
      const code = (err as Record<string, unknown>).code;
      if (typeof code === "string") return code;
    }
  }
  return null;
}

/**
 * Real OpenAI chat-completions adapter. Tenant isolation is handled upstream:
 * the factory decrypts the tenant's key and passes it into this constructor.
 * This class holds the plaintext key only in its closure; it never logs it.
 */
export class OpenAiAdapter implements LlmAdapter {
  readonly provider = OPENAI_PROVIDER_NAME;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async complete(prompt: string, options?: LlmOptions): Promise<LlmResponse> {
    const body = JSON.stringify({
      model: options?.model ?? this.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
    });

    // AbortController-based timeout: prevents the snapshot route from hanging
    // indefinitely on a stalled OpenAI connection. Cleared in the finally.
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), DEFAULT_REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await this.fetchImpl(OPENAI_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: abortController.signal,
      });
    } catch (err) {
      clearTimeout(timeoutHandle);
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new OpenAiError({
          status: 408,
          code: "timeout",
          retryAfterSeconds: null,
        });
      }
      throw err;
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (!res.ok) {
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      let errorCode: string | null = null;
      try {
        const errorBody: unknown = await res.json();
        errorCode = extractErrorCode(errorBody);
      } catch {
        // Non-JSON error body — keep code null. NEVER log the raw body: it can
        // include request URLs, model IDs, or server-side detail that shouldn't
        // leak into aggregators.
      }
      throw new OpenAiError({
        status: res.status,
        code: errorCode,
        retryAfterSeconds: retryAfter,
      });
    }

    let parsed: ChatCompletionResponse;
    try {
      parsed = (await res.json()) as ChatCompletionResponse;
    } catch (_err) {
      throw new OpenAiError({
        status: res.status,
        code: "malformed_json",
        retryAfterSeconds: null,
      });
    }

    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new OpenAiError({
        status: res.status,
        code: "missing_content",
        retryAfterSeconds: null,
      });
    }

    return {
      content,
      usage: {
        inputTokens: parsed.usage?.prompt_tokens ?? 0,
        outputTokens: parsed.usage?.completion_tokens ?? 0,
      },
    };
  }
}
