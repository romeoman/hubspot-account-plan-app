import { createSnapshot, createStateFlags } from "@hap/config";
import { createRenderer } from "@hubspot/ui-extensions/testing";
import { describe, expect, it } from "vitest";
import { NextMoveCard } from "../next-move-card";
import { collectAllText } from "./test-utils";

function base(tenantId: string) {
  return createSnapshot(tenantId, {
    companyId: "co-1",
    eligibilityState: "eligible",
    reasonToContact: "A real reason.",
    people: [],
    evidence: [],
    stateFlags: createStateFlags(),
  });
}

describe("NextMoveCard", () => {
  it("renders the nextMove text on an eligible snapshot", () => {
    const snap = {
      ...base("t1"),
      nextMove: "Draft an intro email referencing the Q3 product launch.",
    };
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<NextMoveCard snapshot={snap} />);
    const text = collectAllText(renderer.getRootNode());
    expect(text).toContain("Suggested next move");
    expect(text).toContain("Draft an intro email referencing the Q3 product launch.");
  });

  it("renders nothing when nextMove is undefined", () => {
    const snap = base("t1");
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<NextMoveCard snapshot={snap} />);
    expect(collectAllText(renderer.getRootNode())).not.toContain("Suggested next move");
  });

  it("renders nothing when nextMove is whitespace-only", () => {
    const snap = { ...base("t1"), nextMove: "   \n" };
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<NextMoveCard snapshot={snap} />);
    expect(collectAllText(renderer.getRootNode())).not.toContain("Suggested next move");
  });

  it("renders nothing when stateFlags.restricted is true even with a nextMove set", () => {
    const snap = {
      ...base("t1"),
      stateFlags: createStateFlags({ restricted: true }),
      nextMove: "SHOULD NOT APPEAR",
    };
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<NextMoveCard snapshot={snap} />);
    const text = collectAllText(renderer.getRootNode());
    expect(text).not.toContain("Suggested next move");
    expect(text).not.toContain("SHOULD NOT APPEAR");
  });

  it("renders nothing when stateFlags.ineligible is true even with a nextMove set", () => {
    const snap = {
      ...base("t1"),
      stateFlags: createStateFlags({ ineligible: true }),
      nextMove: "SHOULD NOT APPEAR",
    };
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<NextMoveCard snapshot={snap} />);
    const text = collectAllText(renderer.getRootNode());
    expect(text).not.toContain("Suggested next move");
    expect(text).not.toContain("SHOULD NOT APPEAR");
  });

  it("renders nothing when eligibilityState === 'ineligible' even with a nextMove set", () => {
    const snap = {
      ...base("t1"),
      eligibilityState: "ineligible" as const,
      nextMove: "SHOULD NOT APPEAR",
    };
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<NextMoveCard snapshot={snap} />);
    const text = collectAllText(renderer.getRootNode());
    expect(text).not.toContain("Suggested next move");
    expect(text).not.toContain("SHOULD NOT APPEAR");
  });

  it("renders nothing when stateFlags.empty is true even with a nextMove set", () => {
    const snap = {
      ...base("t1"),
      stateFlags: createStateFlags({ empty: true }),
      nextMove: "SHOULD NOT APPEAR",
    };
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<NextMoveCard snapshot={snap} />);
    expect(collectAllText(renderer.getRootNode())).not.toContain("SHOULD NOT APPEAR");
  });
});
