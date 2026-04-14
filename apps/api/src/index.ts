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
 * Lazily build the db handle so DATABASE_URL changes between test cases are
 * respected and so simple imports (e.g. health-only tests) don't pay for a
 * connection at module load.
 */
function getDb() {
  const url = process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";
  return createDatabase(url);
}

// Composed middleware chain for /api/* routes: auth -> tenant -> route.
app.use("/api/*", authMiddleware());
app.use("/api/*", async (c, next) => {
  const mw = tenantMiddleware({ db: getDb() });
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
