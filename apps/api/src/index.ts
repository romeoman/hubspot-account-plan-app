import { resolveHubSpotOAuthRedirectUri } from "@hap/config";
import { createDatabase } from "@hap/db";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { withTenantTxHandle } from "./lib/tenant-tx";
import { authMiddleware } from "./middleware/auth";
import { type CorrelationVariables, correlationMiddleware } from "./middleware/correlation";
import { nonceMiddleware } from "./middleware/nonce";
import { type TenantVariables, tenantMiddleware } from "./middleware/tenant";
import { createLifecycleBootstrapRoute } from "./routes/admin/lifecycle-bootstrap";
import { lifecycleWebhookRoutes } from "./routes/lifecycle";
import { createOAuthRoutes } from "./routes/oauth";
import { settingsRoutes } from "./routes/settings";
import { snapshotRoutes } from "./routes/snapshot";

type AppVars = TenantVariables & CorrelationVariables & { portalId?: string; rawBody?: string };

/**
 * Resolve the allowed CORS origin for a given request origin.
 *
 * Allow:
 *   - https://app.hubspot.com
 *   - https://*.hubspot.com
 *   - https://*.hubspotpreview-na1.com (and other regional preview hosts)
 *   - `*` in dev/test only (NODE_ENV !== 'production')
 */
function resolveCorsOrigin(origin: string): string | null {
  if (!origin) {
    return process.env.NODE_ENV === "production" ? null : "*";
  }
  try {
    const url = new URL(origin);
    const host = url.hostname;
    if (host === "app.hubspot.com") return origin;
    if (host.endsWith(".hubspot.com")) return origin;
    if (host.endsWith(".hubspotpreview-na1.com")) return origin;
    if (/\.hubspotpreview-[a-z0-9-]+\.com$/.test(host)) return origin;
  } catch {
    // Fall through to dev/test permissive branch below
  }
  if (process.env.NODE_ENV !== "production") return origin || "*";
  return null;
}

const app = new Hono<{ Variables: AppVars }>();

// Correlation middleware MUST be first — every request (including auth
// failures and CORS preflights) needs an X-Request-Id for Phase 5 QA tracing.
app.use("*", correlationMiddleware());

app.use(
  "*",
  cors({
    origin: (origin) => resolveCorsOrigin(origin ?? ""),
    allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "x-test-portal-id"],
    credentials: false,
    maxAge: 600,
  }),
);

// Public health endpoint — no auth, no tenant.
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * Memoized db handle, keyed by DATABASE_URL so test cases that mutate the
 * env between requests still get a fresh client. In production the URL is
 * stable and we keep one wrapper per process — postgres.js handles the
 * actual connection pool internally. Without this we'd build a brand new
 * client on every request, churning sockets in the hot path.
 */
let cachedDb: { url: string; db: ReturnType<typeof createDatabase> } | null = null;
function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // No production fallback. The app-level middleware runs before the
    // snapshot route's own DB check, so without this guard a misconfigured
    // deployment could silently authenticate tenants against localhost's
    // dev database. Fail loud at the first request instead.
    throw new Error(
      "DATABASE_URL is not set. The API refuses to fall back to a default dev URL in any environment.",
    );
  }
  if (cachedDb && cachedDb.url === url) return cachedDb.db;
  const db = createDatabase(url);
  cachedDb = { url, db };
  return db;
}

// Memoize the tenant middleware too so we build it once per process,
// not on every request. The middleware itself is stateless given a db handle.
let cachedTenantMw: ReturnType<typeof tenantMiddleware> | null = null;
let cachedTenantMwForDb: ReturnType<typeof createDatabase> | null = null;
function getTenantMw() {
  const db = getDb();
  if (cachedTenantMw && cachedTenantMwForDb === db) return cachedTenantMw;
  cachedTenantMw = tenantMiddleware({ db });
  cachedTenantMwForDb = db;
  return cachedTenantMw;
}

// OAuth install + callback routes — mounted BEFORE auth middleware because
// these endpoints are unauthenticated by design (no tenant exists yet at
// install time; the callback creates the tenant).
app.route(
  "/oauth",
  createOAuthRoutes({
    config: {
      clientId: process.env.HUBSPOT_CLIENT_ID ?? "",
      clientSecret: process.env.HUBSPOT_CLIENT_SECRET ?? "",
      redirectUri: resolveHubSpotOAuthRedirectUri(),
      scopes: ["crm.objects.companies.read", "crm.objects.contacts.read"],
      stateTtlSeconds: 600,
    },
    db: getDb(),
  }),
);

// HubSpot app-lifecycle webhook receiver — mounted OUTSIDE `/api/*` because
// deliveries come from HubSpot, not from an authenticated user session, and
// so they skip auth/tenant/nonce middleware. Authenticity is proven by the
// route's internal v3 signature check (see routes/lifecycle.ts).
app.route("/webhooks/hubspot/lifecycle", lifecycleWebhookRoutes({ db: getDb() }));

// Operator-only lifecycle subscription bootstrap — mounted OUTSIDE `/api/*`
// and the tenant middleware because it is gated on a static internal token
// rather than a HubSpot-signed request. Mirrors the webhook mount posture.
app.route("/admin/lifecycle", createLifecycleBootstrapRoute());

// Composed middleware chain for /api/* routes: auth -> tenant -> route.
app.use("/api/*", authMiddleware());
app.use("/api/*", async (c, next) => {
  const mw = getTenantMw();
  return mw(c, next);
});
app.use("/api/*", async (c, next) => {
  const tenantId = c.get("tenantId");
  if (!tenantId) {
    return next();
  }

  const handle = await withTenantTxHandle(getDb(), tenantId);
  c.set("db", handle);
  try {
    await next();
    await handle.release();
  } catch (error) {
    await handle.abort(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    c.set("db", undefined);
  }
});
app.use("/api/*", nonceMiddleware());

app.route("/api/settings", settingsRoutes);
app.route("/api/snapshot", snapshotRoutes);

// Only start the real HTTP server outside test runners. Some tests
// temporarily simulate production mode while importing this module, so the
// guard must not rely on NODE_ENV alone.
if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
  const port = Number(process.env.PORT) || 3001;
  console.log(`API server starting on port ${port}`);
  serve({ fetch: app.fetch, port });
}

export default app;
