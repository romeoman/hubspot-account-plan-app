/**
 * HubSpot enrichment signal adapter.
 *
 * This adapter is the first runtime consumer of the per-tenant OAuth-backed
 * {@link ../../lib/hubspot-client.HubSpotClient}. It reads the HubSpot company
 * plus recent associated engagements and emits tenant-stamped Evidence rows
 * with `source: "hubspot-enrichment"`.
 */

import { createEvidence, type Evidence } from "@hap/config";
import type { HubSpotClient } from "../../lib/hubspot-client";
import type { ProviderAdapter, ProviderCompanyContext } from "../provider-adapter";

export const HUBSPOT_ENRICHMENT_PROVIDER_NAME = "hubspot-enrichment" as const;

export class HubSpotEnrichmentAdapter implements ProviderAdapter {
  readonly name = HUBSPOT_ENRICHMENT_PROVIDER_NAME;
  private readonly client: HubSpotClient;

  constructor(client: HubSpotClient) {
    this.client = client;
  }

  async fetchSignals(tenantId: string, company: ProviderCompanyContext): Promise<Evidence[]> {
    const companyProperties = await this.client.getCompanyProperties(company.companyId, [
      "name",
      "domain",
    ]);
    const companyName = company.companyName ?? companyProperties.name ?? company.companyId;
    const domain = company.domain ?? companyProperties.domain;
    const engagements = await this.client.getCompanyEngagements(company.companyId);

    return engagements.map((engagement) =>
      createEvidence(tenantId, {
        id: `hubspot-enrichment:${company.companyId}:${engagement.id}`,
        source: HUBSPOT_ENRICHMENT_PROVIDER_NAME,
        timestamp: engagement.timestamp,
        confidence: 0.8,
        content: domain
          ? `${companyName} (${domain}) ${engagement.type}: ${engagement.content}`
          : `${companyName} ${engagement.type}: ${engagement.content}`,
        isRestricted: false,
      }),
    );
  }
}
