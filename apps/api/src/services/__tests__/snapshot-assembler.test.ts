import { randomUUID } from "node:crypto";
import { createEvidence, type Evidence } from "@hap/config";
import { createDatabase, tenants } from "@hap/db";
import { like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createMockLlmAdapter } from "../../adapters/mock-llm-adapter";
import { createMockSignalAdapter } from "../../adapters/mock-signal-adapter";
import type { ProviderAdapter } from "../../adapters/provider-adapter";
import { TenantAccessRevokedError } from "../../lib/hubspot-client";
import type { CompanyPropertyFetcher } from "../eligibility";
import { clearEligibilityCache } from "../eligibility";
import type { ContactFetcher } from "../people-selector";
import { assembleSnapshot } from "../snapshot-assembler";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const db = createDatabase(DATABASE_URL);

const PORTAL_PREFIX = `assembletest-${randomUUID().slice(0, 8)}-`;

async function seedTenant(): Promise<string> {
  const [row] = await db
    .insert(tenants)
    .values({
      hubspotPortalId: `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`,
      name: "T",
    })
    .returning();
  if (!row) throw new Error("failed to seed tenant");
  return row.id;
}

const THRESHOLDS = { freshnessMaxDays: 30, minConfidence: 0.5 };

const ELIGIBLE: CompanyPropertyFetcher = async () => true;
const INELIGIBLE: CompanyPropertyFetcher = async () => false;
const UNCONFIGURED: CompanyPropertyFetcher = async () => null;

const threeContacts: ContactFetcher = async () => [
  { id: "c1", name: "Alice", title: "VP Engineering" },
  { id: "c2", name: "Bob", title: "CTO" },
  { id: "c3", name: "Carol", title: "Head of Platform" },
];
const zeroContacts: ContactFetcher = async () => [];

beforeEach(async () => {
  clearEligibilityCache();
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

afterAll(() => {
  // postgres.js cleans up on process exit
});

describe("assembleSnapshot", () => {
  it("returns ineligible snapshot when eligibility=ineligible", async () => {
    const tenantId = await seedTenant();
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: createMockSignalAdapter({ fixture: "strong" }),
        llmAdapter: createMockLlmAdapter(),
        propertyFetcher: INELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-x" },
    );
    expect(snap.eligibilityState).toBe("ineligible");
    expect(snap.people).toEqual([]);
    expect(snap.evidence).toEqual([]);
    expect(snap.stateFlags.ineligible).toBe(true);
    expect(snap.tenantId).toBe(tenantId);
    expect(snap.companyId).toBe("co-x");
    expect(snap.reasonToContact).toBeUndefined();
  });

  it("returns unconfigured snapshot when eligibility=unconfigured", async () => {
    const tenantId = await seedTenant();
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: createMockSignalAdapter({ fixture: "strong" }),
        propertyFetcher: UNCONFIGURED,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-y" },
    );
    expect(snap.eligibilityState).toBe("unconfigured");
    expect(snap.people).toEqual([]);
    expect(snap.evidence).toEqual([]);
    expect(snap.reasonToContact).toBeUndefined();
    expect(snap.tenantId).toBe(tenantId);
  });

  it("returns empty-state snapshot when eligible but no dominant signal", async () => {
    const tenantId = await seedTenant();
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: createMockSignalAdapter({ fixture: "empty" }),
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-empty" },
    );
    expect(snap.eligibilityState).toBe("eligible");
    expect(snap.stateFlags.empty).toBe(true);
    expect(snap.people).toEqual([]);
    expect(snap.reasonToContact).toBeUndefined();
    expect(snap.tenantId).toBe(tenantId);
  });

  it("returns full snapshot for eligible + strong signal + 3 contacts", async () => {
    const tenantId = await seedTenant();
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: createMockSignalAdapter({ fixture: "strong" }),
        llmAdapter: createMockLlmAdapter(),
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-full" },
    );
    expect(snap.eligibilityState).toBe("eligible");
    expect(snap.stateFlags.empty).toBe(false);
    expect(snap.stateFlags.ineligible).toBe(false);
    expect(snap.reasonToContact).toBeDefined();
    expect(snap.people.length).toBeGreaterThan(0);
    expect(snap.people.length).toBeLessThanOrEqual(3);
    expect(snap.evidence.length).toBeGreaterThan(0);
    expect(snap.tenantId).toBe(tenantId);
    // Every evidence row stamped with caller tenantId.
    for (const ev of snap.evidence) {
      expect(ev.tenantId).toBe(tenantId);
    }
  });

  it("rethrows tenant access revocation instead of downgrading it to a degraded snapshot", async () => {
    const tenantId = await seedTenant();
    const revokedProvider: ProviderAdapter = {
      name: "hubspot-enrichment",
      fetchSignals: async () => {
        throw new TenantAccessRevokedError();
      },
    };

    await expect(
      assembleSnapshot(
        {
          db,
          providerAdapter: revokedProvider,
          propertyFetcher: ELIGIBLE,
          contactFetcher: threeContacts,
          thresholds: THRESHOLDS,
        },
        { tenantId, companyId: "co-revoked" },
      ),
    ).rejects.toBeInstanceOf(TenantAccessRevokedError);
  });

  it("returns reason with empty people when signal exists but 0 contacts", async () => {
    const tenantId = await seedTenant();
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: createMockSignalAdapter({ fixture: "strong" }),
        propertyFetcher: ELIGIBLE,
        contactFetcher: zeroContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-nocontacts" },
    );
    expect(snap.eligibilityState).toBe("eligible");
    expect(snap.reasonToContact).toBeDefined();
    expect(snap.people).toEqual([]);
    expect(snap.tenantId).toBe(tenantId);
  });

  it("uses a factory-built OpenAI adapter when one is injected (Step 8)", async () => {
    const tenantId = await seedTenant();
    // Simulate route-level wiring: the route resolves the tenant's llm_config,
    // builds an OpenAI adapter via the factory with an injected fake fetch,
    // wraps it with rate-limiter + observability, and passes the resulting
    // adapter into the assembler. The assembler uses it verbatim (it does
    // not care whether the adapter is mock or real).
    const { createLlmAdapter, wrapWithGuards } = await import("../../adapters/llm/factory");
    const { RateLimiter } = await import("../../lib/rate-limiter");
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Factory-built OpenAI said hi." } }],
          usage: { prompt_tokens: 7, completion_tokens: 4 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const inner = createLlmAdapter(
      { provider: "openai", model: "gpt-4o-mini", apiKeyRef: "sk-test" },
      { fetch: fakeFetch },
    );
    const llmAdapter = wrapWithGuards(inner, {
      tenantId,
      correlationId: "corr-step8",
      rateLimiter: new RateLimiter(),
    });

    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: createMockSignalAdapter({ fixture: "strong" }),
        llmAdapter,
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-openai" },
    );

    expect(snap.eligibilityState).toBe("eligible");
    expect(snap.reasonToContact).toBe("Factory-built OpenAI said hi.");
  });

  it("falls back to template reason when no llmAdapter is supplied (route fallback path)", async () => {
    const tenantId = await seedTenant();
    // Mirrors the route's "no llm_config row" path where resolveLlmAdapter
    // would have returned the mock adapter. Here we omit it entirely to
    // exercise the reason-generator's template-only branch — Slice 3 Step 14
    // seeds a real LLM row for every tenant and this fallback goes away.
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: createMockSignalAdapter({ fixture: "strong" }),
        // no llmAdapter
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-fallback" },
    );

    expect(snap.eligibilityState).toBe("eligible");
    expect(snap.reasonToContact).toBeDefined();
    // Template shape: "<source> reported: <content>". No LLM rewrite.
    expect(snap.reasonToContact ?? "").toMatch(/ reported: /);
    expect(snap.tenantId).toBe(tenantId);
  });

  it("uses a factory-built Exa signal adapter when one is injected (Step 9)", async () => {
    const tenantId = await seedTenant();
    // Simulate route-level wiring: the route resolves the tenant's
    // provider_config (name='exa'), builds an Exa adapter via the signal
    // factory with an injected fake fetch, wraps it with rate-limiter +
    // observability, and passes the resulting adapter into the assembler.
    // The assembler uses it verbatim.
    const { createSignalAdapter, wrapSignalWithGuards } = await import(
      "../../adapters/signal/factory"
    );
    const { RateLimiter } = await import("../../lib/rate-limiter");
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          requestId: "cassette-step9",
          results: [
            {
              id: "https://example.com/acme-funding",
              url: "https://example.com/acme-funding",
              title: "Acme raises Series C",
              publishedDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
              text: "Acme announced a Series C funding round led by Notable Ventures.",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const inner = createSignalAdapter(
      {
        name: "exa",
        enabled: true,
        apiKeyRef: "exa-test-key",
        thresholds: THRESHOLDS,
      },
      { fetch: fakeFetch },
    );
    const providerAdapter = wrapSignalWithGuards(inner, {
      tenantId,
      correlationId: "corr-step9",
      rateLimiter: new RateLimiter(),
    });

    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter,
        llmAdapter: createMockLlmAdapter(),
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-exa" },
    );

    expect(snap.eligibilityState).toBe("eligible");
    expect(snap.evidence.length).toBe(1);
    // Evidence round-trips from the Exa cassette-shaped response, stamped
    // with the caller tenantId (cross-tenant isolation check).
    expect(snap.evidence[0]?.tenantId).toBe(tenantId);
    expect(snap.evidence[0]?.source).toBe("example.com");
    expect(snap.evidence[0]?.content).toMatch(/Acme/);
    expect(snap.reasonToContact).toBeDefined();
  });

  it("never leaks tenantId — uses caller arg, never anything else", async () => {
    const tenantId = await seedTenant();
    // A signal adapter whose internal fixture uses a different tenantId baked in
    // should still return rows stamped with the caller's tenantId because the
    // mock adapter always overrides. Assembler must preserve that.
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: createMockSignalAdapter({ fixture: "strong" }),
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-iso" },
    );
    for (const ev of snap.evidence) {
      expect(ev.tenantId).toBe(tenantId);
    }
  });

  it("hygiene pipeline: dedup + staleness + block-list produce final survivor set with stale flag", async () => {
    const tenantId = await seedTenant();
    const DAY_MS = 24 * 60 * 60 * 1000;
    const now = new Date();
    // Build a mixed batch:
    //   - A: fresh, kept
    //   - B: dup of A (same id + content after prefix-strip) — drops
    //   - C: stale (far outside freshnessMaxDays) — drops; sets stale flag
    //   - D: fresh but blocked-domain — drops
    //   - E: fresh, kept
    const evA: Evidence = createEvidence(tenantId, {
      id: "exa:https://good.com/a",
      source: "good.com",
      confidence: 0.9,
      content: "signal A content",
      timestamp: new Date(now.getTime() - 2 * DAY_MS),
      isRestricted: false,
    });
    const evB: Evidence = createEvidence(tenantId, {
      id: "news:https://good.com/a",
      source: "good.com",
      confidence: 0.9,
      content: "signal A content", // identical content → dedup with A
      timestamp: new Date(now.getTime() - 1 * DAY_MS),
      isRestricted: false,
    });
    const evC: Evidence = createEvidence(tenantId, {
      id: "exa:https://good.com/c-stale",
      source: "good.com",
      confidence: 0.9,
      content: "aged signal",
      timestamp: new Date(now.getTime() - 200 * DAY_MS),
      isRestricted: false,
    });
    const evD: Evidence = createEvidence(tenantId, {
      id: "exa:https://bad.example.com/d",
      source: "bad.example.com",
      confidence: 0.9,
      content: "blocked signal",
      timestamp: new Date(now.getTime() - 1 * DAY_MS),
      isRestricted: false,
    });
    const evE: Evidence = createEvidence(tenantId, {
      id: "exa:https://good.com/e",
      source: "good.com",
      confidence: 0.9,
      content: "signal E content",
      timestamp: new Date(now.getTime() - 3 * DAY_MS),
      isRestricted: false,
    });
    const stubAdapter: ProviderAdapter = {
      name: "stub-hygiene",
      async fetchSignals() {
        return [evA, evB, evC, evD, evE];
      },
    };
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: stubAdapter,
        llmAdapter: createMockLlmAdapter(),
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
        blockList: ["bad.example.com"],
      },
      { tenantId, companyId: "co-hygiene" },
    );
    // A, C (stale-but-kept per Slice 1 contract), and E survive. B is
    // deduped (cross-provider dup of A). D is blocked by block-list.
    // The `stale` flag fires because C is past the freshness threshold.
    expect(snap.evidence.map((e) => e.id).sort()).toEqual([
      "exa:https://good.com/a",
      "exa:https://good.com/c-stale",
      "exa:https://good.com/e",
    ]);
    expect(snap.stateFlags.stale).toBe(true);
    expect(snap.stateFlags.restricted).toBe(false);
    // D must be entirely gone — blocked domains leave no trace.
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain("bad.example.com");
    expect(serialized).not.toContain("blocked signal");
  });

  it("restricted state zero-leak holds with hygiene pipeline active", async () => {
    const tenantId = await seedTenant();
    // Signal batch has 10 rows, one of which is restricted. Assembler must
    // short-circuit BEFORE dedup so no restricted metadata leaks into the
    // hygiene stages or the final snapshot. Only `restricted=true` flag.
    const now = new Date();
    const rows: Evidence[] = [];
    for (let i = 0; i < 9; i++) {
      rows.push(
        createEvidence(tenantId, {
          id: `exa:https://site.com/${i}`,
          source: "site.com",
          confidence: 0.9,
          content: `content ${i}`,
          timestamp: now,
          isRestricted: false,
        }),
      );
    }
    rows.push(
      createEvidence(tenantId, {
        id: "exa:https://restricted.example/secret",
        source: "restricted.example",
        confidence: 0.9,
        content: "SECRET_PAYLOAD",
        timestamp: now,
        isRestricted: true,
      }),
    );
    const stubAdapter: ProviderAdapter = {
      name: "stub-restricted",
      async fetchSignals() {
        return rows;
      },
    };
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: stubAdapter,
        llmAdapter: createMockLlmAdapter(),
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-restricted" },
    );
    expect(snap.stateFlags.restricted).toBe(true);
    expect(snap.evidence).toEqual([]);
    expect(snap.people).toEqual([]);
    expect(snap.reasonToContact).toBeUndefined();
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain("SECRET_PAYLOAD");
    expect(serialized).not.toContain("restricted.example");
  });

  it("populates nextMove on eligible path when a real (non-mock) LLM adapter is wired (Step 13)", async () => {
    const tenantId = await seedTenant();
    const { createLlmAdapter, wrapWithGuards } = await import("../../adapters/llm/factory");
    const { RateLimiter } = await import("../../lib/rate-limiter");
    // Step 13 makes TWO LLM calls: (1) reason rewrite, (2) next-move.
    // The fake fetch returns a distinct payload on each call so we can
    // assert both end up in the snapshot.
    let call = 0;
    const fakeFetch: typeof fetch = async () => {
      call += 1;
      const content =
        call === 1
          ? "Reason rewritten by LLM."
          : "Draft an intro email referencing the funding round.";
      return new Response(
        JSON.stringify({
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 7, completion_tokens: 4 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const inner = createLlmAdapter(
      { provider: "openai", model: "gpt-4o-mini", apiKeyRef: "sk-test" },
      { fetch: fakeFetch },
    );
    const llmAdapter = wrapWithGuards(inner, {
      tenantId,
      correlationId: "corr-step13",
      rateLimiter: new RateLimiter(),
    });

    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: createMockSignalAdapter({ fixture: "strong" }),
        llmAdapter,
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
        correlationId: "corr-step13",
      },
      { tenantId, companyId: "co-nextmove" },
    );

    expect(snap.eligibilityState).toBe("eligible");
    expect(snap.reasonToContact).toBe("Reason rewritten by LLM.");
    expect(snap.nextMove).toBe("Draft an intro email referencing the funding round.");
  });

  it("skips nextMove when the adapter is the mock fallback (cost-saving, Step 13)", async () => {
    const tenantId = await seedTenant();
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: createMockSignalAdapter({ fixture: "strong" }),
        llmAdapter: createMockLlmAdapter(),
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-nextmove-mock" },
    );
    expect(snap.eligibilityState).toBe("eligible");
    expect(snap.nextMove).toBeUndefined();
  });

  it("restricted snapshot never carries a nextMove (Step 13 zero-leak)", async () => {
    const tenantId = await seedTenant();
    // Real-ish LLM adapter is wired but the restricted short-circuit runs
    // before any LLM stage, so no fetch is actually invoked. The
    // assertion we care about is that `nextMove` is absent from the
    // serialized snapshot payload.
    const { createLlmAdapter, wrapWithGuards } = await import("../../adapters/llm/factory");
    const { RateLimiter } = await import("../../lib/rate-limiter");
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "SHOULD NOT APPEAR" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const inner = createLlmAdapter(
      { provider: "openai", model: "gpt-4o-mini", apiKeyRef: "sk-test" },
      { fetch: fakeFetch },
    );
    const llmAdapter = wrapWithGuards(inner, {
      tenantId,
      rateLimiter: new RateLimiter(),
    });

    const restrictedRow: Evidence = createEvidence(tenantId, {
      id: "exa:https://restricted.example/secret",
      source: "restricted.example",
      confidence: 0.9,
      content: "SHOULD_NOT_LEAK",
      timestamp: new Date(),
      isRestricted: true,
    });
    const stub: ProviderAdapter = {
      name: "stub-restricted-nextmove",
      async fetchSignals() {
        return [restrictedRow];
      },
    };
    const snap = await assembleSnapshot(
      {
        db,
        providerAdapter: stub,
        llmAdapter,
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-restricted-nextmove" },
    );
    expect(snap.stateFlags.restricted).toBe(true);
    expect(snap.nextMove).toBeUndefined();
    expect(JSON.stringify(snap)).not.toContain("SHOULD NOT APPEAR");
  });

  it("passes structured company context to the provider adapter", async () => {
    const tenantId = await seedTenant();
    const calls: Array<{ tenantId: string; company: unknown }> = [];
    const stub: ProviderAdapter = {
      name: "stub-structured-company",
      async fetchSignals(callTenantId, company) {
        calls.push({ tenantId: callTenantId, company });
        return [];
      },
    };

    await assembleSnapshot(
      {
        db,
        providerAdapter: stub,
        llmAdapter: createMockLlmAdapter(),
        propertyFetcher: ELIGIBLE,
        contactFetcher: threeContacts,
        thresholds: THRESHOLDS,
      },
      { tenantId, companyId: "co-structured" },
    );

    expect(calls).toEqual([
      {
        tenantId,
        company: {
          companyId: "co-structured",
        },
      },
    ]);
  });
});
