/**
 * Vercel serverless entrypoint.
 *
 * Bypasses the `@vercel/hono` framework preset (which currently fails the
 * project's TypeScript compile under @types/node v22 + Hono v4) by using
 * Hono's official `hono/vercel` adapter directly. The preset normally does
 * two things: (1) compile TS, (2) wrap the exported app for Vercel's Node
 * runtime. We do (1) ourselves via the project's `tsc -b` build, and (2)
 * via `handle(app)` here, which is a 3-line wrapper: `(app) => (req) =>
 * app.fetch(req)`.
 *
 * Local dev (`pnpm dev`) and tests still go through `src/index.ts` and are
 * unchanged - that file already guards `serve()` with `!process.env.VERCEL`.
 *
 * See `apps/api/vercel.json` for the matching deploy config.
 */
import { handle } from "hono/vercel";
import app from "./index.js";

export const config = { runtime: "nodejs" } as const;

export default handle(app);
