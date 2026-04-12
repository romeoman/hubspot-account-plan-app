import { describe, expect, it } from "vitest";

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
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeDefined();
  });
});
