import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const apiSrcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

describe("apps/api Node ESM import discipline", () => {
  it("uses explicit .js suffixes for non-package relative imports", () => {
    const invalidSpecifiers: Array<{ file: string; specifier: string }> = [];
    const files = walkTsFiles(apiSrcRoot);

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const matches = text.matchAll(
        /\b(?:import|export)\b[\s\S]*?\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g,
      );
      for (const match of matches) {
        const specifier = match[1];
        if (!specifier) {
          continue;
        }
        if (!specifier.endsWith(".js") && !specifier.endsWith(".json")) {
          invalidSpecifiers.push({
            file: file.replace(`${apiSrcRoot}/`, ""),
            specifier,
          });
        }
      }
    }

    expect(invalidSpecifiers).toEqual([]);
  });
});
