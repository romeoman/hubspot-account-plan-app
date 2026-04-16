import { type createDatabase, type Database, type Tenant, tenants } from "@hap/db";
import { eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";

/**
 * Hono Variables contract for tenant resolution.
 *
 * Upstream contract (Step 5 — auth.ts will set `portalId` BEFORE this
 * middleware runs): auth.ts is responsible for authenticating the inbound
 * HubSpot request and calling `c.set('portalId', <hubspot portal id>)`.
 *
 * This middleware reads `portalId`, resolves the matching `tenants` row, and
 * sets `tenantId` + `tenant` on the context for downstream handlers.
 */
export type TenantVariables = {
  portalId?: string;
  tenantId?: string;
  tenant?: Tenant;
  db?: Database & { release(): Promise<void> };
};

export interface TenantMiddlewareDeps {
  db: ReturnType<typeof createDatabase>;
}

/**
 * Tenant resolution middleware.
 *
 * - Reads `portalId` from context (set by auth middleware upstream).
 * - Looks up the tenant by `hubspot_portal_id`.
 * - On success: sets `tenantId` and `tenant` on the context, calls `next()`.
 * - On missing portalId or no matching tenant: returns
 *   `401 { error: 'unauthorized', detail: 'tenant not found' }`.
 *
 * This middleware is a cross-tenant safety boundary. Downstream handlers
 * MUST scope all queries by `c.get('tenantId')`.
 */
export function tenantMiddleware(
  deps: TenantMiddlewareDeps,
): MiddlewareHandler<{ Variables: TenantVariables }> {
  const { db } = deps;
  return async (c, next) => {
    const portalId = c.get("portalId");
    if (!portalId) {
      return c.json({ error: "unauthorized", detail: "tenant not found" }, 401);
    }

    const rows = await db
      .select()
      .from(tenants)
      .where(eq(tenants.hubspotPortalId, portalId))
      .limit(1);

    const tenant = rows[0];
    if (!tenant) {
      return c.json({ error: "unauthorized", detail: "tenant not found" }, 401);
    }

    c.set("tenantId", tenant.id);
    c.set("tenant", tenant);
    await next();
  };
}
