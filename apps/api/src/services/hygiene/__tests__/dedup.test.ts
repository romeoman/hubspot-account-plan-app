/**
 * Dedup hygiene unit tests.
 *
 * Dedup collapses Evidence that have the same canonical-URL and the same
 * content SHA-256. Two cross-provider rows (e.g. `exa:URL` + `news:URL`)
 * with matching content are the same article from two ingestion paths and
 * must collapse to ONE. Same URL + different content is two distinct
 * articles and stays as two.
 *
 * First occurrence wins — preserves source-order semantics so downstream
 * ranking stays stable.
 */

import { createEvidence, type Evidence } from "@hap/config";
import { describe, expect, it } from "vitest";
import { dedupEvidence } from "../dedup";

const TENANT = "tenant-dedup-a";

function ev(overrides: Partial<Evidence> = {}): Evidence {
  return createEvidence(TENANT, {
    id: overrides.id ?? "exa:https://example.com/a",
    source: overrides.source ?? "example.com",
    confidence: overrides.confidence ?? 0.7,
    content: overrides.content ?? "some content",
    timestamp: overrides.timestamp ?? new Date("2026-04-15T00:00:00Z"),
    isRestricted: overrides.isRestricted ?? false,
    ...overrides,
  });
}

describe("dedupEvidence", () => {
  it("collapses same id + same content to a single entry", () => {
    const a = ev({ id: "exa:https://example.com/x", content: "hello" });
    const b = ev({ id: "exa:https://example.com/x", content: "hello" });
    const out = dedupEvidence([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(a); // first occurrence wins — reference-equal
  });

  it("collapses cross-provider duplicates (exa:URL vs news:URL) when content hashes match", () => {
    const a = ev({
      id: "exa:https://example.com/acme-funding",
      content: "same story",
    });
    const b = ev({
      id: "news:https://example.com/acme-funding",
      source: "example.com",
      content: "same story",
    });
    const out = dedupEvidence([a, b]);
    expect(out).toHaveLength(1);
    // First occurrence (the exa row) is kept.
    expect(out[0]?.id).toBe("exa:https://example.com/acme-funding");
  });

  it("keeps same-URL-different-content as two distinct rows", () => {
    const a = ev({ id: "exa:https://example.com/y", content: "version 1" });
    const b = ev({
      id: "exa:https://example.com/y",
      content: "version 2 updated",
    });
    const out = dedupEvidence([a, b]);
    expect(out).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(dedupEvidence([])).toEqual([]);
  });

  it("preserves input order among survivors", () => {
    const a = ev({ id: "exa:https://example.com/1", content: "one" });
    const b = ev({ id: "exa:https://example.com/2", content: "two" });
    const c = ev({ id: "exa:https://example.com/1", content: "one" }); // dup of a
    const d = ev({ id: "exa:https://example.com/3", content: "three" });
    const out = dedupEvidence([a, b, c, d]);
    expect(out.map((e) => e.id)).toEqual([
      "exa:https://example.com/1",
      "exa:https://example.com/2",
      "exa:https://example.com/3",
    ]);
  });

  it("does NOT collapse rows from distinct tenants when called per-tenant (tenant isolation sanity)", () => {
    // Hygiene operates on a single tenant-scoped Evidence[]; callers never
    // mix tenants into the same array. This test documents that invariant:
    // even if two rows had "matching" id + content but different tenantIds,
    // running dedup on two separate arrays (per tenant) keeps them isolated.
    const tenantA: Evidence[] = [
      createEvidence("tenant-A", {
        id: "exa:https://shared.com/x",
        source: "shared.com",
        confidence: 0.7,
        content: "shared story",
        timestamp: new Date(),
        isRestricted: false,
      }),
    ];
    const tenantB: Evidence[] = [
      createEvidence("tenant-B", {
        id: "exa:https://shared.com/x",
        source: "shared.com",
        confidence: 0.7,
        content: "shared story",
        timestamp: new Date(),
        isRestricted: false,
      }),
    ];
    const outA = dedupEvidence(tenantA);
    const outB = dedupEvidence(tenantB);
    expect(outA).toHaveLength(1);
    expect(outB).toHaveLength(1);
    expect(outA[0]?.tenantId).toBe("tenant-A");
    expect(outB[0]?.tenantId).toBe("tenant-B");
  });
});
