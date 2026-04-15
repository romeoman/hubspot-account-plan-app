/**
 * LLM adapter factory (Slice 2 Step 8).
 *
 * Resolves an {@link LlmAdapter} from a tenant-scoped {@link LlmProviderConfig}.
 * Decryption: the config-resolver
 * ({@link ../../lib/config-resolver.getLlmConfigByProvider}) already decrypts
 * `api_key_encrypted` into `apiKeyRef` before returning, so this factory just
 * reads plaintext from the config. The factory never touches ciphertext.
 *
 * Scope adjustment (Slice 2):
 *  - `openai` → real {@link ./openai.OpenAiAdapter}.
 *  - `anthropic` / `gemini` / `openrouter` / `custom` → scaffolded stubs whose
 *    `complete()` throws a clear `Slice 3: real <provider> adapter not yet
 *    implemented` error. Tenants can ALREADY configure these providers in
 *    `llm_config`; Slice 3 ships the bodies.
 *
 * Guardrails: {@link wrapWithGuards} returns a new {@link LlmAdapter} whose
 * `complete()` is rate-limited (token bucket, per-tenant × provider) and
 * wrapped with {@link withObservability} for structured logs + metrics +
 * correlation-ID propagation. Slice 2 Step 9's signal-adapter factory mirrors
 * this pattern.
 */

import type { LlmProviderConfig } from "@hap/config";
import {
  type ObservabilityContext,
  type SuccessAnnotations,
  withObservability,
} from "../../lib/observability";
import {
  DEFAULT_RATE_LIMIT_CONFIG,
  type RateLimitConfig,
  type RateLimiter,
} from "../../lib/rate-limiter";
import type { LlmAdapter, LlmOptions, LlmResponse } from "../llm-adapter";
import { AnthropicAdapter } from "./anthropic";
import { GeminiAdapter } from "./gemini";
import { OpenAiAdapter } from "./openai";
import { OpenAiCompatibleAdapter } from "./openai-compatible";
import { OpenRouterAdapter } from "./openrouter";

/** Optional constructor-injection hooks for tests and non-default wiring. */
export interface LlmFactoryDeps {
  /** Override global `fetch` (cassette tests). Propagated to the adapter. */
  fetch?: typeof fetch;
}

/**
 * Error thrown when a wrapped adapter call is denied by the rate limiter.
 * Carries the limiter's `retryAfterMs` so callers can surface an HTTP 429
 * with `Retry-After`.
 */
export class LlmRateLimitedError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super("llm request rate-limited");
    this.name = "LlmRateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Resolve an {@link LlmAdapter} from a tenant's LLM config.
 *
 * The `config.apiKeyRef` field is already plaintext here — the
 * config-resolver decrypts via {@link ../../lib/encryption.decryptProviderKey}
 * before caching. Callers therefore never see ciphertext.
 *
 * @throws Error when `config.provider` is not one of the five supported
 *   provider families. This is defense-in-depth: the domain type already
 *   narrows the union, but a malformed row ultimately escaping the resolver
 *   should fail loudly, not silently.
 */
export function createLlmAdapter(config: LlmProviderConfig, deps?: LlmFactoryDeps): LlmAdapter {
  const fetchImpl = deps?.fetch;
  switch (config.provider) {
    case "openai":
      return new OpenAiAdapter({
        apiKey: config.apiKeyRef,
        model: config.model,
        fetch: fetchImpl,
      });
    case "anthropic":
      return new AnthropicAdapter({
        apiKey: config.apiKeyRef,
        model: config.model,
        fetch: fetchImpl,
      });
    case "gemini":
      return new GeminiAdapter({
        apiKey: config.apiKeyRef,
        model: config.model,
        fetch: fetchImpl,
      });
    case "openrouter":
      return new OpenRouterAdapter({
        apiKey: config.apiKeyRef,
        model: config.model,
        fetch: fetchImpl,
      });
    case "custom": {
      if (!config.endpointUrl || config.endpointUrl.length === 0) {
        throw new Error("Custom LLM provider requires endpointUrl in llm_config");
      }
      return new OpenAiCompatibleAdapter({
        apiKey: config.apiKeyRef,
        model: config.model,
        baseUrl: config.endpointUrl,
        fetch: fetchImpl,
      });
    }
    default: {
      const provider = (config as { provider: string }).provider;
      throw new Error(`Unknown LLM provider: ${provider}`);
    }
  }
}

/** Context required to wrap an adapter call with rate-limiter + observability. */
export interface GuardContext {
  tenantId: string;
  correlationId?: string;
  rateLimiter: RateLimiter;
  rateLimitConfig?: RateLimitConfig;
}

/**
 * Wrap an {@link LlmAdapter} so that every `complete()` call:
 *  1. acquires a token from `ctx.rateLimiter` keyed on `(tenantId, provider)`;
 *     throws {@link LlmRateLimitedError} when denied.
 *  2. runs inside {@link withObservability} — a structured enter/exit log
 *     line with correlation ID + latency + token usage on the exit line.
 *
 * The returned adapter reuses the inner adapter's `provider` identifier so
 * downstream consumers (the snapshot assembler, metrics sinks) can't tell the
 * guard wrapper exists. That's deliberate — the guard is a cross-cutting
 * concern, not a new adapter family.
 */
export function wrapWithGuards(adapter: LlmAdapter, ctx: GuardContext): LlmAdapter {
  const rateLimitConfig = ctx.rateLimitConfig ?? DEFAULT_RATE_LIMIT_CONFIG;

  return {
    provider: adapter.provider,
    async complete(prompt: string, options?: LlmOptions): Promise<LlmResponse> {
      const { allowed, retryAfterMs } = await ctx.rateLimiter.acquire(
        ctx.tenantId,
        adapter.provider,
        rateLimitConfig,
      );
      if (!allowed) {
        throw new LlmRateLimitedError(retryAfterMs ?? 0);
      }

      const obsCtx: ObservabilityContext = {
        tenantId: ctx.tenantId,
        provider: adapter.provider,
        operation: "llm.complete",
        correlationId: ctx.correlationId,
      };

      const annotate = (result: LlmResponse): SuccessAnnotations => ({
        tokenUsage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        },
      });

      return withObservability(() => adapter.complete(prompt, options), obsCtx, annotate);
    },
  };
}
