import type { Evidence } from "@hap/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __setLogSinkForTests, __setMetricsSinkForTests } from "../../../lib/observability";
import { RateLimiter } from "../../../lib/rate-limiter";
import type { ProviderAdapter } from "../../provider-adapter";
import { SignalRateLimitedError, wrapSignalWithGuards } from "../factory";

function makeAdapter(impl: ProviderAdapter["fetchSignals"]): ProviderAdapter {
  return { name: "exa", fetchSignals: impl };
}

describe("wrapSignalWithGuards", () => {
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

  it("emits enter + success log lines with correlationId, tenantId, provider, operation=signal.fetch", async () => {
    const inner = makeAdapter(async (): Promise<Evidence[]> => []);
    const limiter = new RateLimiter();
    const wrapped = wrapSignalWithGuards(inner, {
      tenantId: "tenant-A",
      correlationId: "corr-123",
      rateLimiter: limiter,
    });

    const res = await wrapped.fetchSignals("tenant-A", {
      companyId: "co-acme",
      companyName: "Acme",
    });
    expect(res).toEqual([]);
    expect(wrapped.name).toBe("exa");

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
        provider: "exa",
        operation: "signal.fetch",
      },
      {
        phase: undefined,
        outcome: "success",
        correlationId: "corr-123",
        tenantId: "tenant-A",
        provider: "exa",
        operation: "signal.fetch",
      },
    ]);
  });

  it("forwards structured company context to the inner adapter", async () => {
    const calls: Array<{ tenantId: string; company: unknown }> = [];
    const inner = makeAdapter(async (tenantId, company): Promise<Evidence[]> => {
      calls.push({ tenantId, company });
      return [];
    });
    const wrapped = wrapSignalWithGuards(inner, {
      tenantId: "tenant-A",
      correlationId: "corr-structured",
      rateLimiter: new RateLimiter(),
    });

    await wrapped.fetchSignals("tenant-A", {
      companyId: "co-123",
      companyName: "Acme Corp",
      domain: "acme.example.com",
    });

    expect(calls).toEqual([
      {
        tenantId: "tenant-A",
        company: {
          companyId: "co-123",
          companyName: "Acme Corp",
          domain: "acme.example.com",
        },
      },
    ]);
  });

  it("throws SignalRateLimitedError when limiter denies, and does NOT call inner adapter", async () => {
    let innerCalls = 0;
    const inner = makeAdapter(async (): Promise<Evidence[]> => {
      innerCalls += 1;
      return [];
    });
    // Tiny bucket: capacity=1 refill=1 rps. Second call in the same ms is denied.
    const limiter = new RateLimiter({ now: () => 0 });
    const wrapped = wrapSignalWithGuards(inner, {
      tenantId: "T",
      correlationId: "c",
      rateLimiter: limiter,
      rateLimitConfig: { capacity: 1, refillRatePerSec: 1 },
    });

    await wrapped.fetchSignals("T", { companyId: "co-acme", companyName: "Acme" });
    await expect(
      wrapped.fetchSignals("T", { companyId: "co-acme", companyName: "Acme" }),
    ).rejects.toBeInstanceOf(SignalRateLimitedError);
    expect(innerCalls).toBe(1);
  });

  it("emits an error log line with errorClass on failure, no raw message", async () => {
    class FlakyError extends Error {
      constructor() {
        super("secret-should-not-appear-in-logs");
        this.name = "FlakyError";
      }
    }
    const inner = makeAdapter(async (): Promise<Evidence[]> => {
      throw new FlakyError();
    });
    const limiter = new RateLimiter();
    const wrapped = wrapSignalWithGuards(inner, {
      tenantId: "T",
      correlationId: "c-err",
      rateLimiter: limiter,
    });

    await expect(
      wrapped.fetchSignals("T", { companyId: "co-acme", companyName: "Acme" }),
    ).rejects.toBeInstanceOf(FlakyError);

    const errLine = logs.find((l) => l.outcome === "error");
    expect(errLine).toBeDefined();
    expect(errLine?.errorClass).toBe("FlakyError");
    // Raw message must never appear in the structured log.
    for (const line of logs) {
      expect(JSON.stringify(line)).not.toContain("secret-should-not-appear-in-logs");
    }
  });
});
