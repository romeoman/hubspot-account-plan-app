/**
 * Library module for the programmatic two-bundle HubSpot upload pipeline.
 *
 * Pure helpers + the `bundleTargets` declaration only. No top-level `vite`
 * import, no plugin import, no CLI entry — those live in
 * `bundle-hubspot-card-cli.ts` so this file can be imported from tests
 * without pulling in `@vitejs/plugin-react` (not resolvable from the repo
 * root under plain Node resolution) or kicking off a build as a side
 * effect of import.
 *
 * The `define` block mirrors the Slice 8 contract pinned by
 * `apps/hubspot-extension/vite.config.ts`:
 *   - `__HAP_API_ORIGIN__` is always `JSON.stringify(apiOrigin)`
 *   - an empty-string sentinel is emitted when the caller has no origin
 *   - trailing slashes are preserved verbatim — no normalization
 */
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
