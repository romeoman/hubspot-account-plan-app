import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Only start server when run directly (not when imported by tests)
if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT) || 3001;
  console.log(`API server starting on port ${port}`);
  serve({ fetch: app.fetch, port });
}

export default app;
