import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = resolve(rootDir, "apps/hubspot-extension");
const tempBundleRoot = resolve(extensionDir, ".bundle-artifacts");

type BundleTarget = {
  name: "card" | "settings";
  entry: string;
  outDir: string;
  projectDistDir: string;
};

const bundleTargets: BundleTarget[] = [
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

async function ensureFile(path: string) {
  await stat(path);
}

async function buildTarget(target: BundleTarget) {
  await rm(target.outDir, { recursive: true, force: true });

  await build({
    configFile: false,
    root: extensionDir,
    plugins: [react()],
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
  process.exitCode = 1;
});
