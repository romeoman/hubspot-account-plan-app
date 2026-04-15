import { Alert, Text } from "@hubspot/ui-extensions";
import { createRenderer } from "@hubspot/ui-extensions/testing";
import { describe, expect, it, vi } from "vitest";
import { collectAllText } from "./features/snapshot/components/__tests__/test-utils";
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

  it("renders the loaded snapshot via SnapshotStateRenderer when properties + snapshot resolve", async () => {
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
        expect(collectAllText(renderer.getRootNode())).toContain("Placeholder reason.");
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("renders the restricted empty view when the snapshot is restricted (zero-leak at the extension root)", async () => {
    const renderer = createRenderer("crm.record.tab");
    const fetchCrmObjectProperties = vi.fn(async () => ({
      name: "Acme Inc",
      domain: "acme.test",
      hs_is_target_account: "true",
    }));

    // Booby-trapped restricted snapshot: the wire carries a reason, a person,
    // and evidence. The UI must drop all three.
    const restrictedSnapshot = {
      tenantId: "tenant-1",
      companyId: String(renderer.mocks.context.crm.objectId),
      eligibilityState: "eligible" as const,
      reasonToContact: "SECRET-WIRE-REASON",
      people: [
        {
          id: "p-leak",
          name: "WIRE-LEAK-NAME",
          reasonToTalk: "WIRE-LEAK-TALK",
          evidenceRefs: ["e-leak"],
        },
      ],
      evidence: [
        {
          id: "e-leak",
          tenantId: "tenant-1",
          source: "WIRE-LEAK-SOURCE",
          timestamp: "2026-04-01T00:00:00.000Z",
          confidence: 0.99,
          content: "WIRE-LEAK-CONTENT",
          isRestricted: true,
        },
      ],
      stateFlags: {
        stale: false,
        degraded: false,
        lowConfidence: false,
        ineligible: false,
        restricted: true,
        empty: false,
      },
      trustScore: 0.99,
      createdAt: "2026-04-10T12:00:00.000Z",
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () => new Response(JSON.stringify(restrictedSnapshot), { status: 200 }),
      );

    try {
      renderer.render(
        <Extension
          context={renderer.mocks.context}
          fetchCrmObjectProperties={fetchCrmObjectProperties}
        />,
      );

      await renderer.waitFor(() => {
        expect(collectAllText(renderer.getRootNode()).toLowerCase()).toContain("no data available");
      });
      const out = collectAllText(renderer.getRootNode());
      expect(out).not.toContain("SECRET-WIRE-REASON");
      expect(out).not.toContain("WIRE-LEAK-NAME");
      expect(out).not.toContain("WIRE-LEAK-TALK");
      expect(out).not.toContain("WIRE-LEAK-SOURCE");
      expect(out).not.toContain("WIRE-LEAK-CONTENT");
      expect(renderer.findAll(Alert).length).toBe(0);
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
