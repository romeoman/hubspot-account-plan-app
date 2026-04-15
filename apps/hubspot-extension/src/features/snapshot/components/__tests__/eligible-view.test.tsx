import { fixtureEligibleStrong, fixtureFewerContacts } from "@hap/config";
import { Button, Modal } from "@hubspot/ui-extensions";
import { createRenderer } from "@hubspot/ui-extensions/testing";
import { describe, expect, it } from "vitest";
import { EligibleView } from "../eligible-view";
import { collectAllText } from "./test-utils";

describe("EligibleView", () => {
  it("renders the reason and exactly N people buttons for N=3", () => {
    const snapshot = fixtureEligibleStrong("t1");
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<EligibleView snapshot={snapshot} />);
    // reason is rendered somewhere
    expect(collectAllText(renderer.getRootNode())).toContain(
      "Fresh funding + active email engagement from champion.",
    );
    // one button per person
    const buttons = renderer.findAll(Button);
    expect(buttons.length).toBe(snapshot.people.length);
    expect(buttons.length).toBe(3);
    // each person's name shows up
    for (const p of snapshot.people) {
      expect(collectAllText(renderer.getRootNode())).toContain(p.name);
    }
  });

  it("renders only as many people as exist when fewer than 3 (no filler contacts)", () => {
    const snapshot = fixtureFewerContacts("t1");
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<EligibleView snapshot={snapshot} />);
    const buttons = renderer.findAll(Button);
    expect(buttons.length).toBe(snapshot.people.length);
    expect(buttons.length).toBe(2);
  });

  it("clicking a person opens the evidence modal", () => {
    const snapshot = fixtureEligibleStrong("t1");
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<EligibleView snapshot={snapshot} />);
    expect(renderer.maybeFind(Modal)).toBeNull();
    const first = renderer.findAll(Button)[0];
    if (!first) throw new Error("expected at least one person button");
    first.trigger("onClick");
    expect(renderer.find(Modal)).toBeTruthy();
  });
});
