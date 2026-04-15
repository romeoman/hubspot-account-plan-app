/**
 * HubSpot enrichment signal adapter — Slice 3 deferral stub.
 *
 * The factory ({@link ./factory.createSignalAdapter}) wires this class for
 * tenants configured with `provider='hubspot-enrichment'`. Calling
 * {@link fetchSignals} throws a clear deferral error so operators see it
 * immediately instead of hitting silent failures.
 *
 * Blocker: requires `HUBSPOT_PRIVATE_APP_TOKEN` to be provisioned in the
 * environment (Step 14 will need it anyway for the seed script). Once
 * provisioned, Slice 3 will wire this adapter to
 * {@link ../../lib/hubspot-client.HubSpotClient} and ship a real
 * implementation with a recorded cassette.
 *
 * @todo Slice 3: implement HubSpot enrichment via
 *   HubSpotClient.getCompanyProperties + associated content fetch (follow the
 *   {@link ./exa.ExaAdapter} pattern; record cassette with real
 *   HUBSPOT_PRIVATE_APP_TOKEN).
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
        "Slice 3: real HubSpot enrichment adapter not yet implemented; needs HUBSPOT_PRIVATE_APP_TOKEN + cassette recording.",
      ),
    );
  }
}
