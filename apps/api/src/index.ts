import { createDatabase } from "@hap/db";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware } from "./middleware/auth";
import { type TenantVariables, tenantMiddleware } from "./middleware/tenant";
import { snapshotRoutes } from "./routes/snapshot";

type AppVars = TenantVariables & { portalId?: string };

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

app.use(
  "*",
  cors({
    origin: (origin) => resolveCorsOrigin(origin ?? ""),
    allowMethods: ["GET", "POST", "OPTIONS"],
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

// Composed middleware chain for /api/* routes: auth -> tenant -> route.
app.use("/api/*", authMiddleware());
app.use("/api/*", async (c, next) => {
  const mw = getTenantMw();
  return mw(c, next);
});

app.route("/api/snapshot", snapshotRoutes);

// Only start server when run directly (not when imported by tests).
if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT) || 3001;
  console.log(`API server starting on port ${port}`);
  serve({ fetch: app.fetch, port });
}

export default app;
