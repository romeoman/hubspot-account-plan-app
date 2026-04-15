import {
  createEvidence,
  createPerson,
  createSnapshot,
  fixtureDegraded,
  fixtureEligibleStrong,
  fixtureEmpty,
  fixtureFewerContacts,
  fixtureIneligible,
  fixtureLowConfidence,
  fixtureRestricted,
  fixtureStale,
} from "@hap/config";
import { describe, expect, it } from "vitest";
import {
  evidenceSchema,
  llmProviderConfigSchema,
  personSchema,
  providerConfigSchema,
  snapshotSchema,
  stateFlagsSchema,
  tenantConfigSchema,
  tenantSettingsSchema,
  thresholdConfigSchema,
} from "../snapshot";

const TENANT = "tenant-validator-test";

describe("zod schemas validate factory output", () => {
  it("validates createEvidence", () => {
    expect(evidenceSchema.safeParse(createEvidence(TENANT)).success).toBe(true);
  });

  it("validates createPerson", () => {
    expect(personSchema.safeParse(createPerson()).success).toBe(true);
  });

  it("validates createSnapshot", () => {
    expect(snapshotSchema.safeParse(createSnapshot(TENANT)).success).toBe(true);
  });

  it("validates all 8 fixtures", () => {
    const fixtures = [
      fixtureEligibleStrong(TENANT),
      fixtureFewerContacts(TENANT),
      fixtureEmpty(TENANT),
      fixtureStale(TENANT),
      fixtureDegraded(TENANT),
      fixtureLowConfidence(TENANT),
      fixtureIneligible(TENANT),
      fixtureRestricted(TENANT),
    ];
    for (const f of fixtures) {
      const result = snapshotSchema.safeParse(f);
      if (!result.success) {
        throw new Error(
          `Fixture for ${f.companyId} failed: ${JSON.stringify(result.error.issues)}`,
        );
      }
    }
  });
});

describe("zod rejects malformed inputs", () => {
  it("rejects snapshot missing tenantId", () => {
    const snap = createSnapshot(TENANT) as Record<string, unknown>;
    const { tenantId: _drop, ...broken } = snap;
    expect(snapshotSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects evidence with out-of-range confidence", () => {
    const ev = { ...createEvidence(TENANT), confidence: 1.5 };
    expect(evidenceSchema.safeParse(ev).success).toBe(false);
  });

  it("rejects evidence with string timestamp (domain type is Date)", () => {
    const ev = { ...createEvidence(TENANT), timestamp: "2024-01-01" };
    expect(evidenceSchema.safeParse(ev).success).toBe(false);
  });

  it("rejects stateFlags missing a field", () => {
    expect(
      stateFlagsSchema.safeParse({
        stale: false,
        degraded: false,
        lowConfidence: false,
        ineligible: false,
        restricted: false,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown eligibilityState", () => {
    const snap = createSnapshot(TENANT);
    const broken = { ...snap, eligibilityState: "maybe" };
    expect(snapshotSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects unknown LLM provider type", () => {
    expect(
      llmProviderConfigSchema.safeParse({
        provider: "llama",
        model: "foo",
        apiKeyRef: "ref-1",
      }).success,
    ).toBe(false);
  });
});

describe("config schemas", () => {
  it("validates thresholdConfig", () => {
    expect(
      thresholdConfigSchema.safeParse({
        freshnessMaxDays: 30,
        minConfidence: 0.5,
      }).success,
    ).toBe(true);
  });

  it("validates providerConfig", () => {
    expect(
      providerConfigSchema.safeParse({
        name: "exa",
        enabled: true,
        apiKeyRef: "ref-exa",
        thresholds: { freshnessMaxDays: 14, minConfidence: 0.4 },
      }).success,
    ).toBe(true);
  });

  it("validates tenantSettings with optional defaultLlmProvider", () => {
    expect(
      tenantSettingsSchema.safeParse({
        thresholds: { freshnessMaxDays: 14, minConfidence: 0.4 },
        providers: [],
      }).success,
    ).toBe(true);
  });

  it("validates tenantConfig with and without settings", () => {
    expect(
      tenantConfigSchema.safeParse({
        tenantId: "t",
        hubspotPortalId: "p",
      }).success,
    ).toBe(true);
    expect(
      tenantConfigSchema.safeParse({
        tenantId: "t",
        hubspotPortalId: "p",
        settings: {
          thresholds: { freshnessMaxDays: 14, minConfidence: 0.4 },
          providers: [],
        },
      }).success,
    ).toBe(true);
  });
});
