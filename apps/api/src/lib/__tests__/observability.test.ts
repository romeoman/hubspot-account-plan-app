/**
 * Tests for the observability wrapper (Slice 2 Step 7).
 *
 * Contract under test:
 *   - `withObservability` generates / propagates a correlation ID.
 *   - Emits structured JSON-line logs on enter + exit.
 *   - Re-throws errors; error log includes `errorClass` but NOT the error
 *     message body, stack trace, or request body.
 *   - Log fields are limited to a fixed allow-list.
 *   - `crypto.randomUUID()` generates correlation IDs (not derived from any
 *     user-controlled value such as tenantId).
 *   - `metrics.record()` writes to the pluggable metrics sink.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __setLogSinkForTests,
  __setMetricsSinkForTests,
  metrics,
  type ObservabilityContext,
  withObservability,
} from "../observability";

const ALLOWED_FIELDS = new Set([
  "correlationId",
  "tenantId",
  "provider",
  "operation",
  "latencyMs",
  "outcome",
  "errorClass",
  "tokenUsage",
  "phase",
]);

describe("withObservability", () => {
  let lines: Array<Record<string, unknown>>;

  beforeEach(() => {
    lines = [];
    __setLogSinkForTests((line) => lines.push(line as Record<string, unknown>));
    __setMetricsSinkForTests(() => {});
  });

  afterEach(() => {
    __setLogSinkForTests(null);
    __setMetricsSinkForTests(null);
  });

  it("returns the inner fn's result and emits enter + success log lines", async () => {
    const ctx: ObservabilityContext = {
      tenantId: "t-1",
      provider: "exa",
      operation: "signal.fetch",
    };
    const result = await withObservability(async () => 42, ctx);

    expect(result).toBe(42);
    expect(lines.length).toBe(2);
    expect(lines[0]?.phase).toBe("enter");
    expect(lines[1]?.outcome).toBe("success");
    expect(lines[1]?.tenantId).toBe("t-1");
    expect(lines[1]?.provider).toBe("exa");
    expect(lines[1]?.operation).toBe("signal.fetch");
    expect(typeof lines[1]?.latencyMs).toBe("number");
  });

  it("re-throws errors and emits an error log line with errorClass (no message body)", async () => {
    class MyError extends Error {
      constructor() {
        super("sensitive boom payload");
      }
    }
    const ctx: ObservabilityContext = {
      tenantId: "t-1",
      provider: "openai",
      operation: "llm.complete",
    };

    await expect(
      withObservability(async () => {
        throw new MyError();
      }, ctx),
    ).rejects.toBeInstanceOf(MyError);

    expect(lines.length).toBe(2);
    const errorLine = lines[1] as Record<string, unknown>;
    expect(errorLine.outcome).toBe("error");
    expect(errorLine.errorClass).toBe("Error"); // MyError extends Error; name defaults to 'Error' unless overridden
    // Explicitly ensure the error message body NEVER appears anywhere in any log line.
    for (const line of lines) {
      for (const v of Object.values(line)) {
        if (typeof v === "string") expect(v).not.toContain("sensitive boom payload");
      }
    }
  });

  it("uses the class name for errorClass when the error class sets `name`", async () => {
    class TaggedError extends Error {
      override name = "TaggedError";
    }
    const ctx: ObservabilityContext = {
      tenantId: "t-1",
      provider: "openai",
      operation: "llm.complete",
    };

    await expect(
      withObservability(async () => {
        throw new TaggedError("nope");
      }, ctx),
    ).rejects.toBeInstanceOf(TaggedError);

    const errorLine = lines[1] as Record<string, unknown>;
    expect(errorLine.errorClass).toBe("TaggedError");
  });

  it("generates a UUID correlation ID when none is passed", async () => {
    const ctx: ObservabilityContext = {
      tenantId: "t-1",
      provider: "exa",
      operation: "signal.fetch",
    };
    await withObservability(async () => 1, ctx);
    const id = lines[0]?.correlationId as string;
    // UUIDv4 shape — crypto.randomUUID() output.
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("produces different correlation IDs on consecutive calls (not tenant-derived)", async () => {
    const ctx: ObservabilityContext = {
      tenantId: "same-tenant",
      provider: "exa",
      operation: "signal.fetch",
    };
    await withObservability(async () => 1, ctx);
    const id1 = lines[0]?.correlationId;
    lines.length = 0;
    await withObservability(async () => 1, ctx);
    const id2 = lines[0]?.correlationId;
    expect(id1).not.toBe(id2);
  });

  it("honors a passed-in correlation ID verbatim", async () => {
    const ctx: ObservabilityContext = {
      tenantId: "t-1",
      provider: "exa",
      operation: "signal.fetch",
      correlationId: "incoming-trace-abc",
    };
    await withObservability(async () => 1, ctx);
    expect(lines[0]?.correlationId).toBe("incoming-trace-abc");
    expect(lines[1]?.correlationId).toBe("incoming-trace-abc");
  });

  it("limits log line fields to the documented allow-list", async () => {
    const ctx: ObservabilityContext = {
      tenantId: "t-1",
      provider: "exa",
      operation: "signal.fetch",
    };
    await withObservability(async () => 1, ctx);
    await expect(
      withObservability(async () => {
        throw new Error("msg");
      }, ctx),
    ).rejects.toBeTruthy();

    for (const line of lines) {
      for (const k of Object.keys(line)) {
        expect(ALLOWED_FIELDS.has(k)).toBe(true);
      }
    }
  });
});

describe("metrics", () => {
  let recorded: Array<{
    name: string;
    value: number;
    tags?: Record<string, string>;
  }>;

  beforeEach(() => {
    recorded = [];
    __setMetricsSinkForTests((name, value, tags) => recorded.push({ name, value, tags }));
  });

  afterEach(() => {
    __setMetricsSinkForTests(null);
  });

  it("captures metric.record() calls via the test sink", () => {
    metrics.record("test.metric", 42, { tag: "x" });
    expect(recorded).toEqual([{ name: "test.metric", value: 42, tags: { tag: "x" } }]);
  });

  it("defaults to a no-op when sink is cleared", () => {
    __setMetricsSinkForTests(null);
    // Should not throw.
    expect(() => metrics.record("test", 1)).not.toThrow();
  });
});
