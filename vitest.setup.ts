/**
 * Vitest setup — loads .env files before any test file runs.
 *
 * Search order (later files override earlier when override:true is set):
 *   1. <main-repo-root>/.env       — primary secrets (HUBSPOT_*, ROOT_KEK, ...)
 *   2. <worktree-root>/.env        — worktree-local override (rare; allowed)
 *   3. <worktree-root>/.env.test.local — test-only overrides (ALLOW_TEST_AUTH, ...)
 *
 * The "main repo root" is resolved by reading .git: if .git is a file
 * (worktree), it points at <main>/.git/worktrees/<name>; the main repo root
 * is two levels above that. If .git is a directory (main worktree), the
 * current directory IS the repo root.
 *
 * This lets developers keep one .env at the main repo root and have all
 * worktrees' tests pick it up without copying or symlinking secrets.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));

function resolveMainRepoRoot(start: string): string {
  const gitPath = join(start, ".git");
  if (!existsSync(gitPath)) return start;
  if (statSync(gitPath).isDirectory()) return start;
  // .git is a file (worktree) → contents like: gitdir: /abs/path/.git/worktrees/<name>
  const contents = readFileSync(gitPath, "utf8");
  const match = contents.match(/^gitdir:\s*(.+)$/m);
  if (!match) return start;
  // gitdir = <main>/.git/worktrees/<name> → main = up two dirs
  return resolve(dirname(dirname(dirname(match[1].trim()))));
}

const mainRoot = resolveMainRepoRoot(here);
const candidates = [join(mainRoot, ".env"), join(here, ".env"), join(here, ".env.test.local")];

for (const path of candidates) {
  if (!existsSync(path)) continue;
  const isOverride = path.endsWith(".env.test.local");
  config({ path, override: isOverride });
}

/**
 * CI fallback: when no .env files are present (e.g. GitHub Actions), inject
 * safe test defaults so the Zod env validator (`packages/config/src/env.ts`)
 * doesn't fail before any test runs. These values are meaningless — they
 * exist solely to satisfy the schema; tests that actually exercise crypto
 * or HubSpot auth paths stub or override the relevant functions. Production
 * NEVER runs vitest.
 */
const TEST_DEFAULTS = {
  DATABASE_URL: "postgresql://hap:hap_local_dev@localhost:5433/hap_dev",
  HUBSPOT_CLIENT_ID: "test-client-id",
  HUBSPOT_CLIENT_SECRET: "test-client-secret",
  // 32 random bytes, base64. Deterministic test value; NOT a real KEK.
  ROOT_KEK: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  ALLOW_TEST_AUTH: "true",
  NODE_ENV: "test",
} as const;

for (const [key, value] of Object.entries(TEST_DEFAULTS)) {
  if (!process.env[key]) process.env[key] = value;
}
