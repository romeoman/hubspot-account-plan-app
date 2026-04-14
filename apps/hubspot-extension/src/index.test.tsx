import { Text } from "@hubspot/ui-extensions";
import { createRenderer } from "@hubspot/ui-extensions/testing";
import { describe, expect, it } from "vitest";
import { Extension } from "./index";

describe("HubSpot crm.record.tab extension smoke test", () => {
  it("creates a crm.record.tab renderer", () => {
    const renderer = createRenderer("crm.record.tab");
    expect(renderer.render).toBeTypeOf("function");
  });

  it("renders the Extension root with the mocked context", () => {
    const renderer = createRenderer("crm.record.tab");
    const root = renderer.render(<Extension context={renderer.mocks.context} />);

    const text = root.find(Text);
    expect(text.text).toBe("Signal-First Account Workspace — Loading");
  });
});
