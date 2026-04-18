/**
 * CLI entry for the profile-aware build wrapper.
 *
 * Usage:
 *   pnpm --filter @hap/hubspot-extension exec tsx \
 *     scripts/build-with-profile-cli.ts --profile staging
 *
 * OR via the matching package script:
 *   pnpm --filter @hap/hubspot-extension run build:with-profile -- --profile staging
 *
 * Resolution order for the profile name:
 *   1. `--profile <name>` CLI flag
 *   2. `HS_PROFILE` env var
 *   3. error (we refuse to guess a default — production and staging must be
 *      selected deliberately).
 *
 * The profile directory defaults to the sibling `apps/hubspot-project/`
 * tree resolved relative to this file. Override with `--profile-dir` if the
 * wrapper is invoked from outside the monorepo (e.g., a packaged release).
 */
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { runBuildWithProfile } from "./build-with-profile";

function parseArgs(argv: string[]): { profile?: string; profileDir?: string } {
  const out: { profile?: string; profileDir?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--profile" || arg === "-p") {
      out.profile = argv[++i];
    } else if (arg === "--profile-dir") {
      out.profileDir = argv[++i];
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const profileName = args.profile ?? process.env.HS_PROFILE;
  if (!profileName) {
    throw new Error("Profile name is required. Pass --profile <name> or set HS_PROFILE.");
  }

  const here = fileURLToPath(new URL(".", import.meta.url));
  const extensionRoot = resolvePath(here, "..");
  const defaultProfileDir = resolvePath(extensionRoot, "..", "hubspot-project");
  const profileDir = args.profileDir
    ? resolvePath(process.cwd(), args.profileDir)
    : defaultProfileDir;

  await runBuildWithProfile({
    profileName,
    profileDir,
    runBuild: async () => {
      await build({
        configFile: resolvePath(extensionRoot, "vite.config.ts"),
        root: extensionRoot,
      });
    },
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
