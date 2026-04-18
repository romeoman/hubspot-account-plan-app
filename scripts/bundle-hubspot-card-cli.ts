#!/usr/bin/env node
/**
 * CLI entry for the programmatic two-bundle HubSpot upload pipeline.
 *
 * This is the file `scripts/hs-project-upload.ts` invokes via
 * `pnpm tsx scripts/bundle-hubspot-card-cli.ts`. It statically imports
 * `vite` and `@vitejs/plugin-react` (both resolvable under `pnpm tsx`'s
 * workspace-aware resolution) and orchestrates the per-target `build()`
 * calls. Keeping plugin imports out of the library module
 * (`bundle-hubspot-card.ts`) means the test file can import helpers
 * without requiring the react plugin to be hoisted to the repo root.
 */
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { type BundleTarget, buildViteOptions, bundleTargets } from "./bundle-hubspot-card";

async function ensureFile(path: string) {
  await stat(path);
}

async function buildTarget(target: BundleTarget) {
  await rm(target.outDir, { recursive: true, force: true });

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

async function main() {
  for (const target of bundleTargets) {
    await buildTarget(target);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
