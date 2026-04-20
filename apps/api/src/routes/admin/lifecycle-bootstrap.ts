/**
 * Slice 11 Task 4 — guarded admin bootstrap route.
 *
 * POST /admin/lifecycle/bootstrap
 *   Mounted OUTSIDE /api/* and the tenant middleware because it is an
 *   operator-only endpoint whose auth is a shared static token, not a HubSpot
 *   signed request. This mirrors the `/webhooks/hubspot/lifecycle` mount
 *   posture.
 *
 * Auth:
 *   - Header `X-Internal-Bootstrap-Token` compared against
 *     `INTERNAL_BOOTSTRAP_TOKEN` using length-safe `timingSafeEqual`.
 *   - Missing env  -> 503 `bootstrap_not_configured` (never 500).
 *   - Missing header -> 401 `missing_internal_token`.
 *   - Wrong header -> 403 `invalid_internal_token` (same code for wrong
 *     length or wrong content — no length oracle).
 *
 * Success:
 *   - 200 JSON = `EnsureLifecycleSubscriptionsReport` verbatim.
 *
 * Failure:
 *   - `SubscriptionBootstrapError` -> 502 with `{ error, stage, status,
 *     eventTypeId }` only. Never leaks bearer, raw body, or internal token.
 *   - Any other Error -> 500 `internal_error` with no message propagation.
 */

import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import {
  ensureLifecycleSubscriptions as defaultEnsure,
  type EnsureLifecycleSubscriptionsOptions,
  type EnsureLifecycleSubscriptionsReport,
  SubscriptionBootstrapError,
} from "../../lib/hubspot-subscription-bootstrap.js";

const INTERNAL_TOKEN_HEADER = "x-internal-bootstrap-token";

export type LifecycleBootstrapDeps = {
  ensure?: (
    opts: EnsureLifecycleSubscriptionsOptions,
  ) => Promise<EnsureLifecycleSubscriptionsReport>;
  env?: Record<string, string | undefined>;
};

/**
 * Length-safe constant-time string compare. Mirrors the pattern in
 * `apps/api/src/middleware/hubspot-signature.ts`: `timingSafeEqual` throws on
 * unequal `Buffer.byteLength`, so we gate on a length check and still burn a
 * compare against a padded buffer to keep timing roughly flat.
 */
function safeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.byteLength !== bBuf.byteLength) {
    const padded = Buffer.alloc(aBuf.byteLength);
    timingSafeEqual(aBuf, padded);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export function createLifecycleBootstrapRoute(deps: LifecycleBootstrapDeps = {}) {
  const ensure = deps.ensure ?? defaultEnsure;
  const env = deps.env ?? process.env;

  const app = new Hono();

  app.post("/bootstrap", async (c) => {
    const expectedToken = env.INTERNAL_BOOTSTRAP_TOKEN;
    const targetUrl = env.LIFECYCLE_TARGET_URL;

    if (!expectedToken || expectedToken.length === 0 || !targetUrl || targetUrl.length === 0) {
      return c.json({ error: "bootstrap_not_configured" }, 503);
    }

    const provided = c.req.header(INTERNAL_TOKEN_HEADER);
    if (!provided || provided.length === 0) {
      return c.json({ error: "missing_internal_token" }, 401);
    }
    if (!safeEquals(provided, expectedToken)) {
      return c.json({ error: "invalid_internal_token" }, 403);
    }

    try {
      const report = await ensure({ targetUrl });
      return c.json(report, 200);
    } catch (err) {
      if (err instanceof SubscriptionBootstrapError) {
        return c.json(
          {
            error: "upstream_failure",
            stage: err.stage,
            status: err.status,
            eventTypeId: err.eventTypeId,
          },
          502,
        );
      }
      return c.json({ error: "internal_error" }, 500);
    }
  });

  return app;
}
