/**
 * News signal adapter — Slice 3 deferral stub.
 *
 * The factory ({@link ./factory.createSignalAdapter}) wires this class for
 * tenants configured with `provider='news'`. Calling {@link fetchSignals}
 * throws a clear deferral error so operators see it immediately instead of
 * hitting silent failures.
 *
 * Blocker: Slice 2 has not yet selected a news provider or provisioned a
 * key. Slice 3 will:
 *   - pick a provider (NewsAPI, GDELT, or similar)
 *   - surface its configurable source set via `provider_config.settings`
 *   - record a cassette using fetch-injection (same pattern as
 *     {@link ./exa.ExaAdapter}).
 *
 * @todo Slice 3: real news adapter (configurable source set; record cassette
 *   when key available).
 */

import type { Evidence } from "@hap/config";
import type { ProviderAdapter } from "../provider-adapter";

export const NEWS_PROVIDER_NAME = "news" as const;

export interface NewsAdapterOptions {
  apiKey: string;
  /** Configurable source set from `provider_config.settings.sources`. */
  sources?: readonly string[];
  /** Defaults to the global `fetch`. Inject in tests. */
  fetch?: typeof fetch;
}

export class NewsAdapter implements ProviderAdapter {
  readonly name = NEWS_PROVIDER_NAME;
  private readonly apiKey: string;
  private readonly sources: readonly string[] | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NewsAdapterOptions) {
    this.apiKey = options.apiKey;
    this.sources = options.sources;
    this.fetchImpl = options.fetch ?? fetch;
  }

  fetchSignals(_tenantId: string, _companyName: string, _domain?: string): Promise<Evidence[]> {
    // Touch fields so `noUnusedLocals`-style linters stay quiet without losing
    // the closure capture the Slice 3 implementation will need.
    void this.apiKey;
    void this.sources;
    void this.fetchImpl;
    return Promise.reject(
      new Error(
        "Slice 3: real news adapter not yet implemented; configurable source set + cassette recording when key available.",
      ),
    );
  }
}
