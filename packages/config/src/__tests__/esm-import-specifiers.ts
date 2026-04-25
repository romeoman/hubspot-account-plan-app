const relativeEsmSpecifierPattern =
  /\bimport\s+["'](\.{1,2}\/[^"']+)["']|\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)|\b(?:import|export)\b[\s\S]*?\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g;

export function extractRelativeEsmSpecifiers(text: string): string[] {
  return Array.from(
    text.matchAll(relativeEsmSpecifierPattern),
    (match) => match[1] ?? match[2] ?? match[3],
  ).filter((specifier): specifier is string => Boolean(specifier));
}
