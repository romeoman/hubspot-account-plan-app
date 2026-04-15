import { Alert } from "@hubspot/ui-extensions";
import { createRenderer } from "@hubspot/ui-extensions/testing";
import { describe, expect, it } from "vitest";
import { DegradedWarning, LowConfidenceWarning, StaleWarning } from "../warning-states";

describe("warning-states", () => {
  it("StaleWarning renders a warning Alert containing the age in days", () => {
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<StaleWarning ageDays={120} />);
    const alert = renderer.find(Alert);
    expect(alert.props.variant).toBe("warning");
    expect(alert.props.title.toLowerCase()).toContain("stale");
    expect(alert.text).toContain("120");
  });

  it("DegradedWarning renders a danger Alert containing the reason", () => {
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<DegradedWarning reason="news adapter timed out" />);
    const alert = renderer.find(Alert);
    expect(alert.props.variant).toBe("danger");
    expect(alert.text).toContain("news adapter timed out");
  });

  it("LowConfidenceWarning renders a warning Alert with a formatted score", () => {
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<LowConfidenceWarning score={0.3} />);
    const alert = renderer.find(Alert);
    expect(alert.props.variant).toBe("warning");
    // score is formatted as a percentage with no decimals
    expect(alert.text).toContain("30%");
  });
});
