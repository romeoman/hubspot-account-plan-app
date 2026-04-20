import { describe, expect, it } from "vitest";

describe("vercel handler", () => {
  it("exports an app that responds to /health", async () => {
    const { default: app } = await import("./vercel-handler.js");
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });
});
