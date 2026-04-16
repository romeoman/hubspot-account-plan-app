import { describe, expect, it, vi } from "vitest";
import type { HubSpotClient } from "../../../lib/hubspot-client";
import { HubSpotEnrichmentAdapter } from "../hubspot-enrichment";

describe("HubSpotEnrichmentAdapter", () => {
  it("looks up company data by companyId and emits hubspot-enrichment evidence", async () => {
    const client = {
      getCompanyProperties: vi.fn().mockResolvedValue({
        name: "Acme Corp",
        domain: "acme.example.com",
      }),
      getCompanyEngagements: vi.fn().mockResolvedValue([
        {
          id: "note-1",
          type: "note",
          timestamp: new Date("2026-04-10T10:00:00.000Z"),
          content: "Champion asked for rollout details.",
        },
      ]),
    } as unknown as HubSpotClient;

    const adapter = new HubSpotEnrichmentAdapter(client);
    const evidence = await adapter.fetchSignals("tenant-1", { companyId: "123" });

    expect(client.getCompanyProperties).toHaveBeenCalledWith("123", ["name", "domain"]);
    expect(client.getCompanyEngagements).toHaveBeenCalledWith("123");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.tenantId).toBe("tenant-1");
    expect(evidence[0]?.source).toBe("hubspot-enrichment");
    expect(evidence[0]?.content).toContain("Acme Corp");
    expect(evidence[0]?.content).toContain("Champion asked for rollout details.");
  });
});
