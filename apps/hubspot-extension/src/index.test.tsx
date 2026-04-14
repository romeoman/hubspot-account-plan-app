import { Text } from "@hubspot/ui-extensions";
import { createRenderer } from "@hubspot/ui-extensions/testing";
import { describe, expect, it, vi } from "vitest";
import { Extension } from "./index";

/**
 * Preflight smoke tests (kept green from commit 6267f1a) plus Step 10
 * wiring coverage: the `Extension` root component now consumes two hooks
 * (`useCompanyContext` + `useSnapshot`) and renders one of three
 * placeholder Text nodes depending on lifecycle state.
 */
describe("HubSpot crm.record.tab extension smoke test", () => {
  it("creates a crm.record.tab renderer", () => {
    const renderer = createRenderer("crm.record.tab");
    expect(renderer.render).toBeTypeOf("function");
  });

  it("renders the Loading placeholder while properties/snapshot are pending", () => {
    const renderer = createRenderer("crm.record.tab");
    // Never-resolving fetcher keeps `useCompanyContext` in loading state.
    const fetchCrmObjectProperties = vi.fn(() => new Promise<Record<string, string>>(() => {}));
    renderer.render(
      <Extension
        context={renderer.mocks.context}
        fetchCrmObjectProperties={fetchCrmObjectProperties}
      />,
    );

    expect(renderer.find(Text).text).toBe("Loading…");
  });

  it("renders the Loaded placeholder when properties + snapshot resolve", async () => {
    const renderer = createRenderer("crm.record.tab");
    const fetchCrmObjectProperties = vi.fn(async () => ({
      name: "Acme Inc",
      domain: "acme.test",
      hs_is_target_account: "true",
    }));

    // Stub the global fetch used by the default snapshot fetcher so the
    // extension's default transport returns a valid wire payload.
    const validSnapshot = {
      tenantId: "tenant-1",
      companyId: String(renderer.mocks.context.crm.objectId),
      eligibilityState: "eligible" as const,
      reasonToContact: "Placeholder reason.",
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
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify(validSnapshot), { status: 200 }));

    try {
      renderer.render(
        <Extension
          context={renderer.mocks.context}
          fetchCrmObjectProperties={fetchCrmObjectProperties}
        />,
      );

      await renderer.waitFor(() => {
        expect(renderer.find(Text).text).toBe("Loaded");
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("renders the Error placeholder when the snapshot fetch fails", async () => {
    const renderer = createRenderer("crm.record.tab");
    const fetchCrmObjectProperties = vi.fn(async () => ({
      name: "Acme",
      domain: "acme.test",
      hs_is_target_account: "true",
    }));
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("boom", { status: 500 }));

    try {
      renderer.render(
        <Extension
          context={renderer.mocks.context}
          fetchCrmObjectProperties={fetchCrmObjectProperties}
        />,
      );

      await renderer.waitFor(() => {
        expect(renderer.find(Text).text).toBe("Error");
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
