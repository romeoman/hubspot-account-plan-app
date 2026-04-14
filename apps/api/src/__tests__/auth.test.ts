import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authMiddleware } from "../middleware/auth";
import type { TenantVariables } from "../middleware/tenant";

type Vars = TenantVariables & { portalId?: string };

function buildApp(opts?: Parameters<typeof authMiddleware>[0]) {
  const app = new Hono<{ Variables: Vars }>();
  app.use("*", authMiddleware(opts));
  app.get("/probe", (c) => c.json({ portalId: c.get("portalId") ?? null }));
  return app;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.API_TOKENS;
  delete process.env.AUTH_BYPASS;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("auth middleware", () => {
  it("returns 401 when Authorization header is missing (outside test bypass)", async () => {
    process.env.NODE_ENV = "production";
    process.env.API_TOKENS = "tok-a:portal-a";
    const app = buildApp();
    const res = await app.request("/probe");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("returns 401 when bearer token is not in the configured map", async () => {
    process.env.NODE_ENV = "production";
    process.env.API_TOKENS = "tok-a:portal-a";
    const app = buildApp();
    const res = await app.request("/probe", {
      headers: { Authorization: "Bearer nope" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 and sets portalId when bearer token maps to a portalId", async () => {
    process.env.NODE_ENV = "production";
    process.env.API_TOKENS = "tok-a:portal-a,tok-b:portal-b";
    const app = buildApp();
    const res = await app.request("/probe", {
      headers: { Authorization: "Bearer tok-b" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { portalId: string | null };
    expect(body.portalId).toBe("portal-b");
  });

  it("bypass mode: NODE_ENV=test accepts any bearer and uses x-test-portal-id header", async () => {
    process.env.NODE_ENV = "test";
    const app = buildApp();
    const res = await app.request("/probe", {
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": "portal-x",
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { portalId: string | null };
    expect(body.portalId).toBe("portal-x");
  });

  it("bypass mode: NODE_ENV=test falls back to default test-portal when header absent", async () => {
    process.env.NODE_ENV = "test";
    const app = buildApp();
    const res = await app.request("/probe", {
      headers: { Authorization: "Bearer anything" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { portalId: string | null };
    expect(body.portalId).toBe("test-portal");
  });

  it("explicit bypassMode flag overrides NODE_ENV", async () => {
    process.env.NODE_ENV = "production";
    const app = buildApp({ bypassMode: true });
    const res = await app.request("/probe", {
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": "portal-explicit",
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { portalId: string | null };
    expect(body.portalId).toBe("portal-explicit");
  });

  it("malformed Authorization header returns 401", async () => {
    process.env.NODE_ENV = "production";
    process.env.API_TOKENS = "tok-a:portal-a";
    const app = buildApp();
    const res = await app.request("/probe", {
      headers: { Authorization: "tok-a" }, // missing "Bearer "
    });
    expect(res.status).toBe(401);
  });
});
