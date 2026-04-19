import type { SettingsResponse, SettingsSignalProviderName, SettingsUpdate } from "@hap/config";
import { z } from "zod";
import { llmProviderTypeSchema, thresholdConfigSchema } from "./snapshot";

function preserveBlankSecret(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const settingsSignalProviderNameSchema = z.enum([
  "exa",
  "hubspot-enrichment",
]) satisfies z.ZodType<SettingsSignalProviderName>;

export const settingsProviderStateSchema = z
  .object({
    enabled: z.boolean(),
    hasApiKey: z.boolean(),
  })
  .strict();

export const settingsResponseSchema = z
  .object({
    tenantId: z.string().min(1),
    signalProviders: z
      .object({
        exa: settingsProviderStateSchema,
        hubspotEnrichment: settingsProviderStateSchema,
      })
      .strict(),
    llm: z
      .object({
        provider: llmProviderTypeSchema.nullable(),
        model: z.string(),
        endpointUrl: z.string().url().optional(),
        hasApiKey: z.boolean(),
      })
      .strict(),
    eligibility: z
      .object({
        propertyName: z.string().min(1),
      })
      .strict(),
    thresholds: thresholdConfigSchema,
  })
  .strict() satisfies z.ZodType<SettingsResponse>;

const providerUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    apiKey: z.preprocess(preserveBlankSecret, z.string().min(1).optional()),
    clearApiKey: z.boolean().optional(),
  })
  .strict()
  .refine((value) => !(value.clearApiKey && value.apiKey), {
    message: "clearApiKey cannot be combined with apiKey",
    path: ["clearApiKey"],
  });

// HubSpot enrichment is OAuth-backed. Its update leaf must NOT accept
// `apiKey` / `clearApiKey` — the previous UI field was cosmetic and
// misleading. `.strict()` makes any stray `apiKey` submission fail with 400.
const hubspotEnrichmentUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .strict();

const llmUpdateSchema = z
  .object({
    provider: llmProviderTypeSchema.nullable().optional(),
    model: z.string().min(1).optional(),
    endpointUrl: z.preprocess(preserveBlankSecret, z.string().url().optional()),
    apiKey: z.preprocess(preserveBlankSecret, z.string().min(1).optional()),
    clearApiKey: z.boolean().optional(),
  })
  .strict()
  .refine((value) => !(value.clearApiKey && value.apiKey), {
    message: "clearApiKey cannot be combined with apiKey",
    path: ["clearApiKey"],
  });

export const settingsUpdateSchema = z
  .object({
    signalProviders: z
      .object({
        exa: providerUpdateSchema.optional(),
        hubspotEnrichment: hubspotEnrichmentUpdateSchema.optional(),
      })
      .strict()
      .optional(),
    llm: llmUpdateSchema.optional(),
    eligibility: z
      .object({
        propertyName: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    thresholds: thresholdConfigSchema.partial().optional(),
  })
  .strict() satisfies z.ZodType<SettingsUpdate>;
