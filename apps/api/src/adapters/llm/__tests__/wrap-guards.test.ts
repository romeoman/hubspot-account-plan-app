import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __setLogSinkForTests, __setMetricsSinkForTests } from "../../../lib/observability";
import { RateLimiter } from "../../../lib/rate-limiter";
import type { LlmAdapter } from "../../llm-adapter";
import { LlmRateLimitedError, wrapWithGuards } from "../factory";

function makeAdapter(impl: LlmAdapter["complete"]): LlmAdapter {
  return { provider: "openai", complete: impl };
}

describe("wrapWithGuards", () => {
  const logs: Record<string, unknown>[] = [];

  beforeEach(() => {
    logs.length = 0;
    __setLogSinkForTests((line) => {
      logs.push(line);
    });
    __setMetricsSinkForTests(() => {});
  });

  afterEach(() => {
    __setLogSinkForTests(null);
    __setMetricsSinkForTests(null);
  });

  it("emits enter + success log lines with correlationId, tenantId, provider, operation", async () => {
    const inner = makeAdapter(async () => ({
      content: "hello",
      usage: { inputTokens: 5, outputTokens: 2 },
    }));
    const limiter = new RateLimiter();
    const wrapped = wrapWithGuards(inner, {
      tenantId: "tenant-A",
      correlationId: "corr-123",
      rateLimiter: limiter,
    });

    const res = await wrapped.complete("prompt");
    expect(res.content).toBe("hello");
    expect(wrapped.provider).toBe("openai");

    const fields = logs.map((l) => ({
      phase: l.phase,
      outcome: l.outcome,
      correlationId: l.correlationId,
      tenantId: l.tenantId,
      provider: l.provider,
      operation: l.operation,
    }));
    expect(fields).toEqual([
      {
        phase: "enter",
        outcome: undefined,
        correlationId: "corr-123",
        tenantId: "tenant-A",
        provider: "openai",
        operation: "llm.complete",
      },
      {
        phase: undefined,
        outcome: "success",
        correlationId: "corr-123",
        tenantId: "tenant-A",
        provider: "openai",
        operation: "llm.complete",
      },
    ]);
    // tokenUsage annotated on success line.
    expect(logs[1]?.tokenUsage).toEqual({ inputTokens: 5, outputTokens: 2 });
  });

  it("throws LlmRateLimitedError when limiter denies, and does NOT call inner adapter", async () => {
    let innerCalls = 0;
    const inner = makeAdapter(async () => {
      innerCalls += 1;
      return { content: "x", usage: { inputTokens: 1, outputTokens: 1 } };
    });
    // Tiny bucket: capacity=1 refill=1 rps. Second call in the same ms is denied.
    const limiter = new RateLimiter({ now: () => 0 });
    const wrapped = wrapWithGuards(inner, {
      tenantId: "T",
      correlationId: "c",
      rateLimiter: limiter,
      rateLimitConfig: { capacity: 1, refillRatePerSec: 1 },
    });

    await wrapped.complete("one"); // consumes the only token
    await expect(wrapped.complete("two")).rejects.toBeInstanceOf(LlmRateLimitedError);
    expect(innerCalls).toBe(1);
  });

  it("emits an error log line with errorClass on failure, no raw message", async () => {
    class FlakyError extends Error {
      constructor() {
        super("secret-should-not-appear-in-logs");
        this.name = "FlakyError";
      }
    }
    const inner = makeAdapter(async () => {
      throw new FlakyError();
    });
    const limiter = new RateLimiter();
    const wrapped = wrapWithGuards(inner, {
      tenantId: "T",
      correlationId: "c-err",
      rateLimiter: limiter,
    });

    await expect(wrapped.complete("x")).rejects.toBeInstanceOf(FlakyError);

    const errLine = logs.find((l) => l.outcome === "error");
    expect(errLine).toBeDefined();
    expect(errLine?.errorClass).toBe("FlakyError");
    // Raw message must never appear in the structured log.
    for (const line of logs) {
      expect(JSON.stringify(line)).not.toContain("secret-should-not-appear-in-logs");
    }
  });
});
