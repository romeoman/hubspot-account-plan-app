import { Text } from "@hubspot/ui-extensions";
import { createRenderer } from "@hubspot/ui-extensions/testing";
import { describe, expect, it, vi } from "vitest";
import { useCompanyContext } from "../use-company-context";

/**
 * Probe component so we can assert on values returned by the hook via
 * rendered text. Each tested field is serialized into a single Text so the
 * renderer harness can read it back as `root.text`.
 */
function Probe({
  context,
  fetchCrmObjectProperties,
}: {
  context: Parameters<typeof useCompanyContext>[0];
  fetchCrmObjectProperties: Parameters<typeof useCompanyContext>[1];
}) {
  const state = useCompanyContext(context, fetchCrmObjectProperties);
  return (
    <Text>
      {JSON.stringify({
        companyId: state.companyId,
        objectType: state.objectType,
        portalId: state.portalId,
        properties: state.properties,
        loading: state.loading,
        error: state.error ? state.error.message : null,
      })}
    </Text>
  );
}

describe("useCompanyContext", () => {
  it("reads companyId, objectType, and portalId from the HubSpot context", async () => {
    const renderer = createRenderer("crm.record.tab");
    // Override mock context with deterministic values.
    const ctx = {
      ...renderer.mocks.context,
      crm: { objectId: 12345, objectTypeId: "0-2" },
      portal: { ...renderer.mocks.context.portal, id: 777 },
    };
    const fetchCrmObjectProperties = vi.fn(async () => ({
      name: "Acme Inc",
      domain: "acme.test",
      hs_is_target_account: "true",
    }));

    renderer.render(<Probe context={ctx} fetchCrmObjectProperties={fetchCrmObjectProperties} />);

    // Wait for the property fetch to resolve.
    await renderer.waitFor(() => {
      const parsed = JSON.parse(renderer.find(Text).text ?? "{}");
      expect(parsed.loading).toBe(false);
    });

    const parsed = JSON.parse(renderer.find(Text).text ?? "{}");
    expect(parsed.companyId).toBe("12345");
    expect(parsed.objectType).toBe("0-2");
    expect(parsed.portalId).toBe("777");
    expect(parsed.properties).toEqual({
      name: "Acme Inc",
      domain: "acme.test",
      hsIsTargetAccount: true,
    });
    expect(parsed.error).toBeNull();
    expect(fetchCrmObjectProperties).toHaveBeenCalledWith([
      "name",
      "domain",
      "hs_is_target_account",
    ]);
  });

  it("surfaces a loading state before properties resolve", () => {
    const renderer = createRenderer("crm.record.tab");
    const ctx = {
      ...renderer.mocks.context,
      crm: { objectId: 42, objectTypeId: "0-2" },
      portal: { ...renderer.mocks.context.portal, id: 9 },
    };
    // Never resolves during this synchronous render.
    const fetchCrmObjectProperties = vi.fn(() => new Promise<Record<string, string>>(() => {}));

    renderer.render(<Probe context={ctx} fetchCrmObjectProperties={fetchCrmObjectProperties} />);

    const parsed = JSON.parse(renderer.find(Text).text ?? "{}");
    expect(parsed.loading).toBe(true);
    expect(parsed.companyId).toBe("42");
  });

  it("captures a fetch error without crashing", async () => {
    const renderer = createRenderer("crm.record.tab");
    const ctx = {
      ...renderer.mocks.context,
      crm: { objectId: 1, objectTypeId: "0-2" },
      portal: { ...renderer.mocks.context.portal, id: 2 },
    };
    const fetchCrmObjectProperties = vi.fn(async () => {
      throw new Error("hubspot-property-fetch-failed");
    });

    renderer.render(<Probe context={ctx} fetchCrmObjectProperties={fetchCrmObjectProperties} />);

    await renderer.waitFor(() => {
      const parsed = JSON.parse(renderer.find(Text).text ?? "{}");
      expect(parsed.loading).toBe(false);
    });
    const parsed = JSON.parse(renderer.find(Text).text ?? "{}");
    expect(parsed.error).toBe("hubspot-property-fetch-failed");
  });
});
