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

function runBundle(root: string): void {
  console.log("[hs-upload] bundling HubSpot card and settings page");
  execFileSync("pnpm", ["tsx", "scripts/bundle-hubspot-card.ts"], {
    cwd: root,
    stdio: "inherit",
  });
}

export interface UploadDeps {
  repoRoot(): string;
  makeTempDir(): string;
  copyProject(src: string, tmp: string): void;
  runBundle(root: string): void;
  runUpload(tmp: string, args: string[]): number;
  log(message: string): void;
}

export function buildUploadRunner(deps: UploadDeps) {
  return (args: string[]): number => {
    const root = deps.repoRoot();
    const src = join(root, PROJECT_DIR);
    const tmp = deps.makeTempDir();

    deps.runBundle(root);
    deps.log(`[hs-upload] copying ${src} → ${tmp}`);
    deps.copyProject(src, tmp);
    deps.log(`[hs-upload] running '${HS_CLI} project upload' from ${tmp}`);
    return deps.runUpload(tmp, args);
  };
}

export function main(args = process.argv.slice(2)): number {
  return buildUploadRunner({
    repoRoot,
    makeTempDir: () => mkdtempSync(join(tmpdir(), "hap-hs-upload-")),
    copyProject: (src, tmp) => {
      cpSync(src, tmp, {
        recursive: true,
        filter: (file) => !file.includes("node_modules") && !file.endsWith(".tsbuildinfo"),
      });
    },
    runBundle,
    runUpload: (tmp, uploadArgs) =>
      spawnSync(HS_CLI, ["project", "upload", ...uploadArgs], {
        cwd: tmp,
        stdio: "inherit",
        env: process.env,
      }).status ?? 1,
    log: (message) => console.log(message),
  })(args);
}

if (import.meta.main) {
  process.exit(main());
}
