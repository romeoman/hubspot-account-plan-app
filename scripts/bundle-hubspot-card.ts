import { execFile } from "node:child_process";
import { cp, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = resolve(rootDir, "apps/hubspot-extension");
const extensionDistDir = resolve(extensionDir, "dist");
const projectDistDir = resolve(rootDir, "apps/hubspot-project/src/app/cards/dist");

async function ensureFile(path: string) {
  await stat(path);
}

async function main() {
  await execFileAsync("pnpm", ["--filter", "@hap/hubspot-extension", "build"], {
    cwd: rootDir,
  });

  const bundlePath = resolve(extensionDistDir, "index.js");
  await ensureFile(bundlePath);

  await mkdir(projectDistDir, { recursive: true });
  await cp(bundlePath, resolve(projectDistDir, "index.js"));

  const cssPath = resolve(extensionDistDir, "index.css");
  try {
    await ensureFile(cssPath);
    await cp(cssPath, resolve(projectDistDir, "index.css"));
  } catch {
    // No stylesheet emitted for this bundle.
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
