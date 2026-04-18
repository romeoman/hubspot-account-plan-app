/**
 * End-to-end proof that the wrapper produces a bundle containing the
 * profile's API_ORIGIN. Complements the unit tests in
 * `build-with-profile.test.ts` by exercising the actual Vite build.
 *
 * Slower than unit tests (one real `vite build`), so kept narrow — a single
 * profile round-trip. The companion Slice 8 determinism test
 * (`built-bundle-origin.test.ts`) already covers multi-origin determinism
 * at the Vite level; this test covers the profile-file → env → build path.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runBuildWithProfile } from "../build-with-profile";

const EXTENSION_ROOT = resolvePath(__dirname, "..", "..");

let scratch: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "hap-build-wrapper-e2e-"));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("build-with-profile (end-to-end)", () => {
  it("builds the extension bundle with the profile's API_ORIGIN baked in", async () => {
    const profileDir = join(scratch, "profiles");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, "hsprofile.staging.json"),
      JSON.stringify({
        accountId: 12345678,
        variables: {
          OAUTH_REDIRECT_URI: "https://hap-signal-workspace-staging.vercel.app/oauth/callback",
          API_ORIGIN: "https://hap-signal-workspace-staging.vercel.app",
        },
      }),
    );

    const outDir = join(scratch, "out");
    mkdirSync(outDir, { recursive: true });

    await runBuildWithProfile({
      profileName: "staging",
      profileDir,
      runBuild: async () => {
        await build({
          configFile: resolvePath(EXTENSION_ROOT, "vite.config.ts"),
          root: EXTENSION_ROOT,
          logLevel: "error",
          build: {
            outDir,
            emptyOutDir: true,
          },
        });
      },
    });

    const bundle = readFileSync(join(outDir, "index.js"), "utf8");
    expect(bundle).toContain("https://hap-signal-workspace-staging.vercel.app");
    // Sanity: prod URL is not what the staging build shipped as the target.
    expect(bundle).not.toContain("https://hap-signal-workspace.vercel.app/api/snapshot/");
  }, 45_000);
});
