import { describe, expect, it } from "vitest";
import {
  settingsResponseSchema,
  settingsSignalProviderNameSchema,
  settingsUpdateSchema,
} from "../settings";

describe("settings schemas", () => {
  it("validates a settings response with presence-only secret fields", () => {
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
          news: { enabled: false, hasApiKey: false },
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
