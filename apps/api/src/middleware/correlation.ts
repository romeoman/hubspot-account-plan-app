/**
 * Correlation-ID middleware (Slice 2 Step 7).
 *
 * Assigns (or propagates) an `X-Request-Id` header on every inbound request.
 * Mounted as the FIRST middleware in {@link ../index.ts} — before CORS, before
 * auth — so that even unauthenticated 401 responses carry a trace ID. This
 * lets Phase 5 manual QA grep logs by the header value a caller saw.
 *
 * The ID flows through the Hono context (`c.get('correlationId')`) into
 * downstream services; Step 8/9 adapter factories read it there and pass it
 * into {@link ../lib/observability.withObservability} so one user-initiated
 * request produces a single trace across the fan-out.
 *
 * Correlation IDs are generated with `crypto.randomUUID()` — NEVER derived
 * from `tenantId` or any user-controlled value. Deriving would leak cross-
 * tenant linkage into shared log aggregators. See
 * {@link ../lib/observability.ts} for the full redaction contract.
 */

import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";

const HEADER = "X-Request-Id";

/**
 * Safe characters + length cap for an inbound correlation ID. Letters,
 * digits, dash, underscore, max 128 chars. Permissive enough for UUIDv4
 * (36 chars) and common trace-ID formats (AWS X-Ray, GCP); strict enough
 * to block whitespace / control chars / structured-log injection attempts
 * (spaces, newlines, JSON/SQL delimiters) AND oversized strings designed
 * to poison log aggregators.
 */
const INBOUND_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Hono `Variables` extension set by this middleware. */
export type CorrelationVariables = {
  correlationId?: string;
};

/**
 * Hono middleware: reads or generates an `X-Request-Id`, stashes it on the
 * context, and echoes it on the response headers.
 *
 * Inbound-header hardening (CodeRabbit M10):
 *  - Trim whitespace
 *  - Enforce length + charset (`INBOUND_ID_PATTERN`)
 *  - Fall back to `randomUUID()` on any violation
 *
 * Response-header hardening (CodeRabbit M11, cubic P2):
 *  - Set the echo header in a `finally` block so thrown errors still carry
 *    the trace ID. Without this, any exception inside `next()` would skip
 *    the echo and make failure logs untraceable from the client side.
 */
export function correlationMiddleware(): MiddlewareHandler<{
  Variables: CorrelationVariables;
}> {
  return async (c, next) => {
    const incoming = c.req.header(HEADER)?.trim();
    const id = incoming && INBOUND_ID_PATTERN.test(incoming) ? incoming : randomUUID();
    c.set("correlationId", id);
    try {
      await next();
    } finally {
      // Echo regardless of success/failure. Hono's `c.header()` handles the
      // post-finalized case internally (it sets the header on the already-
      // constructed response), so this works in the finally branch even when
      // the downstream handler throws. Prefer this over `c.res.headers.set`
      // because the latter trips a TS2339 in Vercel's Node build env under
      // Hono v4 + @types/node v22 (the lib typing of `Response.headers`
      // resolves without `.set` in that build chain).
      c.header(HEADER, id);
    }
  };
}
