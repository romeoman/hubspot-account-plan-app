/**
 * Tests for `generateNextMove` (Slice 2 Step 13).
 *
 * The zero-leak short-circuit is the security boundary: restricted,
 * ineligible, empty, or no-reason snapshots MUST NOT trigger any LLM call.
 * That invariant is asserted via a spy on `llmAdapter.complete`.
 */

import { createEvidence, createPerson, createSnapshot, createStateFlags } from "@hap/config";
import { describe, expect, it, vi } from "vitest";
import type { LlmAdapter, LlmResponse } from "../../adapters/llm-adapter";
import { generateNextMove } from "../next-move";

function makeAdapter(
  impl: (prompt: string) => LlmResponse | Promise<LlmResponse>,
  provider = "openai",
): LlmAdapter {
  return {
    provider,
    complete: vi.fn(async (prompt: string) => impl(prompt)),
  };
}

function eligibleSnap(tenantId: string) {
  const ev = createEvidence(tenantId, {
    id: "ev-1",
    source: "news",
    confidence: 0.9,
    content: "Acme announced a Series C funding round.",
    timestamp: new Date(),
    isRestricted: false,
  });
  return createSnapshot(tenantId, {
    companyId: "co-1",
    eligibilityState: "eligible",
    reasonToContact: "Fresh funding round reported by news.",
    people: [
      createPerson({
        id: "p-1",
        name: "Alex Champion",
        reasonToTalk: "Champion engagement.",
        evidenceRefs: ["ev-1"],
      }),
    ],
    evidence: [ev],
    trustScore: 0.9,
    stateFlags: createStateFlags(),
  });
}

describe("generateNextMove", () => {
  it("returns the LLM response for an eligible snapshot with a working adapter", async () => {
    const adapter = makeAdapter(() => ({
      content: "Draft an intro email referencing the Series C funding.",
      usage: { inputTokens: 10, outputTokens: 8 },
    }));
    const snap = eligibleSnap("t-1");

    const out = await generateNextMove({ snapshot: snap, llmAdapter: adapter });
    expect(out).toBe("Draft an intro email referencing the Series C funding.");
    expect(adapter.complete).toHaveBeenCalledTimes(1);
  });

  it("ZERO-LEAK: restricted snapshot → null AND LLM NEVER called", async () => {
    const adapter = makeAdapter(() => {
      throw new Error("should not be called");
    });
    const snap = createSnapshot("t-1", {
      companyId: "co-r",
      eligibilityState: "eligible",
      reasonToContact: undefined,
      people: [],
      evidence: [],
      stateFlags: createStateFlags({ restricted: true }),
    });

    const out = await generateNextMove({ snapshot: snap, llmAdapter: adapter });
    expect(out).toBeNull();
    expect(adapter.complete).toHaveBeenCalledTimes(0);
  });

  it("ZERO-LEAK: ineligible snapshot → null AND LLM NEVER called", async () => {
    const adapter = makeAdapter(() => {
      throw new Error("should not be called");
    });
    const snap = createSnapshot("t-1", {
      companyId: "co-i",
      eligibilityState: "ineligible",
      reasonToContact: undefined,
      people: [],
      evidence: [],
      stateFlags: createStateFlags({ ineligible: true }),
    });

    const out = await generateNextMove({ snapshot: snap, llmAdapter: adapter });
    expect(out).toBeNull();
    expect(adapter.complete).toHaveBeenCalledTimes(0);
  });

  it("ZERO-LEAK: empty-flag snapshot → null AND LLM NEVER called", async () => {
    const adapter = makeAdapter(() => {
      throw new Error("should not be called");
    });
    const snap = createSnapshot("t-1", {
      companyId: "co-e",
      eligibilityState: "eligible",
      reasonToContact: undefined,
      people: [],
      evidence: [],
      stateFlags: createStateFlags({ empty: true }),
    });

    const out = await generateNextMove({ snapshot: snap, llmAdapter: adapter });
    expect(out).toBeNull();
    expect(adapter.complete).toHaveBeenCalledTimes(0);
  });

  it("ZERO-LEAK: missing reasonToContact → null AND LLM NEVER called", async () => {
    const adapter = makeAdapter(() => {
      throw new Error("should not be called");
    });
    const snap = createSnapshot("t-1", {
      companyId: "co-nr",
      eligibilityState: "eligible",
      reasonToContact: undefined,
      people: [],
      evidence: [],
      stateFlags: createStateFlags(),
    });

    const out = await generateNextMove({ snapshot: snap, llmAdapter: adapter });
    expect(out).toBeNull();
    expect(adapter.complete).toHaveBeenCalledTimes(0);
  });

  it("ZERO-LEAK: empty-string reasonToContact → null AND LLM NEVER called", async () => {
    const adapter = makeAdapter(() => {
      throw new Error("should not be called");
    });
    const snap = createSnapshot("t-1", {
      companyId: "co-nr2",
      eligibilityState: "eligible",
      reasonToContact: "   ",
      people: [],
      evidence: [],
      stateFlags: createStateFlags(),
    });

    const out = await generateNextMove({ snapshot: snap, llmAdapter: adapter });
    expect(out).toBeNull();
    expect(adapter.complete).toHaveBeenCalledTimes(0);
  });

  it("returns null when LLM throws (graceful degradation)", async () => {
    const adapter = makeAdapter(() => {
      throw new Error("provider timeout");
    });
    const out = await generateNextMove({
      snapshot: eligibleSnap("t-1"),
      llmAdapter: adapter,
    });
    expect(out).toBeNull();
    expect(adapter.complete).toHaveBeenCalledTimes(1);
  });

  it("truncates LLM output at MAX_NEXT_MOVE_CHARS", async () => {
    const { MAX_NEXT_MOVE_CHARS } = await import("@hap/config");
    const long = "x".repeat(500);
    const adapter = makeAdapter(() => ({
      content: long,
      usage: { inputTokens: 1, outputTokens: 500 },
    }));
    const out = await generateNextMove({
      snapshot: eligibleSnap("t-1"),
      llmAdapter: adapter,
    });
    expect(out).not.toBeNull();
    expect(out?.length).toBe(MAX_NEXT_MOVE_CHARS);
  });

  it("strips trailing whitespace and newlines", async () => {
    const adapter = makeAdapter(() => ({
      content: "Draft an intro email.\n\n   ",
      usage: { inputTokens: 1, outputTokens: 5 },
    }));
    const out = await generateNextMove({
      snapshot: eligibleSnap("t-1"),
      llmAdapter: adapter,
    });
    expect(out).toBe("Draft an intro email.");
  });

  it("returns null when LLM returns empty content", async () => {
    const adapter = makeAdapter(() => ({
      content: "   \n  ",
      usage: { inputTokens: 1, outputTokens: 0 },
    }));
    const out = await generateNextMove({
      snapshot: eligibleSnap("t-1"),
      llmAdapter: adapter,
    });
    expect(out).toBeNull();
  });
});
