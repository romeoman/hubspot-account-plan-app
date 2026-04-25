import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type ExportTarget = {
  default: string;
  development: string;
  import: string;
  types: string;
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

function readJson(path: string) {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8")) as Record<string, unknown>;
}

function walkTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") {
        return [];
      }
      return walkTsFiles(path);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("workspace runtime export surface", () => {
  it("points workspace package exports at built dist files with declarations", () => {
    const configPkg = readJson("packages/config/package.json");
    const dbPkg = readJson("packages/db/package.json");
    const validatorsPkg = readJson("packages/validators/package.json");

    expect(configPkg.types).toBe("./dist/index.d.ts");
    expect(configPkg.exports).toEqual({
      ".": {
        default: "./dist/index.js",
        development: "./src/index.ts",
        import: "./dist/index.js",
        types: "./dist/index.d.ts",
      } satisfies ExportTarget,
    });

    expect(dbPkg.types).toBe("./dist/index.d.ts");
    expect(dbPkg.exports).toEqual({
      ".": {
        default: "./dist/index.js",
        development: "./src/index.ts",
        import: "./dist/index.js",
        types: "./dist/index.d.ts",
      } satisfies ExportTarget,
      "./schema": {
        default: "./dist/schema/index.js",
        development: "./src/schema/index.ts",
        import: "./dist/schema/index.js",
        types: "./dist/schema/index.d.ts",
      } satisfies ExportTarget,
    });

    expect(validatorsPkg.types).toBe("./dist/index.d.ts");
    expect(validatorsPkg.exports).toEqual({
      ".": {
        default: "./dist/index.js",
        development: "./src/index.ts",
        import: "./dist/index.js",
        types: "./dist/index.d.ts",
      } satisfies ExportTarget,
    });
  });

  it("keeps relative package-runtime imports Node ESM-safe", () => {
    const sourceRoots = [
      join(repoRoot, "packages/config/src"),
      join(repoRoot, "packages/db/src"),
      join(repoRoot, "packages/validators/src"),
    ];
    const files = sourceRoots.flatMap((root) => walkTsFiles(root));
    const invalidSpecifiers: Array<{ file: string; specifier: string }> = [];

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const matches = text.matchAll(
        /\bimport\s+["'](\.[^"']+)["']|\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)|\b(?:import|export)\b[\s\S]*?\bfrom\s+["'](\.[^"']+)["']/g,
      );
      for (const match of matches) {
        const specifier = match[1] ?? match[2] ?? match[3];
        if (!specifier) {
          continue;
        }
        if (!specifier.endsWith(".js") && !specifier.endsWith(".json")) {
          invalidSpecifiers.push({
            file: file.replace(`${repoRoot}/`, ""),
            specifier,
          });
        }
      }
    }

    expect(invalidSpecifiers).toEqual([]);
  });
});
