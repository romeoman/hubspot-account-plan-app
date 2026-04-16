/**
 * Slice 3 Task 3b — OAuth install + callback routes.
 *
 * Mounted in `apps/api/src/index.ts` at `/oauth/*`, BEFORE `authMiddleware`
 * + `tenantMiddleware`. Both routes are deliberately unauthenticated:
 *   - `/oauth/install` runs pre-install (no tenant yet).
 *   - `/oauth/callback` creates or updates the tenant — the `tenantMiddleware`
 *     would have no tenant to resolve at this point.
 *
 * Callback flow (enforced order, see Solution Approach in the Slice 3 plan):
 *   1. Validate query error/state (tampering + expiry).
 *   2. Exchange code → access/refresh tokens.
 *   3. Fetch token identity → hub_id (portal id) + granted scopes.
 *   4. Upsert `tenants` ON CONFLICT(hubspot_portal_id).
 *   5. Encrypt tokens with the per-tenant KEK (`encryptProviderKey`).
 *   6. Upsert `tenant_hubspot_oauth` ON CONFLICT(tenant_id).
 *   7. Redirect to the HubSpot-supplied `returnUrl` (if any) or a success
 *      page.
 *
 * Error-UX:
 *   - Tampered/expired state → 400 friendly HTML.
 *   - HubSpot `error=access_denied` → 400 friendly HTML.
 *   - Token-exchange or identity 4xx → 502 (upstream failure, not user
 *     error). We surface the status code only — tokens or server errors
 *     are never echoed to the user.
 */

import { tenantHubspotOauth, tenants } from "@hap/db";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { encryptProviderKey } from "../lib/encryption";
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  fetchTokenIdentity,
  OAuthHttpError,
  OAuthStateError,
  OAuthStateExpiredError,
  refreshAccessToken,
  signState,
  verifyState,
} from "../lib/oauth";

export type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  /** TTL for the signed state value. Default 600 (10 min). */
  stateTtlSeconds: number;
};

export type OAuthDeps = {
  config: OAuthConfig;
  /** Drizzle handle. Never the global one at test time. */
  db: unknown;
  /** Injectable fetch for cassette-based tests. Defaults to global fetch. */
  fetch?: typeof fetch;
};

// Minimal drizzle contract for this route — avoids pulling the concrete
// drizzle-orm/postgres-js type into module tests. Route-internal only.
type OAuthDb = {
  insert: (table: unknown) => {
    values: (row: Record<string, unknown>) => {
      onConflictDoUpdate: (args: { target: unknown; set: Record<string, unknown> }) => {
        returning: () => Promise<{ id: string }[]>;
      };
      returning: () => Promise<{ id: string }[]>;
    };
  };
};

/**
 * Validate returnUrl to prevent open-redirect (CodeRabbit C1).
 * Only allow HubSpot-origin URLs — the returnUrl is supplied by HubSpot's
 * install flow and should always point back to a HubSpot domain.
 */
function isAllowedReturnUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host === "app.hubspot.com" ||
      host.endsWith(".hubspot.com") ||
      host.endsWith(".hubspotpreview-na1.com") ||
      /\.hubspotpreview-[a-z0-9-]+\.com$/.test(host)
    );
  } catch {
    return false;
  }
}

function htmlError(title: string, detail: string): string {
  // Intentionally minimal, no CSS. Dev-only visual; prod has a nicer page.
  const safeTitle = title.replace(/[<>&]/g, "");
  const safeDetail = detail.replace(/[<>&]/g, "");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title></head><body><h1>${safeTitle}</h1><p>${safeDetail}</p></body></html>`;
}

export function createOAuthRoutes(deps: OAuthDeps) {
  const { config } = deps;
  const db = deps.db as OAuthDb;
  const fetchImpl = deps.fetch ?? fetch;

  const app = new Hono();

  // -------------------------------------------------------------------------
  // GET /install — redirects to HubSpot's authorize URL with fresh state
  // -------------------------------------------------------------------------
  app.get("/install", (c) => {
    const state = signState({
      secret: config.clientSecret,
      ttlSeconds: config.stateTtlSeconds,
    });
    const url = buildAuthorizeUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      scopes: config.scopes,
      state,
    });
    return c.redirect(url, 302);
  });

  // -------------------------------------------------------------------------
  // GET /callback — full ordered upsert flow documented above
  // -------------------------------------------------------------------------
  app.get("/callback", async (c) => {
    const error = c.req.query("error");
    if (error) {
      const description = c.req.query("error_description") ?? "(no description)";
      return c.html(htmlError("Install declined", `${error}: ${description}`), 400);
    }

    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) {
      return c.html(htmlError("Install failed", "missing required query parameters"), 400);
    }

    // Step 1 — state verification (tampering + expiry only; see
    // SECURITY.md §16.2 for the stateless-state tradeoff).
    try {
      verifyState({ secret: config.clientSecret, state, now: Date.now() });
    } catch (err) {
      if (err instanceof OAuthStateExpiredError) {
        return c.html(
          htmlError(
            "Install link expired",
            "This install link has expired. Click the Install button in HubSpot again.",
          ),
          400,
        );
      }
      if (err instanceof OAuthStateError) {
        return c.html(
          htmlError(
            "Install failed",
            "state validation failed — request did not originate from this app",
          ),
          400,
        );
      }
      throw err;
    }

    // Step 2 — exchange code for tokens.
    let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
    try {
      tokens = await exchangeCodeForTokens({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        code,
        redirectUri: config.redirectUri,
        fetch: fetchImpl,
      });
    } catch (err) {
      if (err instanceof OAuthHttpError) {
        return c.html(
          htmlError("HubSpot token exchange failed", `upstream returned ${err.status}`),
          502,
        );
      }
      throw err;
    }

    // Step 3 — identity (hub_id + scopes).
    let identity: Awaited<ReturnType<typeof fetchTokenIdentity>>;
    try {
      identity = await fetchTokenIdentity({
        accessToken: tokens.accessToken,
        fetch: fetchImpl,
      });
    } catch (err) {
      if (err instanceof OAuthHttpError) {
        return c.html(
          htmlError("HubSpot identity lookup failed", `upstream returned ${err.status}`),
          502,
        );
      }
      throw err;
    }

    const portalIdAsText = String(identity.hubId);

    // Step 4 — upsert tenant keyed on hubspot_portal_id (source of truth
    // for portal identity; see plan Solution Approach).
    const tenantInsert = await db
      .insert(tenants)
      .values({
        hubspotPortalId: portalIdAsText,
        name: identity.hubDomain || portalIdAsText,
      })
      .onConflictDoUpdate({
        target: tenants.hubspotPortalId,
        set: { updatedAt: sql`now()` },
      })
      .returning();

    const tenantRow = tenantInsert[0];
    if (!tenantRow) {
      return c.html(htmlError("Install failed", "tenant upsert did not return a row"), 500);
    }
    const tenantId = tenantRow.id;

    // Step 5 — encrypt tokens with the per-tenant KEK.
    const accessTokenEncrypted = encryptProviderKey(tenantId, tokens.accessToken);
    const refreshTokenEncrypted = encryptProviderKey(tenantId, tokens.refreshToken);
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

    // Step 6 — upsert tenant_hubspot_oauth keyed on tenant_id.
    await db
      .insert(tenantHubspotOauth)
      .values({
        tenantId,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        expiresAt,
        scopes: identity.scopes,
      })
      .onConflictDoUpdate({
        target: tenantHubspotOauth.tenantId,
        set: {
          accessTokenEncrypted,
          refreshTokenEncrypted,
          expiresAt,
          scopes: identity.scopes,
          updatedAt: sql`now()`,
        },
      })
      .returning();

    // Step 7 — redirect. HubSpot passes `returnUrl` on some install flows.
    // SECURITY (CodeRabbit C1): validate returnUrl to prevent open-redirect.
    // Only allow HubSpot-origin URLs or relative paths.
    const returnUrl = c.req.query("returnUrl");
    if (returnUrl && isAllowedReturnUrl(returnUrl)) {
      return c.redirect(returnUrl, 302);
    }
    return c.html(
      htmlError(
        "Install successful",
        `Signal-First Account Workspace is now installed on portal ${identity.hubDomain}. You can close this tab.`,
      ),
      200,
    );
  });

  return app;
}

// Stub export so `refreshAccessToken` is reachable via the module (used by
// the Task 4 hubspot-client refactor). Keeping the import live so it does
// not get tree-shaken or flagged as unused.
export { refreshAccessToken };
