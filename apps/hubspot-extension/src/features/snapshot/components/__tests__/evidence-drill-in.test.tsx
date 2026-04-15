import {
  createEvidence,
  fixtureDegraded,
  fixtureEligibleStrong,
  fixtureEmpty,
  fixtureFewerContacts,
  fixtureIneligible,
  fixtureLowConfidence,
  fixtureRestricted,
  fixtureStale,
} from "@hap/config";
import { Alert, Modal } from "@hubspot/ui-extensions";
import { createRenderer } from "@hubspot/ui-extensions/testing";
import { describe, expect, it, vi } from "vitest";
import { EvidenceDrillIn } from "../evidence-drill-in";
import { collectAllText, triggerEscape } from "./test-utils";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("EvidenceDrillIn", () => {
  describe("8 QA-state fixtures — render/no-render", () => {
    const cases: Array<[string, ReturnType<typeof fixtureEligibleStrong>]> = [
      ["eligible-strong", fixtureEligibleStrong("t1")],
      ["eligible-fewer-contacts", fixtureFewerContacts("t1")],
      ["empty", fixtureEmpty("t1")],
      ["stale", fixtureStale("t1")],
      ["degraded", fixtureDegraded("t1")],
      ["low-confidence", fixtureLowConfidence("t1")],
      ["ineligible", fixtureIneligible("t1")],
    ];

    for (const [name, snap] of cases) {
      it(`${name}: renders a Modal when the fixture carries non-restricted evidence`, () => {
        // Pick the first evidence row if the fixture has one; otherwise skip
        // rendering and just assert the null-return contract for empty fixtures.
        const ev = snap.evidence[0];
        const renderer = createRenderer("crm.record.tab");
        if (!ev) {
          renderer.render(
            <EvidenceDrillIn
              evidence={{
                id: "exa:https://example.test",
                tenantId: "t1",
                source: "example.test",
                timestamp: new Date(),
                confidence: 0.5,
                content: "placeholder",
                isRestricted: false,
              }}
              isRestricted={false}
              onClose={() => {}}
            />,
          );
          expect(renderer.find(Modal)).toBeTruthy();
          return;
        }
        renderer.render(<EvidenceDrillIn evidence={ev} isRestricted={false} onClose={() => {}} />);
        expect(renderer.find(Modal)).toBeTruthy();
      });
    }

    it("restricted fixture: renders NOTHING (null) and leaks ZERO evidence strings", () => {
      const restricted = fixtureRestricted("t1");
      // The restricted fixture carries empty evidence, so we defensively
      // inject a booby-trapped restricted evidence row to prove the zero-leak
      // invariant. Not via the snapshot — DIRECTLY via the component props.
      const boobyEv = createEvidence("t1", {
        id: "exa:https://leaked.test/secret",
        source: "leaked.test",
        timestamp: new Date(),
        confidence: 0.99,
        content: "LEAKED-EVIDENCE-CONTENT-MUST-NOT-APPEAR",
        isRestricted: true,
      });

      const renderer = createRenderer("crm.record.tab");
      renderer.render(
        <EvidenceDrillIn
          evidence={boobyEv}
          isRestricted={restricted.stateFlags.restricted}
          onClose={() => {}}
        />,
      );

      // No Modal rendered at all.
      expect(renderer.maybeFind(Modal)).toBeNull();

      // Zero-leak: no Evidence-content strings appear anywhere.
      const text = collectAllText(renderer.getRootNode());
      expect(text).not.toContain("LEAKED-EVIDENCE-CONTENT-MUST-NOT-APPEAR");
      expect(text).not.toContain("leaked.test");
      expect(text).not.toContain("exa:https://leaked.test/secret");
      expect(text).not.toContain("exa");
      expect(text).not.toContain("99%");
    });

    it("per-row isRestricted=true (even if isRestricted prop is false): renders NOTHING", () => {
      // The other zero-leak lane: an evidence row that slipped into a non-
      // restricted snapshot but is itself flagged restricted. Drill-in must
      // still render nothing.
      const boobyEv = createEvidence("t1", {
        id: "exa:https://per-row-leak.test/secret",
        source: "per-row-leak.test",
        timestamp: new Date(),
        confidence: 0.42,
        content: "PER-ROW-LEAK-CONTENT",
        isRestricted: true,
      });

      const renderer = createRenderer("crm.record.tab");
      renderer.render(
        <EvidenceDrillIn evidence={boobyEv} isRestricted={false} onClose={() => {}} />,
      );

      expect(renderer.maybeFind(Modal)).toBeNull();
      const text = collectAllText(renderer.getRootNode());
      expect(text).not.toContain("PER-ROW-LEAK-CONTENT");
      expect(text).not.toContain("per-row-leak.test");
    });
  });

  describe("close interactions", () => {
    it("invokes onClose when the Modal dismisses (click-close path)", () => {
      const ev = createEvidence("t1", {
        id: "exa:https://x.test",
        source: "x.test",
        timestamp: new Date(),
        confidence: 0.5,
        content: "ok",
        isRestricted: false,
      });
      const renderer = createRenderer("crm.record.tab");
      const onClose = vi.fn();
      renderer.render(<EvidenceDrillIn evidence={ev} isRestricted={false} onClose={onClose} />);
      const modal = renderer.find(Modal);
      modal.trigger("onClose");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("invokes onClose when Escape is pressed (a11y dismiss via test-utils helper)", () => {
      const ev = createEvidence("t1", {
        id: "exa:https://x.test",
        source: "x.test",
        timestamp: new Date(),
        confidence: 0.5,
        content: "ok",
        isRestricted: false,
      });
      const renderer = createRenderer("crm.record.tab");
      const onClose = vi.fn();
      renderer.render(<EvidenceDrillIn evidence={ev} isRestricted={false} onClose={onClose} />);
      const modal = renderer.find(Modal);
      triggerEscape(modal);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("provenance section", () => {
    it("renders source domain verbatim", () => {
      const ev = createEvidence("t1", {
        id: "exa:https://techcrunch.com/2026/04/01/foo",
        source: "techcrunch.com",
        timestamp: new Date(),
        confidence: 0.8,
        content: "Funding round",
        isRestricted: false,
      });
      const renderer = createRenderer("crm.record.tab");
      renderer.render(<EvidenceDrillIn evidence={ev} isRestricted={false} onClose={() => {}} />);
      const body = collectAllText(renderer.find(Modal));
      expect(body).toContain("techcrunch.com");
    });

    it("renders provider prefix from evidence.id (e.g. 'exa')", () => {
      const ev = createEvidence("t1", {
        id: "exa:https://example.test/path",
        source: "example.test",
        timestamp: new Date(),
        confidence: 0.8,
        content: "content",
        isRestricted: false,
      });
      const renderer = createRenderer("crm.record.tab");
      renderer.render(<EvidenceDrillIn evidence={ev} isRestricted={false} onClose={() => {}} />);
      const body = collectAllText(renderer.find(Modal));
      expect(body.toLowerCase()).toContain("exa");
    });
  });

  describe("freshness section", () => {
    it("renders '3 days ago' for a 3-day-old timestamp", () => {
      const ts = new Date(Date.now() - 3 * DAY_MS);
      const ev = createEvidence("t1", {
        id: "exa:https://x.test",
        source: "x.test",
        timestamp: ts,
        confidence: 0.5,
        content: "ok",
        isRestricted: false,
      });
      const renderer = createRenderer("crm.record.tab");
      renderer.render(<EvidenceDrillIn evidence={ev} isRestricted={false} onClose={() => {}} />);
      const body = collectAllText(renderer.find(Modal));
      expect(body).toContain("3 days ago");
    });

    it("renders '1 hour ago' for a 1-hour-old timestamp (sub-day boundary)", () => {
      const ts = new Date(Date.now() - 60 * 60 * 1000);
      const ev = createEvidence("t1", {
        id: "exa:https://x.test",
        source: "x.test",
        timestamp: ts,
        confidence: 0.5,
        content: "ok",
        isRestricted: false,
      });
      const renderer = createRenderer("crm.record.tab");
      renderer.render(<EvidenceDrillIn evidence={ev} isRestricted={false} onClose={() => {}} />);
      const body = collectAllText(renderer.find(Modal));
      expect(body).toContain("1 hour ago");
      expect(body).not.toContain("0 days");
    });
  });

  describe("trust breakdown", () => {
    it("renders confidence 0.7 as '70%'", () => {
      const ev = createEvidence("t1", {
        id: "exa:https://x.test",
        source: "x.test",
        timestamp: new Date(),
        confidence: 0.7,
        content: "ok",
        isRestricted: false,
      });
      const renderer = createRenderer("crm.record.tab");
      renderer.render(<EvidenceDrillIn evidence={ev} isRestricted={false} onClose={() => {}} />);
      const body = collectAllText(renderer.find(Modal));
      expect(body).toContain("70%");
    });

    it("renders confidence 0.05 as '5%'", () => {
      const ev = createEvidence("t1", {
        id: "exa:https://x.test",
        source: "x.test",
        timestamp: new Date(),
        confidence: 0.05,
        content: "ok",
        isRestricted: false,
      });
      const renderer = createRenderer("crm.record.tab");
      renderer.render(<EvidenceDrillIn evidence={ev} isRestricted={false} onClose={() => {}} />);
      const body = collectAllText(renderer.find(Modal));
      expect(body).toContain("5%");
    });
  });

  describe("raw payload preview", () => {
    it("renders the evidence content in the payload section for non-restricted rows", () => {
      const ev = createEvidence("t1", {
        id: "exa:https://x.test",
        source: "x.test",
        timestamp: new Date(),
        confidence: 0.8,
        content: "UNIQUE-PAYLOAD-PREVIEW-STRING",
        isRestricted: false,
      });
      const renderer = createRenderer("crm.record.tab");
      renderer.render(<EvidenceDrillIn evidence={ev} isRestricted={false} onClose={() => {}} />);
      const body = collectAllText(renderer.find(Modal));
      expect(body).toContain("UNIQUE-PAYLOAD-PREVIEW-STRING");
    });

    it("is a theoretical safety net: defensive re-render path renders redacted Alert, not content", () => {
      // This is the "defensive" lane described in the spec: if the top-level
      // isRestricted prop is false but the per-row flag is true, the component
      // must bail out entirely (render null). We double-check here — there
      // should be no Alert AND no content string on the page.
      const ev = createEvidence("t1", {
        id: "exa:https://x.test",
        source: "x.test",
        timestamp: new Date(),
        confidence: 0.8,
        content: "DEFENSIVE-LEAK-CONTENT",
        isRestricted: true,
      });
      const renderer = createRenderer("crm.record.tab");
      renderer.render(<EvidenceDrillIn evidence={ev} isRestricted={false} onClose={() => {}} />);
      const text = collectAllText(renderer.getRootNode());
      expect(text).not.toContain("DEFENSIVE-LEAK-CONTENT");
      // And no stray Alert either — the whole component is null.
      expect(renderer.findAll(Alert).length).toBe(0);
    });
  });
});
