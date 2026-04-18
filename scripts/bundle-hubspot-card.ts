import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { InlineConfig } from "vite";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = resolve(rootDir, "apps/hubspot-extension");
const tempBundleRoot = resolve(extensionDir, ".bundle-artifacts");

export type BundleTarget = {
  name: "card" | "settings";
  entry: string;
  outDir: string;
  projectDistDir: string;
};

export const bundleTargets: BundleTarget[] = [
  {
    name: "card",
    entry: resolve(extensionDir, "src/hubspot-card-entry.tsx"),
    outDir: resolve(tempBundleRoot, "card"),
    projectDistDir: resolve(rootDir, "apps/hubspot-project/src/app/cards/dist"),
  },
  {
    name: "settings",
    entry: resolve(extensionDir, "src/settings/settings-entry.tsx"),
    outDir: resolve(tempBundleRoot, "settings"),
    projectDistDir: resolve(rootDir, "apps/hubspot-project/src/app/settings/dist"),
  },
];

/**
 * Pure helper: build the Vite inline config for a single target.
 *
 * Mirrors the `define` contract pinned by `apps/hubspot-extension/vite.config.ts`
 * (Slice 8): `__HAP_API_ORIGIN__` is always `JSON.stringify(apiOrigin)`, with
 * an empty-string sentinel when the caller has not supplied an origin.
 * Trailing slashes are preserved verbatim — no normalization happens here.
 *
 * Plugins are intentionally omitted so tests can import this helper without
 * requiring `@vitejs/plugin-react` to be resolvable from the repo root.
 * `buildTarget` composes plugins in before invoking `vite.build`.
 */
export function buildViteOptions(target: BundleTarget, apiOrigin: string): InlineConfig {
  return {
    configFile: false,
    root: extensionDir,
    define: {
      __HAP_API_ORIGIN__: JSON.stringify(apiOrigin),
    },
    build: {
      emptyOutDir: true,
      outDir: target.outDir,
      lib: {
        entry: target.entry,
        formats: ["es"],
      },
      rollupOptions: {
        output: {
          entryFileNames: "index.js",
        },
      },
    },
  };
}

async function ensureFile(path: string) {
  await stat(path);
}

async function buildTarget(target: BundleTarget) {
  await rm(target.outDir, { recursive: true, force: true });

  const [{ default: react }, { build }] = await Promise.all([
    import("@vitejs/plugin-react"),
    import("vite"),
  ]);

  const baseOptions = buildViteOptions(target, process.env.API_ORIGIN ?? "");
  await build({
    ...baseOptions,
    plugins: [react()],
  });

  const bundlePath = resolve(target.outDir, "index.js");
  await ensureFile(bundlePath);

  await mkdir(target.projectDistDir, { recursive: true });
  await cp(bundlePath, resolve(target.projectDistDir, "index.js"));

  const cssPath = resolve(target.outDir, "style.css");
  try {
    await ensureFile(cssPath);
    await cp(cssPath, resolve(target.projectDistDir, "index.css"));
  } catch {
    // No stylesheet emitted for this bundle.
  }
}

export async function main() {
  for (const target of bundleTargets) {
    await buildTarget(target);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
