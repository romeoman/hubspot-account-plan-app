import { serve } from "@hono/node-server";
import app from "./app.js";

// Only start the real HTTP server outside test runners. Some tests
// temporarily simulate production mode while importing this module, so the
// guard must not rely on NODE_ENV alone.
if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true" && !process.env.VERCEL) {
  const port = Number(process.env.PORT) || 3001;
  console.log(`API server starting on port ${port}`);
  serve({ fetch: app.fetch, port });
}

export default app;
