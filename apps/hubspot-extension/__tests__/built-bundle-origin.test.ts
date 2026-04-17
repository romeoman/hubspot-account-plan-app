/**
 * End-to-end determinism check for the extension bundle.
 *
 * Loads the Vite config with different `API_ORIGIN` values, runs a real
 * `vite build` under each, and proves the produced bundle carries the
 * expected origin string verbatim. This closes the gap that
 * `vite-config.test.ts` cannot — the config contract is correct *and* the
 * bundler actually performs the substitution.
 *
 * Builds are slow (~1-2s each) so we scope to two targeted origins rather
 * than the full matrix. Bundle output is written to a temporary directory
 * outside `dist/` so local dev state isn't touched.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const EXTENSION_ROOT = resolvePath(__dirname, "..");

async function buildWith(apiOrigin: string, outDir: string): Promise<string> {
  const prev = process.env.API_ORIGIN;
  process.env.API_ORIGIN = apiOrigin;
  try {
    await build({
      configFile: resolvePath(EXTENSION_ROOT, "vite.config.ts"),
      root: EXTENSION_ROOT,
      logLevel: "error",
      build: {
        outDir,
        emptyOutDir: true,
      },
    });
  } finally {
    if (prev === undefined) {
      delete process.env.API_ORIGIN;
    } else {
      process.env.API_ORIGIN = prev;
    }
  }
  return readFileSync(join(outDir, "index.js"), "utf8");
}

let scratchRoot: string;

beforeAll(() => {
  scratchRoot = mkdtempSync(join(tmpdir(), "hap-ext-build-"));
  mkdirSync(scratchRoot, { recursive: true });
});

afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
});

describe("hubspot-extension built bundle — origin determinism", () => {
  it("embeds a staging API_ORIGIN literally into the bundle", async () => {
    const origin = "https://hap-signal-workspace-staging.vercel.app";
    const out = join(scratchRoot, "staging");
    const bundle = await buildWith(origin, out);

    expect(bundle).toContain(origin);
    // Sanity: the unrelated prod URL must NOT appear when staging built.
    expect(bundle).not.toContain("https://hap-signal-workspace.vercel.app/api/snapshot/");
  }, 30_000);

  it("embeds a local API_ORIGIN literally into the bundle", async () => {
    const origin = "https://hap-signal-workspace-local.vercel.app";
    const out = join(scratchRoot, "local");
    const bundle = await buildWith(origin, out);

    expect(bundle).toContain(origin);
  }, 30_000);
});
