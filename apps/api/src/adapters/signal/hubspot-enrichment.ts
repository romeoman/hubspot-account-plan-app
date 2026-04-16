/**
 * HubSpot enrichment signal adapter — Phase 3 deferral stub.
 *
 * The factory ({@link ./factory.createSignalAdapter}) wires this class for
 * tenants configured with `provider='hubspot-enrichment'`. Calling
 * {@link fetchSignals} throws a clear deferral error.
 *
 * Deferred to Phase 3: the real implementation needs the per-tenant
 * OAuth-aware {@link ../../lib/hubspot-client.HubSpotClient} running
 * inside a `withTenantTxHandle` RLS context (Phase 3 Task 12). Once
 * RLS wiring lands, this adapter calls `HubSpotClient.getCompanyProperties`
 * + notes/engagement fetch and emits Evidence rows.
 */

import type { Evidence } from "@hap/config";
import type { HubSpotClient } from "../../lib/hubspot-client";
import type { ProviderAdapter } from "../provider-adapter";

export const HUBSPOT_ENRICHMENT_PROVIDER_NAME = "hubspot-enrichment" as const;

export class HubSpotEnrichmentAdapter implements ProviderAdapter {
  readonly name = HUBSPOT_ENRICHMENT_PROVIDER_NAME;
  private readonly client: HubSpotClient;

  constructor(client: HubSpotClient) {
    this.client = client;
  }

  fetchSignals(_tenantId: string, _companyName: string, _domain?: string): Promise<Evidence[]> {
    // Touch the field so `noUnusedLocals` stays quiet without losing the closure
    // capture the Slice 3 implementation will need.
    void this.client;
    return Promise.reject(
      new Error(
        "HubSpot enrichment adapter not yet implemented; deferred to Phase 3 (needs per-tenant OAuth + RLS tx context).",
      ),
    );
  }
}
