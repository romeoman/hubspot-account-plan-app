import { randomUUID } from "node:crypto";
import { createDatabase, llmConfig, providerConfig, tenants } from "@hap/db";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { InMemoryCacheAdapter } from "../cache-adapter";
import {
  __setCacheAdapterForTests,
  CONFIG_RESOLVER_CACHE_TTL_MS,
  clearConfigResolverCache,
  getLlmConfig,
  getLlmConfigByProvider,
  getProviderConfig,
  invalidateLlmConfig,
  invalidateProviderConfig,
  invalidateTenantConfig,
} from "../config-resolver";
import { encryptProviderKey } from "../encryption";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const db = createDatabase(DATABASE_URL);

const PORTAL_PREFIX = `cfgres-${randomUUID().slice(0, 8)}-`;

function portalId() {
  return `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;
}

async function seedTenant(settings?: Record<string, unknown>) {
  const [row] = await db
    .insert(tenants)
    .values({
      hubspotPortalId: portalId(),
      name: "Test",
      settings: settings ?? {},
    })
    .returning();
  if (!row) throw new Error("failed to seed tenant");
  return row;
}

beforeEach(async () => {
  // Swap in a fresh adapter per test so no state leaks between cases —
  // `clearConfigResolverCache` is still exposed for external callers and is a
  // superset of this reset.
  __setCacheAdapterForTests(new InMemoryCacheAdapter());
  clearConfigResolverCache();
  // FK cascade on providerConfig / llmConfig handles child cleanup.
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

afterAll(async () => {
  clearConfigResolverCache();
});

describe("getProviderConfig", () => {
  it("returns null when no provider row exists for the tenant", async () => {
    const tenant = await seedTenant();
    const res = await getProviderConfig({ db }, { tenantId: tenant.id, providerName: "exa" });
    expect(res).toBeNull();
  });

  it("decrypts api key and maps to ProviderConfig shape", async () => {
    const tenant = await seedTenant();
    const ciphertext = encryptProviderKey(tenant.id, "sk-real-exa-key");
    await db.insert(providerConfig).values({
      tenantId: tenant.id,
      providerName: "exa",
      enabled: true,
      apiKeyEncrypted: ciphertext,
      thresholds: { freshnessMaxDays: 30, minConfidence: 0.5 },
      settings: {},
    });

    const res = await getProviderConfig({ db }, { tenantId: tenant.id, providerName: "exa" });

    expect(res).not.toBeNull();
    expect(res?.name).toBe("exa");
    expect(res?.enabled).toBe(true);
    expect(res?.apiKeyRef).toBe("sk-real-exa-key");
    expect(res?.thresholds.freshnessMaxDays).toBe(30);
    expect(res?.thresholds.minConfidence).toBe(0.5);
  });

  it("returns DEFAULT_THRESHOLDS when the row has empty thresholds jsonb (no zero-coercion)", async () => {
    // Regression for the zero-coercion bug: a tenant with a provider row but
    // no explicit threshold fields used to come back as `{0, 0}` — every
    // signal stale, confidence check disabled. Now defaults win.
    const tenant = await seedTenant();
    await db.insert(providerConfig).values({
      tenantId: tenant.id,
      providerName: "exa",
      enabled: true,
      thresholds: {}, // empty jsonb
      settings: {},
    });

    const res = await getProviderConfig({ db }, { tenantId: tenant.id, providerName: "exa" });
    expect(res?.thresholds.freshnessMaxDays).toBe(30);
    expect(res?.thresholds.minConfidence).toBe(0.5);
  });

  it("merges partial tenant thresholds on top of defaults", async () => {
    // A tenant that sets ONLY freshnessMaxDays still inherits the default
    // minConfidence — not zero.
    const tenant = await seedTenant();
    await db.insert(providerConfig).values({
      tenantId: tenant.id,
      providerName: "exa",
      enabled: true,
      thresholds: { freshnessMaxDays: 7 },
      settings: {},
    });

    const res = await getProviderConfig({ db }, { tenantId: tenant.id, providerName: "exa" });
    expect(res?.thresholds.freshnessMaxDays).toBe(7);
    expect(res?.thresholds.minConfidence).toBe(0.5);
  });

  it("caches within TTL (no second DB query)", async () => {
    const tenant = await seedTenant();
    const ciphertext = encryptProviderKey(tenant.id, "sk-cached");
    await db.insert(providerConfig).values({
      tenantId: tenant.id,
      providerName: "exa",
      enabled: true,
      apiKeyEncrypted: ciphertext,
      thresholds: {},
      settings: {},
    });

    // Real db for the first call (populates the cache).
    const first = await getProviderConfig({ db }, { tenantId: tenant.id, providerName: "exa" });
    expect(first).not.toBeNull();

    // Second call with an exploding proxy that throws on any property access.
    // If the resolver hits the DB, the throw makes the test fail loudly —
    // this is the actual cache assertion.
    const exploding = new Proxy(
      {},
      {
        get() {
          throw new Error("cache miss: db should not be touched");
        },
      },
    ) as unknown as typeof db;

    const second = await getProviderConfig(
      { db: exploding },
      { tenantId: tenant.id, providerName: "exa" },
    );
    expect(second).toEqual(first);
  });

  it("refetches after TTL expiry via injected clock", async () => {
    const tenant = await seedTenant();
    const ciphertext = encryptProviderKey(tenant.id, "sk-expire");
    await db.insert(providerConfig).values({
      tenantId: tenant.id,
      providerName: "exa",
      enabled: true,
      apiKeyEncrypted: ciphertext,
      thresholds: {},
      settings: {},
    });

    let t = 1_000_000;
    const now = () => t;

    const first = await getProviderConfig(
      { db, now },
      { tenantId: tenant.id, providerName: "exa" },
    );
    expect(first?.apiKeyRef).toBe("sk-expire");

    // Advance past TTL.
    t += CONFIG_RESOLVER_CACHE_TTL_MS + 1;

    // Delete THIS tenant's row only. An unscoped delete would race with
    // parallel test files that seed their own provider_config rows.
    await db.delete(providerConfig).where(eq(providerConfig.tenantId, tenant.id));

    const second = await getProviderConfig(
      { db, now },
      { tenantId: tenant.id, providerName: "exa" },
    );
    expect(second).toBeNull();
  });

  it("isolates cache per tenant (no cross-tenant leak)", async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();
    const ctA = encryptProviderKey(tenantA.id, "sk-A");
    const ctB = encryptProviderKey(tenantB.id, "sk-B");

    await db.insert(providerConfig).values([
      {
        tenantId: tenantA.id,
        providerName: "exa",
        enabled: true,
        apiKeyEncrypted: ctA,
        thresholds: {},
        settings: {},
      },
      {
        tenantId: tenantB.id,
        providerName: "exa",
        enabled: false,
        apiKeyEncrypted: ctB,
        thresholds: {},
        settings: {},
      },
    ]);

    const resA = await getProviderConfig({ db }, { tenantId: tenantA.id, providerName: "exa" });
    const resB = await getProviderConfig({ db }, { tenantId: tenantB.id, providerName: "exa" });

    expect(resA?.apiKeyRef).toBe("sk-A");
    expect(resA?.enabled).toBe(true);
    expect(resB?.apiKeyRef).toBe("sk-B");
    expect(resB?.enabled).toBe(false);
  });
});

describe("getLlmConfig", () => {
  it("returns null when no llm_config row exists", async () => {
    const tenant = await seedTenant();
    const res = await getLlmConfig({ db }, { tenantId: tenant.id });
    expect(res).toBeNull();
  });

  it("decrypts api key and maps to LlmProviderConfig shape", async () => {
    const tenant = await seedTenant();
    const ct = encryptProviderKey(tenant.id, "sk-anthropic");
    await db.insert(llmConfig).values({
      tenantId: tenant.id,
      providerName: "anthropic",
      modelName: "claude-3-5-sonnet",
      apiKeyEncrypted: ct,
      endpointUrl: null,
      settings: {},
    });

    const res = await getLlmConfig({ db }, { tenantId: tenant.id });
    expect(res).not.toBeNull();
    expect(res?.provider).toBe("anthropic");
    expect(res?.model).toBe("claude-3-5-sonnet");
    expect(res?.apiKeyRef).toBe("sk-anthropic");
    expect(res?.endpointUrl).toBeUndefined();
  });

  it("respects tenant.settings.defaultLlmProvider when multiple rows exist", async () => {
    const tenant = await seedTenant({ defaultLlmProvider: "openai" });
    const ctA = encryptProviderKey(tenant.id, "sk-anthropic");
    const ctO = encryptProviderKey(tenant.id, "sk-openai");
    await db.insert(llmConfig).values([
      {
        tenantId: tenant.id,
        providerName: "anthropic",
        modelName: "claude-3-5-sonnet",
        apiKeyEncrypted: ctA,
        settings: {},
      },
      {
        tenantId: tenant.id,
        providerName: "openai",
        modelName: "gpt-4o",
        apiKeyEncrypted: ctO,
        settings: {},
      },
    ]);

    const res = await getLlmConfig({ db }, { tenantId: tenant.id });
    expect(res?.provider).toBe("openai");
    expect(res?.model).toBe("gpt-4o");
    expect(res?.apiKeyRef).toBe("sk-openai");
  });

  it("falls back to first row when defaultLlmProvider is unset", async () => {
    const tenant = await seedTenant();
    const ct = encryptProviderKey(tenant.id, "sk-first");
    await db.insert(llmConfig).values({
      tenantId: tenant.id,
      providerName: "gemini",
      modelName: "gemini-1.5-pro",
      apiKeyEncrypted: ct,
      settings: {},
    });

    const res = await getLlmConfig({ db }, { tenantId: tenant.id });
    expect(res?.provider).toBe("gemini");
  });

  it("isolates cache per tenant", async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();
    await db.insert(llmConfig).values([
      {
        tenantId: tenantA.id,
        providerName: "anthropic",
        modelName: "claude-a",
        apiKeyEncrypted: encryptProviderKey(tenantA.id, "sk-A"),
        settings: {},
      },
      {
        tenantId: tenantB.id,
        providerName: "openai",
        modelName: "gpt-b",
        apiKeyEncrypted: encryptProviderKey(tenantB.id, "sk-B"),
        settings: {},
      },
    ]);

    const a = await getLlmConfig({ db }, { tenantId: tenantA.id });
    const b = await getLlmConfig({ db }, { tenantId: tenantB.id });
    expect(a?.apiKeyRef).toBe("sk-A");
    expect(b?.apiKeyRef).toBe("sk-B");
    expect(a?.model).toBe("claude-a");
    expect(b?.model).toBe("gpt-b");
  });
});

describe("cache invalidation", () => {
  it("invalidateProviderConfig drops a cached null so a freshly-inserted row is visible", async () => {
    const tenant = await seedTenant();
    const first = await getProviderConfig({ db }, { tenantId: tenant.id, providerName: "exa" });
    expect(first).toBeNull();

    await db.insert(providerConfig).values({
      tenantId: tenant.id,
      providerName: "exa",
      enabled: true,
      thresholds: { freshnessMaxDays: 7, minConfidence: 0.7 },
    });

    // Without invalidation, the cached null is still served.
    const stillCached = await getProviderConfig(
      { db },
      { tenantId: tenant.id, providerName: "exa" },
    );
    expect(stillCached).toBeNull();

    invalidateProviderConfig(tenant.id, "exa");

    const fresh = await getProviderConfig({ db }, { tenantId: tenant.id, providerName: "exa" });
    expect(fresh?.name).toBe("exa");
    expect(fresh?.thresholds.minConfidence).toBe(0.7);
  });

  it("invalidateProviderConfig only drops the targeted (tenant, provider) entry", async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();
    await db.insert(providerConfig).values([
      { tenantId: tenantA.id, providerName: "exa", enabled: true },
      { tenantId: tenantB.id, providerName: "exa", enabled: true },
    ]);

    await getProviderConfig({ db }, { tenantId: tenantA.id, providerName: "exa" });
    await getProviderConfig({ db }, { tenantId: tenantB.id, providerName: "exa" });

    await db
      .update(providerConfig)
      .set({ enabled: false })
      .where(eq(providerConfig.tenantId, tenantA.id));
    invalidateProviderConfig(tenantA.id, "exa");

    const a = await getProviderConfig({ db }, { tenantId: tenantA.id, providerName: "exa" });
    const b = await getProviderConfig({ db }, { tenantId: tenantB.id, providerName: "exa" });
    expect(a?.enabled).toBe(false); // refreshed
    expect(b?.enabled).toBe(true); // still cached, untouched
  });

  it("invalidateLlmConfig drops the cached entry for the tenant", async () => {
    const tenant = await seedTenant();
    expect(await getLlmConfig({ db }, { tenantId: tenant.id })).toBeNull();

    await db.insert(llmConfig).values({
      tenantId: tenant.id,
      providerName: "anthropic",
      modelName: "claude-a",
    });

    expect(await getLlmConfig({ db }, { tenantId: tenant.id })).toBeNull();
    invalidateLlmConfig(tenant.id);
    const fresh = await getLlmConfig({ db }, { tenantId: tenant.id });
    expect(fresh?.provider).toBe("anthropic");
  });
});

describe("getLlmConfigByProvider", () => {
  it("returns the matching row for the tenant + provider", async () => {
    const tenant = await seedTenant();
    await db.insert(llmConfig).values([
      {
        tenantId: tenant.id,
        providerName: "anthropic",
        modelName: "claude-3-5-sonnet",
        apiKeyEncrypted: encryptProviderKey(tenant.id, "sk-ant"),
        settings: {},
      },
      {
        tenantId: tenant.id,
        providerName: "openai",
        modelName: "gpt-4o",
        apiKeyEncrypted: encryptProviderKey(tenant.id, "sk-oai"),
        settings: {},
      },
    ]);

    const res = await getLlmConfigByProvider({ db }, { tenantId: tenant.id, provider: "openai" });
    expect(res?.provider).toBe("openai");
    expect(res?.model).toBe("gpt-4o");
    expect(res?.apiKeyRef).toBe("sk-oai");
  });

  it("returns null when no row matches that tenant + provider", async () => {
    const tenant = await seedTenant();
    await db.insert(llmConfig).values({
      tenantId: tenant.id,
      providerName: "anthropic",
      modelName: "claude-3-5-sonnet",
      apiKeyEncrypted: encryptProviderKey(tenant.id, "sk-ant"),
      settings: {},
    });

    const res = await getLlmConfigByProvider({ db }, { tenantId: tenant.id, provider: "openai" });
    expect(res).toBeNull();
  });

  it("caches within TTL (delete-then-read still returns the cached value)", async () => {
    const tenant = await seedTenant();
    await db.insert(llmConfig).values({
      tenantId: tenant.id,
      providerName: "gemini",
      modelName: "gemini-1.5-pro",
      apiKeyEncrypted: encryptProviderKey(tenant.id, "sk-gem"),
      settings: {},
    });

    const first = await getLlmConfigByProvider({ db }, { tenantId: tenant.id, provider: "gemini" });
    expect(first?.apiKeyRef).toBe("sk-gem");

    // Delete the row — a cache miss would now return null. A cache HIT
    // returns the cached value unchanged.
    await db.delete(llmConfig).where(eq(llmConfig.tenantId, tenant.id));

    const second = await getLlmConfigByProvider(
      { db },
      { tenantId: tenant.id, provider: "gemini" },
    );
    expect(second?.apiKeyRef).toBe("sk-gem");
  });

  it("refetches after TTL expiry via injected clock", async () => {
    const tenant = await seedTenant();
    await db.insert(llmConfig).values({
      tenantId: tenant.id,
      providerName: "gemini",
      modelName: "gemini-1.5-pro",
      apiKeyEncrypted: encryptProviderKey(tenant.id, "sk-gem"),
      settings: {},
    });

    let t = 1_000_000;
    const now = () => t;

    const first = await getLlmConfigByProvider(
      { db, now },
      { tenantId: tenant.id, provider: "gemini" },
    );
    expect(first?.apiKeyRef).toBe("sk-gem");

    t += CONFIG_RESOLVER_CACHE_TTL_MS + 1;
    await db.delete(llmConfig).where(eq(llmConfig.tenantId, tenant.id));

    const second = await getLlmConfigByProvider(
      { db, now },
      { tenantId: tenant.id, provider: "gemini" },
    );
    expect(second).toBeNull();
  });
});

describe("invalidateTenantConfig", () => {
  it("flushes one tenant's cache entries but leaves other tenants untouched", async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();
    await db.insert(providerConfig).values([
      { tenantId: tenantA.id, providerName: "exa", enabled: true },
      { tenantId: tenantB.id, providerName: "exa", enabled: true },
    ]);
    await db.insert(llmConfig).values([
      {
        tenantId: tenantA.id,
        providerName: "anthropic",
        modelName: "claude-a",
        apiKeyEncrypted: encryptProviderKey(tenantA.id, "sk-A"),
        settings: {},
      },
      {
        tenantId: tenantB.id,
        providerName: "anthropic",
        modelName: "claude-b",
        apiKeyEncrypted: encryptProviderKey(tenantB.id, "sk-B"),
        settings: {},
      },
    ]);

    // Prime the caches for both tenants.
    await getProviderConfig({ db }, { tenantId: tenantA.id, providerName: "exa" });
    await getProviderConfig({ db }, { tenantId: tenantB.id, providerName: "exa" });
    await getLlmConfig({ db }, { tenantId: tenantA.id });
    await getLlmConfig({ db }, { tenantId: tenantB.id });
    await getLlmConfigByProvider({ db }, { tenantId: tenantA.id, provider: "anthropic" });
    await getLlmConfigByProvider({ db }, { tenantId: tenantB.id, provider: "anthropic" });

    // Mutate tenant A's rows under the cache's feet.
    await db
      .update(providerConfig)
      .set({ enabled: false })
      .where(eq(providerConfig.tenantId, tenantA.id));
    await db.delete(llmConfig).where(eq(llmConfig.tenantId, tenantA.id));

    // Tag-flush tenant A only.
    invalidateTenantConfig(tenantA.id);

    // Tenant A: fresh reads observe the mutations.
    const aProv = await getProviderConfig({ db }, { tenantId: tenantA.id, providerName: "exa" });
    const aLlm = await getLlmConfig({ db }, { tenantId: tenantA.id });
    const aByProv = await getLlmConfigByProvider(
      { db },
      { tenantId: tenantA.id, provider: "anthropic" },
    );
    expect(aProv?.enabled).toBe(false);
    expect(aLlm).toBeNull();
    expect(aByProv).toBeNull();

    // Tenant B: still served from cache with the exploding db proxy.
    const exploding = new Proxy(
      {},
      {
        get() {
          throw new Error("tenant B cache was evicted by mistake");
        },
      },
    ) as unknown as typeof db;
    const bProv = await getProviderConfig(
      { db: exploding },
      { tenantId: tenantB.id, providerName: "exa" },
    );
    const bLlm = await getLlmConfig({ db: exploding }, { tenantId: tenantB.id });
    const bByProv = await getLlmConfigByProvider(
      { db: exploding },
      { tenantId: tenantB.id, provider: "anthropic" },
    );
    expect(bProv?.enabled).toBe(true);
    expect(bLlm?.model).toBe("claude-b");
    expect(bByProv?.apiKeyRef).toBe("sk-B");
  });
});

describe("cache return semantics", () => {
  it("mutating a returned config does not poison subsequent reads", async () => {
    const tenant = await seedTenant();
    await db.insert(providerConfig).values({
      tenantId: tenant.id,
      providerName: "exa",
      enabled: true,
      apiKeyEncrypted: encryptProviderKey(tenant.id, "sk-immut"),
      thresholds: { freshnessMaxDays: 10, minConfidence: 0.8 },
      settings: {},
    });

    const first = await getProviderConfig({ db }, { tenantId: tenant.id, providerName: "exa" });
    expect(first?.thresholds.freshnessMaxDays).toBe(10);

    // Try to mutate the returned object. Either it throws (frozen) or the
    // mutation is confined to this copy (clone-on-read). Both satisfy the
    // contract: subsequent reads MUST still see the pristine values.
    try {
      if (first) {
        (first.thresholds as { freshnessMaxDays: number }).freshnessMaxDays = 999;
        (first as { name: string }).name = "tampered";
      }
    } catch {
      // Frozen object — mutation rejected. That's fine.
    }

    const second = await getProviderConfig({ db }, { tenantId: tenant.id, providerName: "exa" });
    expect(second?.thresholds.freshnessMaxDays).toBe(10);
    expect(second?.name).toBe("exa");
  });
});
