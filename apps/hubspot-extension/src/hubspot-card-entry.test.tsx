import { createRenderer } from "@hubspot/ui-extensions/testing";
import { describe, expect, it, vi } from "vitest";
import { collectAllText } from "./features/snapshot/components/__tests__/test-utils";
import CardEntrypoint from "./hubspot-card-entry";
import { ExtensionRoot } from "./shared/extension-root";

describe("HubSpot card bundle entry", () => {
  it("exports a default entry component for HubSpot card bundling", () => {
    expect(CardEntrypoint).toBeTypeOf("function");
  });

  it("renders through the shared ExtensionRoot component", async () => {
    const renderer = createRenderer("crm.record.tab");
    const fetchCrmObjectProperties = vi.fn(async () => ({
      name: "Acme Inc",
      domain: "acme.test",
      hs_is_target_account: "true",
    }));
    const snapshotFetcher = vi.fn(async () => ({
      tenantId: "tenant-1",
      companyId: String(renderer.mocks.context.crm.objectId),
      eligibilityState: "eligible" as const,
      reasonToContact: "Shared root reason.",
      people: [],
      evidence: [],
      stateFlags: {
        stale: false,
        degraded: false,
        lowConfidence: false,
        ineligible: false,
        restricted: false,
        empty: false,
      },
      trustScore: 0.9,
      createdAt: "2026-04-10T12:00:00.000Z",
    }));

    renderer.render(
      <ExtensionRoot
        context={renderer.mocks.context}
        fetchCrmObjectProperties={fetchCrmObjectProperties}
        snapshotFetcher={snapshotFetcher}
      />,
    );

    await renderer.waitFor(() => {
      expect(collectAllText(renderer.getRootNode())).toContain("Shared root reason.");
    });
  });
});
