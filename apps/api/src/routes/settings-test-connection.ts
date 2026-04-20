/**
 * `POST /api/settings/test-connection` — explicit credential verification.
 *
 * Mounted under the settings router so it inherits the full auth + tenant
 * middleware chain configured in {@link ../index}. The route:
 *
 *   1. Validates the body against the {@link testConnectionBodySchema}
 *      discriminated union (XOR on apiKey/useSavedKey, HTTPS for custom).
 *   2. Enforces a per-tenant rate limit (default 5 tests / 60s) so a
 *      compromised tenant cannot spam upstream vendors.
 *   3. Dispatches to {@link testConnection} which never logs or echoes the
 *      plaintext key, SSRF-guards custom endpoints, and maps all vendor
 *      errors to a narrow `code` union.
 *
 * The route intentionally returns `200` for both success and vendor-failure
 * cases — the UI treats the response body as authoritative. Shape errors
 * (missing discriminator, XOR violation, etc.) remain 400 so the FE form
 * handler surfaces them as developer/integration errors rather than as an
 * "ordinary" connection-test failure.
 */

import { testConnectionBodySchema } from "@hap/validators";
import { Hono } from "hono";
import {
  createDefaultSavedKeyLoader,
  type TestConnectionDeps,
  testConnection,
} from "../lib/settings-connection-test.js";
import {
  getTestConnectionRateLimiter,
  type TestConnectionRateLimiter,
} from "../lib/test-connection-rate-limit.js";
import type { TenantVariables } from "../middleware/tenant.js";

export interface TestConnectionRouteDeps {
  /** Override connection-test service deps (fetch, logger, loadSavedKey). */
  serviceDeps?: TestConnectionDeps;
  /** Override the rate limiter — useful for test isolation. */
  rateLimiter?: TestConnectionRateLimiter;
}

/**
 * Build a Hono sub-app for the test-connection route. Callers mount it under
 * the parent settings app so the same auth + tenant middleware chain runs.
 */
export function createTestConnectionRoute(
  deps: TestConnectionRouteDeps = {},
): Hono<{ Variables: TenantVariables }> {
  const router = new Hono<{ Variables: TenantVariables }>();

  router.post("/", async (c) => {
    const tenantId = c.get("tenantId");
    const db = c.get("db");
    if (!tenantId) {
      return c.json({ error: "tenant_context_missing" }, 401);
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    const parsed = testConnectionBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    }

    const limiter = deps.rateLimiter ?? getTestConnectionRateLimiter();
    if (!limiter.allow(tenantId)) {
      return c.json(
        {
          ok: false as const,
          code: "rate_limit" as const,
          message: "Too many test requests",
        },
        429,
      );
    }

    // If no loader was injected, default to the in-process DB-backed loader
    // keyed on the per-request tenant transaction handle. When `db` is absent
    // (defensive — the tenant middleware chain normally provides one) the
    // saved-key path degrades gracefully to "No stored key".
    const serviceDeps: TestConnectionDeps = {
      ...(deps.serviceDeps ?? {}),
    };
    if (!serviceDeps.loadSavedKey && db) {
      serviceDeps.loadSavedKey = createDefaultSavedKeyLoader(db);
    }

    const result = await testConnection(tenantId, parsed.data, serviceDeps);
    return c.json(result, 200);
  });

  return router;
}
