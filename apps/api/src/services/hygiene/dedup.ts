/**
 * Evidence deduplication.
 *
 * Collapses Evidence rows that represent the same underlying article from
 * different ingestion paths. Slice 2 signal adapters prefix their `id` with
 * a provider namespace (e.g. `exa:https://example.com/x`,
 * `news:https://example.com/x`); without dedup the same URL ingested through
 * two providers would double-count in the reason generator and inflate
 * trust.
 *
 * ## Dedup key
 *
 * `${canonicalUrl}:${sha256(content)}`
 *
 * Where `canonicalUrl` is derived by stripping the `<provider>:` namespace
 * prefix from `evidence.id` and lower-casing the result. This matches the
 * Step 9 Exa adapter's `id = "exa:${url}"` shape. If the id has no `:`
 * (provider-less, e.g. mock fixtures), the raw lower-cased id is used.
 *
 * ## Semantics
 *
 * - FIRST occurrence wins. Source-order ranking stays stable so downstream
 *   reason extraction is deterministic.
 * - Cross-provider duplicates collapse: `exa:URL` + `news:URL` with
 *   matching content → one row (first occurrence kept).
 * - Same URL, DIFFERENT content → two rows (likely an update / retraction;
 *   the reason generator can pick the best one).
 * - Empty input → empty output.
 *
 * ## Tenant safety
 *
 * Callers pass tenant-scoped Evidence[]. Dedup operates purely on the
 * supplied array; it does not cross tenant boundaries. See dedup.test.ts
 * `tenant isolation sanity` case.
 */

import { createHash } from "node:crypto";
import type { Evidence } from "@hap/config";

/**
 * Strip the `<provider>:` prefix from an Evidence id, returning the
 * canonical URL (or raw id if no prefix). Lower-cased for case-insensitive
 * comparison across providers that may differ on URL casing.
 */
function canonicalizeId(id: string): string {
  const colonIdx = id.indexOf(":");
  if (colonIdx === -1) return id.toLowerCase();
  // Skip the prefix but preserve protocol colons (e.g. `exa:https://...`).
  // First token = provider namespace; everything after = URL.
  const rest = id.slice(colonIdx + 1);
  return rest.toLowerCase();
}

function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function dedupKey(evidence: Evidence): string {
  return `${canonicalizeId(evidence.id)}:${contentHash(evidence.content)}`;
}

/**
 * Collapse duplicate Evidence, keeping the first occurrence of each
 * `{canonicalUrl, contentHash}` pair. Order of survivors matches input
 * order.
 */
export function dedupEvidence(evidence: Evidence[]): Evidence[] {
  if (evidence.length === 0) return [];
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const ev of evidence) {
    const key = dedupKey(ev);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  return out;
}
