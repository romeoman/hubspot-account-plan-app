import type { MiddlewareHandler } from "hono";
import type { TenantVariables } from "./tenant";

/**
 * Auth middleware options.
 *
 * `bypassMode` lets callers explicitly enable test-mode bypass regardless of
 * `NODE_ENV`. Bypass is otherwise auto-on when `NODE_ENV === 'test'`.
 */
export interface AuthMiddlewareOptions {
  bypassMode?: boolean;
}

/**
 * V1 bearer-token auth middleware.
 *
 * Token-to-portal mapping is sourced from the `API_TOKENS` env var with the
 * format `token1:portalA,token2:portalB`. Kept config-driven so customers
 * never share credentials and no portalId is hardcoded.
 *
 * Bypass mode (`NODE_ENV === 'test'` OR `opts.bypassMode === true`) accepts
 * any bearer token and reads the portalId from the `x-test-portal-id`
 * header, defaulting to `test-portal`. This is opt-in by environment or
 * explicit flag so it can never trigger in production.
 *
 * On success: `c.set('portalId', <portalId>)` then `await next()`.
 * On failure: returns `401 { error: 'unauthorized' }`.
 *
 * @todo Slice 2: replace bearer-token lookup with real HubSpot private app
 *   token validation (signature check, portal claim verification).
 */
export function authMiddleware(
  opts: AuthMiddlewareOptions = {},
): MiddlewareHandler<{ Variables: TenantVariables & { portalId?: string } }> {
  return async (c, next) => {
    const bypass = opts.bypassMode === true || process.env.NODE_ENV === "test";

    const authHeader = c.req.header("Authorization") ?? c.req.header("authorization");
    const hasBearer = typeof authHeader === "string" && authHeader.startsWith("Bearer ");
    const token = hasBearer ? authHeader.slice("Bearer ".length).trim() : "";

    if (bypass) {
      // Must still see *some* bearer so we don't mask a bug where the client
      // forgets Authorization entirely.
      if (!hasBearer || token.length === 0) {
        return c.json({ error: "unauthorized" }, 401);
      }
      const testPortal = c.req.header("x-test-portal-id") ?? "test-portal";
      c.set("portalId", testPortal);
      await next();
      return;
    }

    if (!hasBearer || token.length === 0) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const portalId = lookupPortalId(token);
    if (!portalId) {
      return c.json({ error: "unauthorized" }, 401);
    }

    c.set("portalId", portalId);
    await next();
  };
}

/**
 * Parse `API_TOKENS=token1:portalA,token2:portalB` into a lookup map.
 * Evaluated per-request so tests can mutate `process.env` between cases.
 */
function lookupPortalId(token: string): string | undefined {
  const raw = process.env.API_TOKENS ?? "";
  if (!raw) return undefined;
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;
    const t = trimmed.slice(0, idx).trim();
    const p = trimmed.slice(idx + 1).trim();
    if (t === token && p.length > 0) return p;
  }
  return undefined;
}
