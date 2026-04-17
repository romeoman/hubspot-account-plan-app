import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@hono/node-server");
});

describe("API health endpoint", () => {
  it("should be importable", async () => {
    // Verify the Hono app module can be imported without errors
    const mod = await import("./index");
    expect(mod.default).toBeDefined();
  });

  it("should respond to /health", async () => {
    const { default: app } = await import("./index");
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeDefined();
  });

  it("mounts the HubSpot lifecycle webhook receiver at /webhooks/hubspot/lifecycle and rejects unsigned requests with 401", async () => {
    const { default: app } = await import("./index");
    const res = await app.request("/webhooks/hubspot/lifecycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "[]",
    });
    // A 404 here would mean the route was never mounted in index.ts; the
    // specific 401 proves the request reached the lifecycle route's own
    // signature check rather than falling through to a generic handler.
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("unauthorized");
  });

  it("does not auto-start the HTTP server inside Vitest, even when simulating production mode", async () => {
    const serveSpy = vi.fn();
    vi.doMock("@hono/node-server", () => ({
      serve: serveSpy,
    }));

    const previousNodeEnv = process.env.NODE_ENV;
    const previousRedirectUri = process.env.HUBSPOT_OAUTH_REDIRECT_URI;
    process.env.NODE_ENV = "production";
    process.env.HUBSPOT_OAUTH_REDIRECT_URI =
      "https://hap-signal-workspace-staging.vercel.app/oauth/callback";

    try {
      const mod = await import("./index");
      expect(mod.default).toBeDefined();
      expect(serveSpy).not.toHaveBeenCalled();
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
      if (previousRedirectUri === undefined) {
        delete process.env.HUBSPOT_OAUTH_REDIRECT_URI;
      } else {
        process.env.HUBSPOT_OAUTH_REDIRECT_URI = previousRedirectUri;
      }
    }
  });
});
