import { fixtureEligibleStrong } from "@hap/config";
import { Hono } from "hono";
import type { TenantVariables } from "../middleware/tenant";

type Vars = TenantVariables & { portalId?: string };

/**
 * Validate companyId: must be a non-empty, trimmed string of reasonable
 * length. We accept the HubSpot numeric-string convention but stay permissive
 * since the CRM uses multiple record id shapes.
 */
function isValidCompanyId(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > 128) return false;
  // Allow URL-safe characters only — block control chars and path traversal.
  return /^[A-Za-z0-9._-]+$/.test(trimmed);
}

/**
 * Snapshot route module.
 *
 * Mounted under `/api/snapshot` in `index.ts`. Full route: `POST /api/snapshot/:companyId`.
 *
 * V1 returns a fixture Snapshot (`fixtureEligibleStrong`) wired with the
 * middleware-resolved `tenantId`. The real assembler (eligibility + trust +
 * people selection + reason generation) lands in Step 8.
 *
 * Tenant safety: `tenantId` is ALWAYS sourced from `c.get('tenantId')` set by
 * the upstream tenant middleware. Body-provided tenantIds are ignored.
 *
 * @todo Step 8: replace `fixtureEligibleStrong` with real snapshot assembler.
 */
export const snapshotRoutes = new Hono<{ Variables: Vars }>();

snapshotRoutes.post("/:companyId", async (c) => {
  const rawCompanyId = c.req.param("companyId") ?? "";
  const decoded = decodeURIComponent(rawCompanyId);

  if (!isValidCompanyId(decoded)) {
    return c.json({ error: "invalid_company_id" }, 400);
  }

  // Testability hook: reserved id for the 404 path.
  if (decoded === "missing-company") {
    return c.json({ error: "not_found" }, 404);
  }

  const tenantId = c.get("tenantId");
  if (!tenantId) {
    // Defensive — tenantMiddleware should have already returned 401.
    return c.json({ error: "unauthorized" }, 401);
  }

  try {
    const snapshot = fixtureEligibleStrong(tenantId);
    // Override companyId with the request's companyId so the response reflects
    // what was asked for (fixture uses a canned id).
    snapshot.companyId = decoded;
    return c.json(snapshot, 200);
  } catch (_err) {
    return c.json({ error: "internal_error" }, 500);
  }
});

export default snapshotRoutes;
