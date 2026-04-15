import { Text } from "@hubspot/ui-extensions";
import { createRenderer } from "@hubspot/ui-extensions/testing";
import { describe, expect, it } from "vitest";
import { EmptyState, IneligibleState, RestrictedState, UnconfiguredState } from "../empty-states";

/**
 * Each empty-state component renders ONE distinct, user-visible message.
 * The exact strings chosen here double as the per-state selector in the
 * higher-level renderer tests.
 */
describe("empty-state components", () => {
  it("EmptyState renders a 'no credible reason' message", () => {
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<EmptyState />);
    const text = renderer.find(Text).text;
    expect(text).toContain("No credible reason to contact");
  });

  it("IneligibleState renders an ineligible message", () => {
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<IneligibleState />);
    const text = renderer.find(Text).text;
    expect(text?.toLowerCase()).toContain("not eligible");
  });

  it("UnconfiguredState renders an unconfigured message", () => {
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<UnconfiguredState />);
    const text = renderer.find(Text).text;
    expect(text?.toLowerCase()).toContain("not configured");
  });

  it("RestrictedState renders a generic 'no data available' message with no evidence details", () => {
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<RestrictedState />);
    const text = renderer.find(Text).text;
    // Generic message only; must not leak any evidence-like vocabulary.
    expect(text?.toLowerCase()).toContain("no data available");
    expect(text?.toLowerCase()).not.toContain("evidence");
    expect(text?.toLowerCase()).not.toContain("restricted");
  });
});
