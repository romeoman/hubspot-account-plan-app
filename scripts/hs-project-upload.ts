#!/usr/bin/env node
/**
 * Wrapper around `hs project upload` that copies apps/hubspot-project/ to a
 * temp dir outside the worktree before uploading.
 *
 * The HubSpot CLI's bundler fails when run from inside a git worktree
 * (cards/*.tsx files are reported "not found"). Same files upload cleanly
 * from a /tmp dir. See apps/hubspot-project/UPLOAD.md for the full diagnosis.
 *
 * @todo Slice 3: remove this wrapper if/when @hubspot/cli handles worktrees.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_DIR = "apps/hubspot-project";
// Default to PATH-resolved `hs` so the wrapper works across environments.
// Override via HS_CLI_PATH env var when a specific binary is required
// (e.g., when a system-wide older version shadows a user-installed newer one).
const HS_CLI = process.env.HS_CLI_PATH ?? "hs";

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
}

function main(): number {
  const root = repoRoot();
  const src = join(root, PROJECT_DIR);
  const tmp = mkdtempSync(join(tmpdir(), "hap-hs-upload-"));

  console.log(`[hs-upload] copying ${src} → ${tmp}`);
  cpSync(src, tmp, {
    recursive: true,
    filter: (file) => !file.includes("node_modules") && !file.endsWith(".tsbuildinfo"),
  });

  console.log(`[hs-upload] running '${HS_CLI} project upload' from ${tmp}`);
  const result = spawnSync(HS_CLI, ["project", "upload", ...process.argv.slice(2)], {
    cwd: tmp,
    stdio: "inherit",
    env: process.env,
  });

  return result.status ?? 1;
}

process.exit(main());
