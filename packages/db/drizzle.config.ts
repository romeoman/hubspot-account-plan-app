import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

/**
 * Resolve the MAIN repo root (handles git worktrees).
 *
 * If we're running inside a worktree, `.git` is a file like
 * `gitdir: <main>/.git/worktrees/<name>` — the main repo root is two
 * directories above that gitdir. If `.git` is a directory, the current
 * tree IS the main repo. Mirrors the resolver in vitest.setup.ts so
 * `pnpm db:generate` / `pnpm db:migrate` see the same `.env` as tests do
 * regardless of which worktree they're invoked from.
 */
function resolveMainRepoRoot(start: string): string {
  const gitPath = join(start, ".git");
  if (!existsSync(gitPath)) return start;
  if (statSync(gitPath).isDirectory()) return start;
  const contents = readFileSync(gitPath, "utf8");
  const match = contents.match(/^gitdir:\s*(.+)$/m);
  if (!match) return start;
  return resolve(dirname(dirname(dirname(match[1].trim()))));
}

const packageRoot = resolve(__dirname);
const worktreeRoot = resolve(packageRoot, "../..");
const mainRoot = resolveMainRepoRoot(worktreeRoot);

// Load main-repo .env first (real secrets), then worktree-local .env (rare),
// then .env.test.local with override (test-only knobs). Same order as vitest.
for (const path of [
  join(mainRoot, ".env"),
  join(worktreeRoot, ".env"),
  join(worktreeRoot, ".env.test.local"),
]) {
  if (!existsSync(path)) continue;
  config({ path, override: path.endsWith(".env.test.local") });
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env at the main repo root, " +
      "or export DATABASE_URL before running drizzle-kit.",
  );
}

export default defineConfig({
  schema: "./src/schema",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
