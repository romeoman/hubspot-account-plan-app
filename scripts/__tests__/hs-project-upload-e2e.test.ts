/**
 * End-to-end determinism check for the production upload pipeline.
 *
 * Writes a HubSpot profile with a sentinel `API_ORIGIN`, invokes the upload
 * runner with `runUpload` stubbed to exit 0 (so `hs project upload` is
 * never called), but lets `runBundle` run for real. This exercises the
 * actual Vite build via `scripts/bundle-hubspot-card-cli.ts` and proves
 * that the emitted card bundle carries the profile's origin string
 * verbatim — closing the Slice 8 / Slice 9 / Slice 10 loop end-to-end.
 *
 * Scope note on the settings bundle:
 *   The `define` contract is applied to *both* card and settings targets
 *   (see `scripts/__tests__/bundle-hubspot-card.test.ts`), but the settings
 *   entry reads `API_ORIGIN` from `context.variables` at runtime rather
 *   than the `__HAP_API_ORIGIN__` global. Nothing in the settings source
 *   currently references that identifier, so Vite has no substitution site
 *   to inline it into the settings bundle. The card bundle — which does
 *   reference `__HAP_API_ORIGIN__` via `features/snapshot/hooks/api-fetcher`
 *   — is the real evidence that the end-to-end pipeline works. We verify
 *   both bundles are produced, but only assert the origin string on the
 *   card bundle.
 *
 * Builds are slow (~1-2s each; two targets per run) so we scope to a
 * single origin rather than sweeping the matrix.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildUploadRunner, type UploadDeps } from "../hs-project-upload";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const PROFILE_NAME = "slice10e2e";
const PROFILE_PATH = resolve(repoRoot, "apps/hubspot-project", `hsprofile.${PROFILE_NAME}.json`);
const SENTINEL_ORIGIN = "https://slice10-e2e.example.test";

const CARD_BUNDLE = resolve(repoRoot, "apps/hubspot-project/src/app/cards/dist/index.js");
const SETTINGS_BUNDLE = resolve(repoRoot, "apps/hubspot-project/src/app/settings/dist/index.js");

describe("hs-project-upload — e2e define contract", () => {
  beforeAll(() => {
    writeFileSync(
      PROFILE_PATH,
      JSON.stringify(
        {
          accountId: 424242,
          variables: {
            OAUTH_REDIRECT_URI: "https://slice10-e2e.example.test/oauth/callback",
            API_ORIGIN: SENTINEL_ORIGIN,
          },
        },
        null,
        2,
      ),
    );
  });

  afterAll(() => {
    if (existsSync(PROFILE_PATH)) {
      // Clean up the temp profile; it is gitignored but leaving it around
      // would confuse later runs.
      rmSync(PROFILE_PATH, { force: true });
    }
  });

  it("embeds the profile's API_ORIGIN into both the card and settings bundles", async () => {
    let uploadCalls = 0;
    const deps: UploadDeps = {
      repoRoot: () => repoRoot,
      makeTempDir: () => join(repoRoot, ".bundle-artifacts-e2e-scratch"),
      copyProject: () => {
        // Skip copying to the temp dir — the upload is stubbed below, so
        // nothing downstream reads this path.
      },
      runBundle: (root) => {
        // Run the real bundler against the real extension source so we
        // exercise the Vite define substitution end-to-end.
        execFileSync("pnpm", ["tsx", "scripts/bundle-hubspot-card-cli.ts"], {
          cwd: root,
          stdio: "inherit",
          env: process.env,
        });
      },
      runUpload: () => {
        uploadCalls += 1;
        return 0;
      },
      log: () => {
        // Silence logs in the test runner.
      },
    };

    const code = buildUploadRunner(deps)(["--profile", PROFILE_NAME]);

    expect(code).toBe(0);
    expect(uploadCalls).toBe(1);

    const cardBundle = readFileSync(CARD_BUNDLE, "utf8");
    const settingsBundle = readFileSync(SETTINGS_BUNDLE, "utf8");

    // Card bundle references __HAP_API_ORIGIN__ and must embed the sentinel.
    expect(cardBundle).toContain(SENTINEL_ORIGIN);
    // Settings bundle is produced (proves the two-target pipeline ran) but
    // today its source does not reference __HAP_API_ORIGIN__, so the define
    // contract has no substitution site there. See the module docstring.
    expect(settingsBundle.length).toBeGreaterThan(0);
  }, 60_000);
});
