/**
 * Tests for the correlation-ID middleware (Slice 2 Step 7).
 *
 * Contract:
 *   - Reads `X-Request-Id` from the incoming request.
 *   - If absent, generates a UUIDv4 via `crypto.randomUUID()`.
 *   - Sets `c.set('correlationId', id)` on the Hono context.
 *   - Echoes `X-Request-Id: <id>` on the response (success OR failure).
 */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { type CorrelationVariables, correlationMiddleware } from "../correlation";

function buildApp() {
  const app = new Hono<{ Variables: CorrelationVariables }>();
  app.use("*", correlationMiddleware());
  app.get("/probe", (c) => c.json({ correlationId: c.get("correlationId") ?? null }));
  app.get("/fail", (c) => c.json({ error: "unauthorized" }, 401));
  return app;
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("correlationMiddleware", () => {
  it("generates a UUIDv4 when X-Request-Id is absent", async () => {
    const app = buildApp();
    const res = await app.request("/probe");
    const id = res.headers.get("X-Request-Id");
    expect(id).toBeTruthy();
    expect(id).toMatch(UUID_V4_RE);
    const body = (await res.json()) as { correlationId: string };
    expect(body.correlationId).toBe(id);
  });

  it("echoes an inbound X-Request-Id header verbatim", async () => {
    const app = buildApp();
    const res = await app.request("/probe", {
      headers: { "X-Request-Id": "foo-bar-123" },
    });
    expect(res.headers.get("X-Request-Id")).toBe("foo-bar-123");
    const body = (await res.json()) as { correlationId: string };
    expect(body.correlationId).toBe("foo-bar-123");
  });

  it("produces distinct IDs on consecutive requests without one", async () => {
    const app = buildApp();
    const r1 = await app.request("/probe");
    const r2 = await app.request("/probe");
    expect(r1.headers.get("X-Request-Id")).not.toBe(r2.headers.get("X-Request-Id"));
  });

  it("sets X-Request-Id on failed/401 responses too", async () => {
    const app = buildApp();
    const res = await app.request("/fail");
    expect(res.status).toBe(401);
    expect(res.headers.get("X-Request-Id")).toMatch(UUID_V4_RE);
  });
});
