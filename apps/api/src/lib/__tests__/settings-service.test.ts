import { randomUUID } from "node:crypto";
import { createDatabase, llmConfig, providerConfig, tenants } from "@hap/db";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { decryptProviderKey } from "../encryption";
import { readSettings, updateSettings } from "../settings-service";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const db = createDatabase(DATABASE_URL);
const PORTAL_PREFIX = `settingssvc-${randomUUID().slice(0, 8)}-`;

function portalId() {
  return `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;
}

async function seedTenant(settings?: Record<string, unknown>) {
  const [row] = await db
    .insert(tenants)
    .values({
      hubspotPortalId: portalId(),
      name: "Settings Service Tenant",
      settings: settings ?? {},
    })
    .returning();
  if (!row) throw new Error("failed to seed tenant");
  return row;
}

beforeEach(async () => {
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

afterAll(async () => {
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

describe("readSettings", () => {
  it("returns the default settings shape when no config rows exist", async () => {
    const tenant = await seedTenant();

    const settings = await readSettings({ db, tenantId: tenant.id });

    expect(settings).toEqual({
      tenantId: tenant.id,
      signalProviders: {
        exa: { enabled: false, hasApiKey: false },
        news: { enabled: false, hasApiKey: false },
        hubspotEnrichment: { enabled: false, hasApiKey: false },
      },
      llm: {
        provider: null,
        model: "",
        endpointUrl: undefined,
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

describe("updateSettings", () => {
  it("writes encrypted provider and llm keys and reflects them in the read model", async () => {
    const tenant = await seedTenant();

    await updateSettings(
      { db, tenantId: tenant.id },
      {
        signalProviders: {
          exa: { enabled: true, apiKey: "exa-secret-1" },
          news: { enabled: true },
          hubspotEnrichment: { enabled: true },
        },
        llm: {
          provider: "openai",
          model: "gpt-5.4-mini",
          apiKey: "openai-secret-1",
        },
        eligibility: {
          propertyName: "custom_target_property",
        },
        thresholds: {
          freshnessMaxDays: 14,
          minConfidence: 0.4,
        },
      },
    );

    const [exaRow] = await db
      .select()
      .from(providerConfig)
      .where(and(eq(providerConfig.tenantId, tenant.id), eq(providerConfig.providerName, "exa")));
    expect(exaRow?.enabled).toBe(true);
    expect(exaRow?.apiKeyEncrypted).toBeTruthy();
    expect(decryptProviderKey(tenant.id, exaRow?.apiKeyEncrypted ?? "")).toBe("exa-secret-1");

    const [llmRow] = await db
      .select()
      .from(llmConfig)
      .where(and(eq(llmConfig.tenantId, tenant.id), eq(llmConfig.providerName, "openai")));
    expect(llmRow?.modelName).toBe("gpt-5.4-mini");
    expect(llmRow?.apiKeyEncrypted).toBeTruthy();
    expect(decryptProviderKey(tenant.id, llmRow?.apiKeyEncrypted ?? "")).toBe("openai-secret-1");

    const settings = await readSettings({ db, tenantId: tenant.id });
    expect(settings.signalProviders.exa).toEqual({ enabled: true, hasApiKey: true });
    expect(settings.signalProviders.news).toEqual({ enabled: true, hasApiKey: false });
    expect(settings.signalProviders.hubspotEnrichment).toEqual({
      enabled: true,
      hasApiKey: false,
    });
    expect(settings.llm).toEqual({
      provider: "openai",
      model: "gpt-5.4-mini",
      endpointUrl: undefined,
      hasApiKey: true,
    });
    expect(settings.eligibility.propertyName).toBe("custom_target_property");
    expect(settings.thresholds).toEqual({
      freshnessMaxDays: 14,
      minConfidence: 0.4,
    });
  });

  it("preserves existing encrypted secrets when the update omits apiKey", async () => {
    const tenant = await seedTenant();

    await updateSettings(
      { db, tenantId: tenant.id },
      {
        signalProviders: {
          exa: { enabled: true, apiKey: "exa-secret-1" },
        },
        llm: {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          apiKey: "anthropic-secret-1",
        },
      },
    );

    const [beforeExa] = await db
      .select()
      .from(providerConfig)
      .where(and(eq(providerConfig.tenantId, tenant.id), eq(providerConfig.providerName, "exa")));
    const [beforeLlm] = await db
      .select()
      .from(llmConfig)
      .where(and(eq(llmConfig.tenantId, tenant.id), eq(llmConfig.providerName, "anthropic")));

    await updateSettings(
      { db, tenantId: tenant.id },
      {
        signalProviders: {
          exa: { enabled: false },
        },
        llm: {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
        },
      },
    );

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
    expect(decryptProviderKey(tenant.id, afterExa?.apiKeyEncrypted ?? "")).toBe("exa-secret-1");
    expect(decryptProviderKey(tenant.id, afterLlm?.apiKeyEncrypted ?? "")).toBe(
      "anthropic-secret-1",
    );
  });

  it("clears llm configuration when the settings payload disables the llm provider", async () => {
    const tenant = await seedTenant();

    await updateSettings(
      { db, tenantId: tenant.id },
      {
        llm: {
          provider: "openai",
          model: "gpt-5.4-mini",
          apiKey: "openai-secret-1",
        },
      },
    );

    await updateSettings(
      { db, tenantId: tenant.id },
      {
        llm: {
          provider: null,
        },
      },
    );

    const llmRows = await db.select().from(llmConfig).where(eq(llmConfig.tenantId, tenant.id));
    expect(llmRows).toHaveLength(0);

    const settings = await readSettings({ db, tenantId: tenant.id });
    expect(settings.llm).toEqual({
      provider: null,
      model: "",
      endpointUrl: undefined,
      hasApiKey: false,
    });
  });
});
