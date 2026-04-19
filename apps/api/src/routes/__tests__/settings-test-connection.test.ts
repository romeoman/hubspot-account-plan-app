import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedKeyLoader, TestConnectionDeps } from "../../lib/settings-connection-test";
import { TestConnectionRateLimiter } from "../../lib/test-connection-rate-limit";
import type { TenantVariables } from "../../middleware/tenant";
import {
  createTestConnectionRoute,
  type TestConnectionRouteDeps,
} from "../settings-test-connection";

/**
 * Build a standalone Hono app with:
 *   - a fake tenant middleware that sets `tenantId` from the
 *     `x-test-tenant-id` header (or returns 401 when absent — matching the
 *     auth posture of the real middleware chain).
 *   - the test-connection route mounted under `/test-connection`.
 *
 * This avoids pulling the real `authMiddleware` / `tenantMiddleware` / DB
 * transaction handle into a unit test. Cross-tenant isolation + auth-missing
 * behavior are exercised through the fake middleware, which mirrors the
 * contract the real chain sets up (see `apps/api/src/middleware/tenant.ts`).
 */
function buildApp(
  routeDeps: TestConnectionRouteDeps = {},
  opts: { requireTenant?: boolean } = { requireTenant: true },
) {
  const app = new Hono<{ Variables: TenantVariables }>();
  app.use("*", async (c, next) => {
    const header = c.req.header("x-test-tenant-id");
    if (opts.requireTenant !== false) {
      if (!header) return c.json({ error: "unauthorized" }, 401);
    }
    if (header) c.set("tenantId", header);
    await next();
  });
  app.route("/test-connection", createTestConnectionRoute(routeDeps));
  return app;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /test-connection — body validation", () => {
  it("returns 400 when body is missing `target`", async () => {
    const app = buildApp({});
    const res = await app.request("/test-connection", {
      method: "POST",
      headers: {
        "x-test-tenant-id": "t-a",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ apiKey: "whatever" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_body");
  });

  it("returns 400 when apiKey AND useSavedKey are both present (XOR)", async () => {
    const app = buildApp({});
    const res = await app.request("/test-connection", {
      method: "POST",
      headers: {
        "x-test-tenant-id": "t-a",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target: "llm",
        provider: "openai",
        model: "gpt-5.4",
        apiKey: "sk-draft",
        useSavedKey: true,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when apiKey AND useSavedKey are both absent (XOR)", async () => {
    const app = buildApp({});
    const res = await app.request("/test-connection", {
      method: "POST",
      headers: {
        "x-test-tenant-id": "t-a",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target: "llm",
        provider: "openai",
        model: "gpt-5.4",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when provider === 'custom' and endpointUrl is missing", async () => {
    const app = buildApp({});
    const res = await app.request("/test-connection", {
      method: "POST",
      headers: {
        "x-test-tenant-id": "t-a",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target: "llm",
        provider: "custom",
        model: "oss",
        apiKey: "k",
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /test-connection — auth posture", () => {
  it("returns 401 when the request has no resolved tenant", async () => {
    const app = buildApp({});
    const res = await app.request("/test-connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: "exa",
        apiKey: "exa-draft",
      }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /test-connection — cross-tenant isolation", () => {
  it("never surfaces tenant B's saved key to tenant A", async () => {
    const loader = vi.fn<SavedKeyLoader>(async (tenantId) => {
      if (tenantId === "t-b") return "secret-for-b";
      return null;
    });
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, {})),
    ) as unknown as typeof fetch;
    const serviceDeps: TestConnectionDeps = {
      fetch: fetchImpl,
      loadSavedKey: loader,
      now: () => 0,
    };
    const app = buildApp({ serviceDeps });

    const res = await app.request("/test-connection", {
      method: "POST",
      headers: {
        "x-test-tenant-id": "t-a",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target: "exa",
        useSavedKey: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: false; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("auth");
    // The loader was only called with tenant A; tenant B's key was never loaded.
    expect(loader.mock.calls.map((c) => c[0])).toEqual(["t-a"]);
    // The vendor fetch must not fire when no key resolved.
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});

describe("POST /test-connection — rate limit", () => {
  it("returns 429 on the 6th rapid request within the window", async () => {
    const limiter = new TestConnectionRateLimiter({
      capacity: 5,
      windowMs: 60_000,
      now: () => 1,
    });
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { data: [{ id: "gpt-5.4" }] })),
    ) as unknown as typeof fetch;
    const app = buildApp({
      serviceDeps: { fetch: fetchImpl, now: () => 1 },
      rateLimiter: limiter,
    });

    const makeReq = () =>
      app.request("/test-connection", {
        method: "POST",
        headers: {
          "x-test-tenant-id": "t-a",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          target: "llm",
          provider: "openai",
          model: "gpt-5.4",
          apiKey: "sk-draft",
        }),
      });

    for (let i = 0; i < 5; i++) {
      const r = await makeReq();
      expect(r.status).toBe(200);
    }
    const sixth = await makeReq();
    expect(sixth.status).toBe(429);
    const body = (await sixth.json()) as { ok: false; code: string };
    expect(body.code).toBe("rate_limit");
  });
});

describe("POST /test-connection — happy path", () => {
  it("returns 200 with a schema-valid success body for a draft LLM key", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { data: [{ id: "gpt-5.4" }] })),
    ) as unknown as typeof fetch;
    const app = buildApp({
      serviceDeps: { fetch: fetchImpl, now: () => 1 },
    });

    const res = await app.request("/test-connection", {
      method: "POST",
      headers: {
        "x-test-tenant-id": "t-a",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target: "llm",
        provider: "openai",
        model: "gpt-5.4",
        apiKey: "sk-draft",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: true;
      latencyMs: number;
      providerEcho?: { model?: string };
    };
    expect(body.ok).toBe(true);
    expect(typeof body.latencyMs).toBe("number");
    expect(body.providerEcho?.model).toBe("gpt-5.4");
    // Response JSON must never contain the plaintext key.
    expect(JSON.stringify(body)).not.toContain("sk-draft");
  });
});
