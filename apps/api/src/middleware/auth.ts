import type { MiddlewareHandler } from "hono";
import type { TenantVariables } from "./tenant";

/**
 * Auth middleware options.
 *
 * `bypassMode` is honored ONLY when `NODE_ENV !== 'production'`. This means
 * a misconfigured caller cannot pass `bypassMode: true` in prod and ship a
 * silent auth bypass. In production the only way to avoid auth would be a
 * deployment misconfiguration of NODE_ENV itself, which would surface
 * loudly through other paths.
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
    // Production NEVER honors bypass — even if a caller passes
    // `bypassMode: true`. Auto-bypass on NODE_ENV === 'test' is also
    // gated against production for the same reason.
    const isProduction = process.env.NODE_ENV === "production";
    const bypass = !isProduction && (opts.bypassMode === true || process.env.NODE_ENV === "test");

    // RFC 6750: the bearer scheme is case-insensitive. `bearer abc` and
    // `Bearer abc` are both valid Authorization headers.
    const authHeader = c.req.header("Authorization") ?? c.req.header("authorization");
    const bearerMatch =
      typeof authHeader === "string" ? authHeader.match(/^Bearer\s+(.+)$/i) : null;
    const token = bearerMatch?.[1]?.trim() ?? "";
    const hasBearer = token.length > 0;

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
