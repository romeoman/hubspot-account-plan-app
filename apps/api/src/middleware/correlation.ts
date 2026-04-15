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

/** Hono `Variables` extension set by this middleware. */
export type CorrelationVariables = {
  correlationId?: string;
};

/**
 * Hono middleware: reads or generates an `X-Request-Id`, stashes it on the
 * context, and echoes it on the response headers.
 */
export function correlationMiddleware(): MiddlewareHandler<{
  Variables: CorrelationVariables;
}> {
  return async (c, next) => {
    const incoming = c.req.header(HEADER);
    const id = incoming && incoming.length > 0 ? incoming : randomUUID();
    c.set("correlationId", id);
    await next();
    // Echo AFTER the downstream handler so failed responses (401, 500) still
    // carry the header. Hono preserves the response object across `next()`.
    c.res.headers.set(HEADER, id);
  };
}
