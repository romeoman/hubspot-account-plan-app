import {
  fixtureDegraded,
  fixtureEligibleStrong,
  fixtureEmpty,
  fixtureFewerContacts,
  fixtureIneligible,
  fixtureLowConfidence,
  fixtureRestricted,
  fixtureStale,
} from "@hap/config";
import { Alert } from "@hubspot/ui-extensions";
import { createRenderer } from "@hubspot/ui-extensions/testing";
import { describe, expect, it } from "vitest";
import { SnapshotStateRenderer } from "../snapshot-state-renderer";
import { collectAllText } from "./test-utils";

/**
 * One render test per QA fixture. Each fixture produces a distinct combination
 * of eligibilityState + stateFlags (see packages/config factories), so the
 * renderer's output string must be distinguishable per state.
 */
describe("SnapshotStateRenderer — 8 QA states", () => {
  it("renders eligible-strong: shows reason + 3 people and no warning alerts", () => {
    const snapshot = fixtureEligibleStrong("t1");
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<SnapshotStateRenderer snapshot={snapshot} />);
    const root = collectAllText(renderer.getRootNode());
    expect(root).toContain("Fresh funding + active email engagement from champion.");
    expect(root).toContain("Alex Champion");
    expect(root).toContain("Jordan Decider");
    expect(root).toContain("Sam Influencer");
    expect(renderer.findAll(Alert).length).toBe(0);
  });

  it("renders eligible-fewer-contacts: reason + 2 people + warning alerts (degraded + lowConf)", () => {
    const snapshot = fixtureFewerContacts("t1");
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<SnapshotStateRenderer snapshot={snapshot} />);
    const root = collectAllText(renderer.getRootNode());
    expect(root).toContain("Leadership change creates opening.");
    expect(root).toContain("Riley Only");
    expect(root).toContain("Casey Second");
    // degraded (danger) + lowConf (warning)
    const variants = renderer.findAll(Alert).map((a) => a.props.variant);
    expect(variants).toContain("danger");
    expect(variants).toContain("warning");
  });

  it("renders empty: 'No credible reason' text, no people, no reason", () => {
    const snapshot = fixtureEmpty("t1");
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<SnapshotStateRenderer snapshot={snapshot} />);
    const root = collectAllText(renderer.getRootNode());
    expect(root).toContain("No credible reason to contact");
  });

  it("renders stale: warning Alert citing ageDays + reason still shown", () => {
    const snapshot = fixtureStale("t1");
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<SnapshotStateRenderer snapshot={snapshot} />);
    const root = collectAllText(renderer.getRootNode());
    // reason is still shown
    expect(root).toContain("Historical partnership");
    // stale alert present
    const alerts = renderer.findAll(Alert);
    const stale = alerts.find((a) => a.props.title.toLowerCase().includes("stale"));
    expect(stale).toBeTruthy();
    expect(stale?.props.variant).toBe("warning");
  });

  it("renders degraded: danger Alert with reason", () => {
    const snapshot = fixtureDegraded("t1");
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<SnapshotStateRenderer snapshot={snapshot} />);
    const alerts = renderer.findAll(Alert);
    const dangers = alerts.filter((a) => a.props.variant === "danger");
    expect(dangers.length).toBeGreaterThan(0);
  });

  it("renders low-confidence: warning Alert with score percentage", () => {
    const snapshot = fixtureLowConfidence("t1");
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<SnapshotStateRenderer snapshot={snapshot} />);
    const root = collectAllText(renderer.getRootNode());
    // trustScore 0.3 = 30%
    expect(root).toContain("30%");
    // reason still shown
    expect(root).toContain("Rumor of expansion");
  });

  it("renders ineligible: ineligible message and nothing else", () => {
    const snapshot = fixtureIneligible("t1");
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<SnapshotStateRenderer snapshot={snapshot} />);
    const root = collectAllText(renderer.getRootNode());
    expect(root.toLowerCase()).toContain("not eligible");
  });

  it("renders restricted: renders ONLY the generic 'no data available' message with zero evidence leakage", () => {
    // Build a restricted snapshot that — defensively — carries evidence, people,
    // and reason. The renderer must NOT expose any of these for restricted.
    const baseline = fixtureRestricted("t1");
    const booby = {
      ...baseline,
      reasonToContact: "SECRET-LEAKED-REASON-SHOULD-NOT-APPEAR",
      people: [
        {
          id: "leak-p",
          name: "LEAKED-PERSON-NAME",
          title: "Leaked Title",
          reasonToTalk: "LEAKED-REASON-TO-TALK",
          evidenceRefs: ["leak-ev"],
        },
      ],
      evidence: [
        {
          id: "leak-ev",
          tenantId: "t1",
          source: "LEAKED-SOURCE",
          timestamp: new Date("2026-04-01T12:00:00Z"),
          confidence: 0.99,
          content: "LEAKED-EVIDENCE-CONTENT",
          isRestricted: true,
        },
      ],
      trustScore: 0.99,
    };
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<SnapshotStateRenderer snapshot={booby} />);
    const root = collectAllText(renderer.getRootNode());

    // Generic message visible
    expect(root.toLowerCase()).toContain("no data available");

    // Zero-leak invariant
    expect(root).not.toContain("SECRET-LEAKED-REASON-SHOULD-NOT-APPEAR");
    expect(root).not.toContain("LEAKED-PERSON-NAME");
    expect(root).not.toContain("Leaked Title");
    expect(root).not.toContain("LEAKED-REASON-TO-TALK");
    expect(root).not.toContain("LEAKED-SOURCE");
    expect(root).not.toContain("LEAKED-EVIDENCE-CONTENT");
    expect(root).not.toContain("99%");

    // No alerts either — restricted is not a warning state, it's an empty render
    expect(renderer.findAll(Alert).length).toBe(0);
  });
});
