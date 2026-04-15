import { Modal, Text } from "@hubspot/ui-extensions";
import { createRenderer } from "@hubspot/ui-extensions/testing";
import { describe, expect, it, vi } from "vitest";
import { EvidenceModal } from "../evidence-modal";
import { collectAllText } from "./test-utils";

const ev = [
  {
    id: "ev-1",
    tenantId: "t1",
    source: "news",
    timestamp: new Date("2026-04-01T12:00:00Z"),
    confidence: 0.82,
    content: "Funding round announced",
    isRestricted: false,
  },
  {
    id: "ev-2",
    tenantId: "t1",
    source: "hubspot",
    timestamp: new Date("2026-04-05T09:00:00Z"),
    confidence: 0.93,
    content: "Email open from champion",
    isRestricted: false,
  },
];

describe("EvidenceModal", () => {
  it("does not render a Modal when `open` is false", () => {
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<EvidenceModal evidence={ev} open={false} onClose={() => {}} />);
    expect(renderer.maybeFind(Modal)).toBeNull();
  });

  it("renders a Modal when open with each evidence row's source, timestamp, confidence, and content", () => {
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<EvidenceModal evidence={ev} open onClose={() => {}} />);
    const modal = renderer.find(Modal);
    expect(modal).toBeTruthy();
    const body = collectAllText(modal);
    // Sources
    expect(body).toContain("news");
    expect(body).toContain("hubspot");
    // Confidences formatted as %
    expect(body).toContain("82%");
    expect(body).toContain("93%");
    // Content
    expect(body).toContain("Funding round announced");
    expect(body).toContain("Email open from champion");
    // Timestamps — ISO date prefix only (matches `formatTimestamp`).
    expect(body).toContain("2026-04-01");
    expect(body).toContain("2026-04-05");
  });

  it("invokes onClose when the Modal's onClose fires (a11y dismiss path)", () => {
    const renderer = createRenderer("crm.record.tab");
    const onClose = vi.fn();
    renderer.render(<EvidenceModal evidence={ev} open onClose={onClose} />);
    const modal = renderer.find(Modal);
    modal.trigger("onClose");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders a placeholder when there is no evidence to show", () => {
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<EvidenceModal evidence={[]} open onClose={() => {}} />);
    const modal = renderer.find(Modal);
    expect(collectAllText(modal).toLowerCase()).toContain("no evidence");
    // Text node exists
    expect(renderer.findAll(Text).length).toBeGreaterThan(0);
  });
});
