import { randomUUID } from "node:crypto";
import { createDatabase, tenants } from "@hap/db";
import { like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createMockLlmAdapter } from "../../adapters/mock-llm-adapter";
import { createMockSignalAdapter } from "../../adapters/mock-signal-adapter";
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
});
