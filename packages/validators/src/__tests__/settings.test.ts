import { describe, expect, it } from "vitest";
import {
  settingsResponseSchema,
  settingsSignalProviderNameSchema,
  settingsUpdateSchema,
  testConnectionBodySchema,
  testConnectionResponseSchema,
} from "../settings";

describe("settings schemas", () => {
  it("validates a settings response with presence-only secret fields", () => {
    expect(
      settingsResponseSchema.safeParse({
        tenantId: "tenant-settings",
        signalProviders: {
          exa: { enabled: true, hasApiKey: true },
          hubspotEnrichment: { enabled: true, hasApiKey: false },
        },
        llm: {
          provider: "openai",
          model: "gpt-5.4-mini",
          endpointUrl: undefined,
          hasApiKey: true,
        },
        eligibility: {
          propertyName: "hs_is_target_account",
        },
        thresholds: {
          freshnessMaxDays: 30,
          minConfidence: 0.5,
        },
      }).success,
    ).toBe(true);
  });

  it("rejects plaintext secret leakage in the settings response", () => {
    expect(
      settingsResponseSchema.safeParse({
        tenantId: "tenant-settings",
        signalProviders: {
          exa: { enabled: true, hasApiKey: true, apiKey: "should-not-leak" },
          hubspotEnrichment: { enabled: true, hasApiKey: false },
        },
        llm: {
          provider: "openai",
          model: "gpt-5.4-mini",
          hasApiKey: true,
        },
        eligibility: {
          propertyName: "hs_is_target_account",
        },
        thresholds: {
          freshnessMaxDays: 30,
          minConfidence: 0.5,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects a settings response that includes the legacy 'news' slot", () => {
    expect(
      settingsResponseSchema.safeParse({
        tenantId: "tenant-settings",
        signalProviders: {
          exa: { enabled: true, hasApiKey: true },
          news: { enabled: false, hasApiKey: false },
          hubspotEnrichment: { enabled: true, hasApiKey: false },
        },
        llm: {
          provider: "openai",
          model: "gpt-5.4-mini",
          hasApiKey: true,
        },
        eligibility: { propertyName: "hs_is_target_account" },
        thresholds: { freshnessMaxDays: 30, minConfidence: 0.5 },
      }).success,
    ).toBe(false);
  });

  it("rejects a settings update that targets the legacy 'news' slot", () => {
    expect(
      settingsUpdateSchema.safeParse({
        signalProviders: {
          news: { enabled: true, apiKey: "news-key" },
        },
      }).success,
    ).toBe(false);
  });

  it("rejects a settings update that attaches an apiKey to hubspotEnrichment", () => {
    const result = settingsUpdateSchema.safeParse({
      signalProviders: {
        hubspotEnrichment: { enabled: true, apiKey: "fake-key" },
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a hubspotEnrichment update with just enabled", () => {
    const result = settingsUpdateSchema.safeParse({
      signalProviders: {
        hubspotEnrichment: { enabled: true },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an update payload that rotates a secret", () => {
    expect(
      settingsUpdateSchema.safeParse({
        signalProviders: {
          exa: { enabled: true, apiKey: "exa-key-1" },
        },
        llm: {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          apiKey: "anthropic-key-1",
        },
      }).success,
    ).toBe(true);
  });

  it("treats blank secret fields as preserve-existing rather than explicit delete", () => {
    const result = settingsUpdateSchema.safeParse({
      signalProviders: {
        exa: { enabled: true, apiKey: "" },
      },
      llm: {
        provider: "openai",
        model: "gpt-5.4-mini",
        apiKey: "",
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw result.error;

    expect(result.data.signalProviders?.exa?.apiKey).toBeUndefined();
    expect(result.data.llm?.apiKey).toBeUndefined();
  });

  it("requires explicit delete semantics instead of mixing clearApiKey with a new value", () => {
    expect(
      settingsUpdateSchema.safeParse({
        signalProviders: {
          exa: { apiKey: "new-key", clearApiKey: true },
        },
      }).success,
    ).toBe(false);
  });

  it("validates the supported signal provider names", () => {
    expect(settingsSignalProviderNameSchema.safeParse("exa").success).toBe(true);
    expect(settingsSignalProviderNameSchema.safeParse("hubspot-enrichment").success).toBe(true);
    expect(settingsSignalProviderNameSchema.safeParse("mock-signal").success).toBe(false);
  });
});

describe("testConnectionBodySchema", () => {
  it("rejects payloads missing a target discriminator", () => {
    expect(testConnectionBodySchema.safeParse({ apiKey: "k" }).success).toBe(false);
  });

  it("rejects LLM payloads that set both apiKey and useSavedKey", () => {
    expect(
      testConnectionBodySchema.safeParse({
        target: "llm",
        provider: "openai",
        model: "gpt-5.4",
        apiKey: "sk-draft",
        useSavedKey: true,
      }).success,
    ).toBe(false);
  });

  it("rejects LLM payloads that set neither apiKey nor useSavedKey", () => {
    expect(
      testConnectionBodySchema.safeParse({
        target: "llm",
        provider: "openai",
        model: "gpt-5.4",
      }).success,
    ).toBe(false);
  });

  it("rejects Exa payloads that set both apiKey and useSavedKey", () => {
    expect(
      testConnectionBodySchema.safeParse({
        target: "exa",
        apiKey: "exa-draft",
        useSavedKey: true,
      }).success,
    ).toBe(false);
  });

  it("rejects Exa payloads that set neither apiKey nor useSavedKey", () => {
    expect(testConnectionBodySchema.safeParse({ target: "exa" }).success).toBe(false);
  });

  it("accepts an LLM draft-key payload", () => {
    expect(
      testConnectionBodySchema.safeParse({
        target: "llm",
        provider: "openai",
        model: "gpt-5.4",
        apiKey: "sk-draft",
      }).success,
    ).toBe(true);
  });

  it("accepts an LLM saved-key payload", () => {
    expect(
      testConnectionBodySchema.safeParse({
        target: "llm",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        useSavedKey: true,
      }).success,
    ).toBe(true);
  });

  it("rejects custom LLM payloads that omit endpointUrl", () => {
    expect(
      testConnectionBodySchema.safeParse({
        target: "llm",
        provider: "custom",
        model: "oss-model",
        apiKey: "k",
      }).success,
    ).toBe(false);
  });

  it("rejects custom LLM payloads with a non-HTTPS endpointUrl", () => {
    expect(
      testConnectionBodySchema.safeParse({
        target: "llm",
        provider: "custom",
        model: "oss-model",
        endpointUrl: "http://example.com/v1",
        apiKey: "k",
      }).success,
    ).toBe(false);
  });

  it("accepts custom LLM payloads with an HTTPS endpointUrl", () => {
    expect(
      testConnectionBodySchema.safeParse({
        target: "llm",
        provider: "custom",
        model: "oss-model",
        endpointUrl: "https://api.example.com/v1",
        apiKey: "k",
      }).success,
    ).toBe(true);
  });

  it("rejects stray top-level fields (strict)", () => {
    expect(
      testConnectionBodySchema.safeParse({
        target: "exa",
        apiKey: "k",
        rogue: true,
      }).success,
    ).toBe(false);
  });
});

describe("testConnectionResponseSchema", () => {
  it("accepts the success shape", () => {
    expect(
      testConnectionResponseSchema.safeParse({
        ok: true,
        latencyMs: 123,
        providerEcho: { model: "gpt-5.4" },
      }).success,
    ).toBe(true);
  });

  it("accepts the failure shape", () => {
    expect(
      testConnectionResponseSchema.safeParse({
        ok: false,
        code: "auth",
        message: "invalid key",
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown failure code", () => {
    expect(
      testConnectionResponseSchema.safeParse({
        ok: false,
        code: "teapot",
        message: "nope",
      }).success,
    ).toBe(false);
  });
});
