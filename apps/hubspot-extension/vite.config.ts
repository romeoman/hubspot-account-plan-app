import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config is a factory so `process.env.API_ORIGIN` is read EACH time
 * `vite build` runs. The HubSpot project build wrapper sets that env per
 * active profile before invoking the build, and the value flows through
 * `define` into the bundled JavaScript as the literal string constant
 * `__HAP_API_ORIGIN__` — consumed at runtime by
 * `src/features/snapshot/hooks/api-fetcher.ts::resolveApiBaseUrl`.
 *
 * Contract (pinned by `__tests__/vite-config.test.ts`):
 *   - `API_ORIGIN=...`  → `__HAP_API_ORIGIN__ = JSON.stringify(value)`
 *   - `API_ORIGIN`unset → `__HAP_API_ORIGIN__ = JSON.stringify("")`
 *   - values are preserved verbatim (no trailing-slash normalization).
 */
export default defineConfig(() => {
  const apiOrigin = process.env.API_ORIGIN ?? "";

  return {
    plugins: [react()],
    define: {
      __HAP_API_ORIGIN__: JSON.stringify(apiOrigin),
    },
    build: {
      emptyOutDir: true,
      lib: {
        entry: resolve(__dirname, "src/hubspot-card-entry.tsx"),
        formats: ["es"],
      },
      rollupOptions: {
        output: {
          entryFileNames: "index.js",
        },
      },
    },
  };
});
