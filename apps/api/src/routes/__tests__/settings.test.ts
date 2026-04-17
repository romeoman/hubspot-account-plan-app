import { randomUUID } from "node:crypto";
import { createDatabase, llmConfig, providerConfig, tenants } from "@hap/db";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearConfigResolverCache,
  getLlmConfig,
  getProviderConfig,
} from "../../lib/config-resolver";
import { __resetEncryptionCacheForTests } from "../../lib/encryption";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const db = createDatabase(DATABASE_URL);
const PORTAL_PREFIX = `settingroute-${randomUUID().slice(0, 8)}-`;
const ROOT_KEK_BASE64 = Buffer.alloc(32, 9).toString("base64");
let savedRootKek: string | undefined;

function portalId() {
  return `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;
}

async function seedTenant(name = "Settings Route Tenant") {
  const [row] = await db
    .insert(tenants)
    .values({
      hubspotPortalId: portalId(),
      name,
    })
    .returning();
  if (!row) throw new Error("failed to seed tenant");
  return row;
}

async function loadApp() {
  const mod = await import("../../index");
  return mod.default;
}

beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = DATABASE_URL;
  savedRootKek = process.env.ROOT_KEK;
  process.env.ROOT_KEK = ROOT_KEK_BASE64;
  __resetEncryptionCacheForTests();
});

beforeEach(async () => {
  clearConfigResolverCache();
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

afterAll(async () => {
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
  if (savedRootKek !== undefined) {
    process.env.ROOT_KEK = savedRootKek;
  } else {
    delete process.env.ROOT_KEK;
  }
  __resetEncryptionCacheForTests();
});

describe("GET /api/settings", () => {
  it("returns 401 when the resolved tenant is deactivated", async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({
        hubspotPortalId: portalId(),
        name: "Inactive Settings Tenant",
        isActive: false,
        deactivatedAt: new Date("2026-04-17T15:00:00.000Z"),
        deactivationReason: "hubspot_app_uninstalled",
      })
      .returning();
    if (!tenant) throw new Error("failed to seed inactive tenant");

    const app = await loadApp();
    const res = await app.request("/api/settings", {
      method: "GET",
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": tenant.hubspotPortalId,
      },
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe("tenant_inactive");
    expect(body.detail).toBe("tenant is deactivated");
  });

  it("returns the default settings shape for a tenant with no config rows", async () => {
    const tenant = await seedTenant();
    const app = await loadApp();

    const res = await app.request("/api/settings", {
      method: "GET",
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": tenant.hubspotPortalId,
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tenantId: string;
      signalProviders: Record<string, { enabled: boolean; hasApiKey: boolean }>;
      llm: { provider: string | null; model: string; hasApiKey: boolean; endpointUrl?: string };
      eligibility: { propertyName: string };
      thresholds: { freshnessMaxDays: number; minConfidence: number };
    };

    expect(body).toEqual({
      tenantId: tenant.id,
      signalProviders: {
        exa: { enabled: false, hasApiKey: false },
        news: { enabled: false, hasApiKey: false },
        hubspotEnrichment: { enabled: false, hasApiKey: false },
      },
      llm: {
        provider: null,
        model: "",
        hasApiKey: false,
      },
      eligibility: {
        propertyName: "hs_is_target_account",
      },
      thresholds: {
        freshnessMaxDays: 30,
        minConfidence: 0.5,
      },
    });
  });
});

describe("PUT /api/settings", () => {
  it("writes settings and returns a write-only read model", async () => {
    const tenant = await seedTenant();
    const app = await loadApp();

    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": tenant.hubspotPortalId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        signalProviders: {
          exa: { enabled: true, apiKey: "exa-secret-route" },
          news: { enabled: true },
          hubspotEnrichment: { enabled: true },
        },
        llm: {
          provider: "openai",
          model: "gpt-5.4-mini",
          apiKey: "openai-secret-route",
        },
        eligibility: {
          propertyName: "custom_target_property",
        },
        thresholds: {
          freshnessMaxDays: 10,
          minConfidence: 0.7,
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain("exa-secret-route");
    expect(JSON.stringify(body)).not.toContain("openai-secret-route");
    expect(body).toMatchObject({
      tenantId: tenant.id,
      signalProviders: {
        exa: { enabled: true, hasApiKey: true },
        news: { enabled: true, hasApiKey: false },
        hubspotEnrichment: { enabled: true, hasApiKey: false },
      },
      llm: {
        provider: "openai",
        model: "gpt-5.4-mini",
        hasApiKey: true,
      },
      eligibility: {
        propertyName: "custom_target_property",
      },
      thresholds: {
        freshnessMaxDays: 10,
        minConfidence: 0.7,
      },
    });

    const getRes = await app.request("/api/settings", {
      method: "GET",
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": tenant.hubspotPortalId,
      },
    });
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as Record<string, unknown>;
    expect(getBody).toMatchObject(body);
  });

  it("preserves existing encrypted secrets when blank apiKey fields are submitted", async () => {
    const tenant = await seedTenant();
    const app = await loadApp();

    const first = await app.request("/api/settings", {
      method: "PUT",
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": tenant.hubspotPortalId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        signalProviders: {
          exa: { enabled: true, apiKey: "exa-secret-route" },
        },
        llm: {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          apiKey: "anthropic-secret-route",
        },
      }),
    });
    expect(first.status).toBe(200);

    const [beforeExa] = await db
      .select()
      .from(providerConfig)
      .where(and(eq(providerConfig.tenantId, tenant.id), eq(providerConfig.providerName, "exa")));
    const [beforeLlm] = await db
      .select()
      .from(llmConfig)
      .where(and(eq(llmConfig.tenantId, tenant.id), eq(llmConfig.providerName, "anthropic")));

    const second = await app.request("/api/settings", {
      method: "PUT",
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": tenant.hubspotPortalId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        signalProviders: {
          exa: { enabled: false, apiKey: "   " },
        },
        llm: {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          apiKey: "   ",
        },
      }),
    });
    expect(second.status).toBe(200);

    const [afterExa] = await db
      .select()
      .from(providerConfig)
      .where(and(eq(providerConfig.tenantId, tenant.id), eq(providerConfig.providerName, "exa")));
    const [afterLlm] = await db
      .select()
      .from(llmConfig)
      .where(and(eq(llmConfig.tenantId, tenant.id), eq(llmConfig.providerName, "anthropic")));

    expect(afterExa?.enabled).toBe(false);
    expect(afterExa?.apiKeyEncrypted).toBe(beforeExa?.apiKeyEncrypted);
    expect(afterLlm?.apiKeyEncrypted).toBe(beforeLlm?.apiKeyEncrypted);
  });

  it("rejects invalid settings payloads with 400", async () => {
    const tenant = await seedTenant();
    const app = await loadApp();

    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": tenant.hubspotPortalId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        llm: {
          provider: "custom",
          model: "custom-model",
          endpointUrl: "not-a-url",
        },
      }),
    });

    expect(res.status).toBe(400);
  });

  it("keeps tenant writes isolated to the authenticated portal", async () => {
    const tenantA = await seedTenant("Tenant A");
    const tenantB = await seedTenant("Tenant B");
    const app = await loadApp();

    const putRes = await app.request("/api/settings", {
      method: "PUT",
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": tenantA.hubspotPortalId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        signalProviders: {
          exa: { enabled: true },
        },
      }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await app.request("/api/settings", {
      method: "GET",
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": tenantB.hubspotPortalId,
      },
    });
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as {
      tenantId: string;
      signalProviders: { exa: { enabled: boolean; hasApiKey: boolean } };
    };
    expect(body.tenantId).toBe(tenantB.id);
    expect(body.signalProviders.exa).toEqual({ enabled: false, hasApiKey: false });
  });

  it("invalidates cached provider and llm config immediately after settings save", async () => {
    const tenant = await seedTenant();
    const app = await loadApp();

    const initial = await app.request("/api/settings", {
      method: "PUT",
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": tenant.hubspotPortalId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        signalProviders: {
          exa: { enabled: false },
        },
        llm: {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          apiKey: "anthropic-old",
        },
      }),
    });
    expect(initial.status).toBe(200);

    const cachedProvider = await getProviderConfig(
      { db },
      { tenantId: tenant.id, providerName: "exa" },
    );
    const cachedLlm = await getLlmConfig({ db }, { tenantId: tenant.id });
    expect(cachedProvider?.enabled).toBe(false);
    expect(cachedLlm?.provider).toBe("anthropic");
    expect(cachedLlm?.model).toBe("claude-sonnet-4-6");

    const updated = await app.request("/api/settings", {
      method: "PUT",
      headers: {
        Authorization: "Bearer anything",
        "x-test-portal-id": tenant.hubspotPortalId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        signalProviders: {
          exa: { enabled: true, apiKey: "exa-new" },
        },
        llm: {
          provider: "openai",
          model: "gpt-5.4-mini",
          apiKey: "openai-new",
        },
      }),
    });
    expect(updated.status).toBe(200);

    const freshProvider = await getProviderConfig(
      { db },
      { tenantId: tenant.id, providerName: "exa" },
    );
    const freshLlm = await getLlmConfig({ db }, { tenantId: tenant.id });

    expect(freshProvider?.enabled).toBe(true);
    expect(freshProvider?.apiKeyRef).toBe("exa-new");
    expect(freshLlm?.provider).toBe("openai");
    expect(freshLlm?.model).toBe("gpt-5.4-mini");
    expect(freshLlm?.apiKeyRef).toBe("openai-new");
  });
});
