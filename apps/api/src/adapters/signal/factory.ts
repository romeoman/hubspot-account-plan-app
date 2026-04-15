/**
 * Signal adapter factory (Slice 2 Step 9).
 *
 * Resolves a {@link ProviderAdapter} from a tenant-scoped {@link ProviderConfig}.
 * Mirrors {@link ../llm/factory.createLlmAdapter} — Slice 3 should not have to
 * learn two different patterns.
 *
 * Decryption: the config-resolver
 * ({@link ../../lib/config-resolver.getProviderConfig}) already decrypts
 * `api_key_encrypted` into `apiKeyRef` before returning, so this factory just
 * reads plaintext from the config. The factory never touches ciphertext.
 *
 * Scope adjustment (Slice 2):
 *  - `exa` → real {@link ./exa.ExaAdapter}.
 *  - `hubspot-enrichment` / `news` → scaffolded stubs whose `fetchSignals()`
 *    throws a clear `Slice 3: real <provider> adapter not yet implemented`
 *    error. Tenants can ALREADY configure these providers in
 *    `provider_config`; Slice 3 ships the bodies once the required credentials
 *    are available (HUBSPOT_PRIVATE_APP_TOKEN, chosen news provider key).
 *
 * Guardrails: {@link wrapSignalWithGuards} returns a new {@link ProviderAdapter}
 * whose `fetchSignals()` is rate-limited (token bucket, per-tenant × provider)
 * and wrapped with {@link withObservability} for structured logs + metrics +
 * correlation-ID propagation. Sibling to the Step 8 LLM guard wrapper.
 */

import type { Evidence, ProviderConfig } from "@hap/config";
import type { HubSpotClient } from "../../lib/hubspot-client";
import { type ObservabilityContext, withObservability } from "../../lib/observability";
import {
  DEFAULT_RATE_LIMIT_CONFIG,
  type RateLimitConfig,
  type RateLimiter,
} from "../../lib/rate-limiter";
import type { ProviderAdapter } from "../provider-adapter";
import { ExaAdapter } from "./exa";
import { HubSpotEnrichmentAdapter } from "./hubspot-enrichment";
import { NewsAdapter } from "./news";

/** Optional constructor-injection hooks for tests and non-default wiring. */
export interface SignalFactoryDeps {
  /** Override global `fetch` (cassette tests). Propagated to the adapter. */
  fetch?: typeof fetch;
  /**
   * Injected HubSpot client. When omitted, the HubSpot enrichment branch
   * constructs a new {@link HubSpotClient} — which reads the env-held
   * `HUBSPOT_PRIVATE_APP_TOKEN`. Tests MUST inject a stub to avoid the env
   * read in unit tests.
   */
  hubspotClient?: HubSpotClient;
}

/**
 * Error thrown when a wrapped adapter call is denied by the rate limiter.
 * Carries the limiter's `retryAfterMs` so callers can surface an HTTP 429
 * with `Retry-After`. Sibling to {@link ../llm/factory.LlmRateLimitedError}.
 */
export class SignalRateLimitedError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super("signal request rate-limited");
    this.name = "SignalRateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Resolve a {@link ProviderAdapter} from a tenant's signal provider config.
 *
 * The `config.apiKeyRef` field is already plaintext here — the config-resolver
 * decrypts via {@link ../../lib/encryption.decryptProviderKey} before caching.
 * Callers therefore never see ciphertext.
 *
 * @throws Error when `config.name` is not one of the three supported signal
 *   providers. This is defense-in-depth: a malformed DB row ultimately
 *   escaping the resolver should fail loudly, not silently.
 */
export function createSignalAdapter(
  config: ProviderConfig,
  deps?: SignalFactoryDeps,
): ProviderAdapter {
  const fetchImpl = deps?.fetch;
  switch (config.name) {
    case "exa":
      return new ExaAdapter({
        apiKey: config.apiKeyRef,
        fetch: fetchImpl,
      });
    case "hubspot-enrichment": {
      // Tests MUST inject a client. Production wiring constructs one lazily
      // from the env — the client itself throws at construction if
      // HUBSPOT_PRIVATE_APP_TOKEN is missing, which surfaces a misconfigured
      // deploy loudly at first adapter call.
      const client = deps?.hubspotClient;
      if (!client) {
        // Defer the env read to call-site-level: we can't construct a
        // HubSpotClient here without importing it eagerly, which would pull a
        // hard env dependency into every factory call (including tests). The
        // Slice 3 implementation will either inject the client upstream or
        // lazily construct one — matching the existing llm-factory pattern.
        throw new Error(
          "createSignalAdapter: hubspot-enrichment requires an injected HubSpotClient (deps.hubspotClient).",
        );
      }
      return new HubSpotEnrichmentAdapter(client);
    }
    case "news":
      return new NewsAdapter({
        apiKey: config.apiKeyRef,
        fetch: fetchImpl,
      });
    default: {
      const name = (config as { name: string }).name;
      throw new Error(`Unknown signal provider: ${name}`);
    }
  }
}

/** Context required to wrap an adapter call with rate-limiter + observability. */
export interface SignalGuardContext {
  tenantId: string;
  correlationId?: string;
  rateLimiter: RateLimiter;
  rateLimitConfig?: RateLimitConfig;
}

/**
 * Wrap a {@link ProviderAdapter} so that every `fetchSignals()` call:
 *  1. acquires a token from `ctx.rateLimiter` keyed on `(tenantId, provider)`;
 *     throws {@link SignalRateLimitedError} when denied.
 *  2. runs inside {@link withObservability} — a structured enter/exit log
 *     line with correlation ID + latency. `operation` is `"signal.fetch"`.
 *
 * The returned adapter reuses the inner adapter's `name` so downstream
 * consumers (the snapshot assembler, metrics sinks) can't tell the guard
 * wrapper exists. That's deliberate — the guard is a cross-cutting concern,
 * not a new adapter family.
 */
export function wrapSignalWithGuards(
  adapter: ProviderAdapter,
  ctx: SignalGuardContext,
): ProviderAdapter {
  const rateLimitConfig = ctx.rateLimitConfig ?? DEFAULT_RATE_LIMIT_CONFIG;

  return {
    name: adapter.name,
    async fetchSignals(
      tenantId: string,
      companyName: string,
      domain?: string,
    ): Promise<Evidence[]> {
      const { allowed, retryAfterMs } = await ctx.rateLimiter.acquire(
        ctx.tenantId,
        adapter.name,
        rateLimitConfig,
      );
      if (!allowed) {
        throw new SignalRateLimitedError(retryAfterMs ?? 0);
      }

      const obsCtx: ObservabilityContext = {
        tenantId: ctx.tenantId,
        provider: adapter.name,
        operation: "signal.fetch",
        correlationId: ctx.correlationId,
      };

      return withObservability(() => adapter.fetchSignals(tenantId, companyName, domain), obsCtx);
    },
  };
}
