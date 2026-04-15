import {
  createEvidence,
  createPerson,
  createSnapshot,
  createStateFlags,
  fixtureEligibleStrong,
  fixtureFewerContacts,
} from "@hap/config";
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

  it("does NOT render restricted evidence in the modal even when referenced by a person", () => {
    // Construct a non-restricted snapshot that nonetheless contains a
    // restricted evidence row referenced by a person — exactly the slip-through
    // case the UI-layer filter must catch.
    const okEv = createEvidence("t1", {
      id: "ev-ok",
      source: "hubspot",
      content: "Public engagement signal — visible.",
      confidence: 0.9,
      timestamp: new Date(),
      isRestricted: false,
    });
    const restrictedEv = createEvidence("t1", {
      id: "ev-secret",
      source: "internal-hr",
      content: "REDACTED — should never render.",
      confidence: 0.95,
      timestamp: new Date(),
      isRestricted: true,
    });
    const person = createPerson({
      id: "p1",
      name: "Alex Champion",
      title: "VP Eng",
      reasonToTalk: "Champion engagement.",
      evidenceRefs: [okEv.id, restrictedEv.id],
    });
    const snapshot = createSnapshot("t1", {
      companyId: "c1",
      eligibilityState: "eligible",
      reasonToContact: "Reason here.",
      people: [person],
      evidence: [okEv, restrictedEv],
      stateFlags: createStateFlags(),
      createdAt: new Date(),
    });

    const renderer = createRenderer("crm.record.tab");
    renderer.render(<EligibleView snapshot={snapshot} />);
    const button = renderer.findAll(Button)[0];
    if (!button) throw new Error("expected person button");
    button.trigger("onClick");

    const modalText = collectAllText(renderer.getRootNode());
    expect(modalText).toContain("Public engagement signal");
    expect(modalText).not.toContain("REDACTED");
    expect(modalText).not.toContain("ev-secret");
    expect(modalText).not.toContain("internal-hr");
  });
});
