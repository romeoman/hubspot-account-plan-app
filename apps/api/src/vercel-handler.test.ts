import { describe, expect, it } from "vitest";

describe("vercel handler", () => {
  it("exports a request handler that responds to /health", async () => {
    const { default: handler } = await import("./vercel-handler.js");
    const res = await handler(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
  });
});
