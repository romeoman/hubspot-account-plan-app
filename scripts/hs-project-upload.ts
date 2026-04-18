#!/usr/bin/env node
/**
 * Wrapper around `hs project upload` that copies apps/hubspot-project/ to a
 * temp dir outside the worktree before uploading.
 *
 * The HubSpot CLI's bundler fails when run from inside a git worktree
 * (cards/*.tsx files are reported "not found"). Same files upload cleanly
 * from a /tmp dir. See apps/hubspot-project/UPLOAD.md for the full diagnosis.
 *
 * Slice 10: the wrapper now reads the selected HubSpot profile's
 * `variables.API_ORIGIN` and sets `process.env.API_ORIGIN` before invoking
 * the programmatic bundler, so `__HAP_API_ORIGIN__` is baked into both the
 * card and settings bundles at build time.
 *
 * @todo Slice 3: remove this wrapper if/when @hubspot/cli handles worktrees.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  extractApiOrigin,
  loadProfile,
  resolveProfilePath,
} from "../apps/hubspot-extension/scripts/build-with-profile";

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
  execFileSync("pnpm", ["tsx", "scripts/bundle-hubspot-card-cli.ts"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
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

/**
 * Pure helper: pull the `--profile`/`-p` value out of argv.
 *
 * Returns `undefined` when the flag is absent, so callers can still throw
 * the "HubSpot profile required" error themselves.
 */
export function extractProfileName(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--profile" || arg === "-p") {
      return args[i + 1];
    }
    if (arg?.startsWith("--profile=")) {
      return arg.slice("--profile=".length);
    }
    if (arg?.startsWith("-p=")) {
      return arg.slice("-p=".length);
    }
  }
  return undefined;
}

export function buildUploadRunner(deps: UploadDeps) {
  return (args: string[]): number => {
    const profileName = extractProfileName(args);
    if (!profileName) {
      throw new Error("hs project upload requires --profile <name>");
    }

    const root = deps.repoRoot();
    const profileDir = join(root, PROJECT_DIR);
    const profilePath = resolveProfilePath(profileName, profileDir);
    const profile = loadProfile(profilePath);
    const apiOrigin = extractApiOrigin(profile);

    const src = join(root, PROJECT_DIR);
    const tmp = deps.makeTempDir();

    const previousApiOrigin = process.env.API_ORIGIN;
    process.env.API_ORIGIN = apiOrigin;
    try {
      deps.runBundle(root);
      deps.log(`[hs-upload] copying ${src} → ${tmp}`);
      deps.copyProject(src, tmp);
      deps.log(`[hs-upload] running '${HS_CLI} project upload' from ${tmp}`);
      return deps.runUpload(tmp, args);
    } finally {
      if (previousApiOrigin === undefined) {
        delete process.env.API_ORIGIN;
      } else {
        process.env.API_ORIGIN = previousApiOrigin;
      }
    }
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

/**
 * Portable "is this file the entry point?" check. `import.meta.main` works
 * on native Node 21.2+ but is `undefined` under `tsx`. Fall back to
 * comparing `import.meta.url` against the file:// URL of `process.argv[1]`.
 */
function isMain(): boolean {
  if (typeof import.meta.main === "boolean") {
    return import.meta.main;
  }
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  process.exit(main());
}
