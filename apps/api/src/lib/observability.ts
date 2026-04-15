/**
 * Observability wrapper for external-service adapter calls (Slice 2 Step 7).
 *
 * Every live adapter wired in Step 8 (LLM) and Step 9 (signals) MUST route its
 * outbound call through {@link withObservability}. The wrapper:
 *   - Assigns (or propagates) a correlation ID so a single user-initiated
 *     request can be traced across the API, every external fan-out, and the
 *     response log line.
 *   - Emits structured JSON-line logs to stderr (the de-facto standard for
 *     log aggregators). One `enter` line, and one `success`/`error` line.
 *   - Re-throws errors unchanged — we never swallow, and never log the
 *     error's `.message` or `.stack` because either can leak secrets (prompts,
 *     API keys in URLs), restricted evidence, or raw PII from the provider.
 *   - Exposes a pluggable `metrics` sink so Slice 3 can wire Datadog /
 *     Prometheus / OpenTelemetry without touching adapter code.
 *
 * Correlation ID privacy: IDs are generated via `crypto.randomUUID()`
 * (UUIDv4) and are NEVER derived from `tenantId` or any other user-controlled
 * value. Deriving trace IDs from tenant data would leak cross-tenant linkage
 * into logs and — worst case — let an attacker who saw one trace ID predict
 * another tenant's future IDs. (Security audit advisory: see
 * `docs/security/SECURITY.md` §15.)
 *
 * Log field allow-list — the log line contains ONLY:
 *   correlationId, tenantId, provider, operation, latencyMs, outcome,
 *   errorClass, tokenUsage, phase
 * Tests act as the schema and will fail if a stray field appears.
 */

import { randomUUID } from "node:crypto";

/** Context passed into every wrapped call. */
export interface ObservabilityContext {
  /** Trusted tenant UUID (upstream middleware resolved). */
  tenantId: string;
  /** Provider identifier, e.g. `'exa'`, `'openai'`, `'anthropic'`. */
  provider: string;
  /** Logical operation name, e.g. `'llm.complete'`, `'signal.fetch'`. */
  operation: string;
  /** Incoming trace ID. When omitted, a fresh UUIDv4 is generated. */
  correlationId?: string;
}

/** Optional success-path annotations the caller can attach to the exit log. */
export interface SuccessAnnotations {
  /**
   * LLM token accounting when applicable. Numeric shape keeps it aggregator-
   * friendly; undefined when the call doesn't consume tokens.
   */
  tokenUsage?: { inputTokens?: number; outputTokens?: number };
}

type LogLine = Record<string, unknown>;
type LogSink = (line: LogLine) => void;
type MetricsSink = (name: string, value: number, tags?: Record<string, string>) => void;

/**
 * Default log sink — one JSON line per entry, stderr. `console.error` (not
 * `console.log`) is deliberate: stderr is the convention for structured logs
 * in container orchestrators.
 */
const DEFAULT_LOG_SINK: LogSink = (line) => {
  console.error(JSON.stringify(line));
};

/** Default metrics sink is a no-op. Slice 3 will wire a real one. */
const DEFAULT_METRICS_SINK: MetricsSink = () => {};

let logSink: LogSink = DEFAULT_LOG_SINK;
let metricsSink: MetricsSink = DEFAULT_METRICS_SINK;

/**
 * TEST-ONLY: replace the log sink so tests can inspect emitted lines. Pass
 * `null` to restore the default (stderr JSON-lines).
 * @internal
 */
export function __setLogSinkForTests(sink: LogSink | null): void {
  logSink = sink ?? DEFAULT_LOG_SINK;
}

/**
 * TEST-ONLY: replace the metrics sink. Pass `null` to restore the no-op.
 * @internal
 */
export function __setMetricsSinkForTests(sink: MetricsSink | null): void {
  metricsSink = sink ?? DEFAULT_METRICS_SINK;
}

/**
 * Emit a single log line via the active sink. Private — callers go through
 * {@link withObservability} which constructs the line from a fixed template.
 */
function emit(line: LogLine): void {
  logSink(line);
}

/**
 * Pluggable metrics interface. Adapters call `metrics.record(...)` for
 * provider-specific counters/gauges (e.g. `llm.tokens.input`, `signal.cache.hit`).
 * The default impl is a no-op so production code never crashes when metrics
 * aren't wired yet.
 */
export const metrics = {
  /**
   * Record a numeric metric.
   *
   * @param name - metric name, e.g. `'llm.latency_ms'`. Keep dotted/namespaced.
   * @param value - numeric sample (counter increment, gauge value, etc.).
   * @param tags - optional key/value tags. MUST NOT include secret values —
   *   tags routinely appear in log aggregators and vendor dashboards.
   */
  record(name: string, value: number, tags?: Record<string, string>): void {
    metricsSink(name, value, tags);
  },
};

/**
 * Wrap an async adapter call with correlation-ID propagation, structured
 * logging, and latency tracking.
 *
 * Usage:
 * ```ts
 * const result = await withObservability(
 *   () => exaClient.search({ query }),
 *   { tenantId, provider: "exa", operation: "signal.fetch", correlationId },
 * );
 * ```
 *
 * Errors are re-thrown unchanged. The error log line contains `errorClass`
 * (the `.name` of the thrown value) but NEVER the `.message`, `.stack`, or
 * any request/response body — those routinely carry secrets or restricted
 * evidence.
 */
export async function withObservability<T>(
  fn: () => Promise<T>,
  ctx: ObservabilityContext,
  annotate?: (result: T) => SuccessAnnotations | undefined,
): Promise<T> {
  const correlationId = ctx.correlationId ?? randomUUID();
  const enterTs = Date.now();

  emit({
    correlationId,
    tenantId: ctx.tenantId,
    provider: ctx.provider,
    operation: ctx.operation,
    phase: "enter",
  });

  try {
    const result = await fn();
    const latencyMs = Date.now() - enterTs;

    const annotations = annotate?.(result);
    const exitLine: LogLine = {
      correlationId,
      tenantId: ctx.tenantId,
      provider: ctx.provider,
      operation: ctx.operation,
      latencyMs,
      outcome: "success",
    };
    if (annotations?.tokenUsage !== undefined) {
      exitLine.tokenUsage = annotations.tokenUsage;
    }
    emit(exitLine);

    metricsSink("adapter.latency_ms", latencyMs, {
      provider: ctx.provider,
      operation: ctx.operation,
      outcome: "success",
    });
    return result;
  } catch (err) {
    const latencyMs = Date.now() - enterTs;
    const errorClass =
      err instanceof Error
        ? err.name
        : typeof err === "object" && err !== null
          ? "Object"
          : "Unknown";

    emit({
      correlationId,
      tenantId: ctx.tenantId,
      provider: ctx.provider,
      operation: ctx.operation,
      latencyMs,
      outcome: "error",
      errorClass,
    });

    metricsSink("adapter.latency_ms", latencyMs, {
      provider: ctx.provider,
      operation: ctx.operation,
      outcome: "error",
    });
    throw err;
  }
}
