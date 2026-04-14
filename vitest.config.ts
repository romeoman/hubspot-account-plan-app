import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Multiple test files touch the shared Postgres `tenants` table
    // (packages/db schema tests, apps/api tenant middleware tests).
    // Run test files sequentially to prevent cross-file DELETE races.
    fileParallelism: false,
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.{idea,git,cache,output,temp}/**",
      "docs/**",
      "planning/**",
      ".taskmaster/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["apps/*/src/**", "packages/*/src/**"],
      exclude: ["node_modules", "dist", "docs", "planning", ".taskmaster"],
    },
  },
});
