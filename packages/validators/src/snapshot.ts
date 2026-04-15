/**
 * Zod v4 schemas mirroring `@hap/config` domain types.
 *
 * Design decisions:
 * - `timestamp` and `createdAt` are validated as `z.date()` because the
 *   canonical in-process shape is a JS `Date`. On the WIRE (JSON bodies,
 *   DB jsonb) they typically travel as ISO strings; API boundary code is
 *   responsible for the ISO<->Date conversion (e.g., with `z.iso.datetime()`
 *   and a `.transform(s => new Date(s))` at the HTTP boundary). These
 *   schemas validate the already-parsed domain shape.
 * - Schemas are the source of truth for runtime validation; the
 *   compile-time types still live in `@hap/config/domain-types` so that
 *   consumers without zod in scope still see the exact domain shape.
 *   `satisfies` is used to ensure schema/type drift is caught at build.
 *
 * Zod v4 notes (breaking changes vs v3):
 * - `z.record(keySchema, valueSchema)` requires 2 args (keys + values).
 * - `ctx.path` no longer exists inside refinements; use `issue.path` on
 *   raised issues instead. We do not rely on it here.
 * - `ZodType` generics simplified to `ZodType<Output, Input>`.
 */

import {
  type EligibilityState,
  type Evidence,
  type LlmProviderConfig,
  type LlmProviderType,
  MAX_NEXT_MOVE_CHARS,
  type Person,
  type ProviderConfig,
  type Snapshot,
  type StateFlags,
  type TenantConfig,
  type TenantSettings,
  type ThresholdConfig,
} from "@hap/config";
import { z } from "zod";

export const eligibilityStateSchema = z.enum([
  "eligible",
  "ineligible",
  "unconfigured",
]) satisfies z.ZodType<EligibilityState>;

export const stateFlagsSchema = z.object({
  stale: z.boolean(),
  degraded: z.boolean(),
  lowConfidence: z.boolean(),
  ineligible: z.boolean(),
  restricted: z.boolean(),
  empty: z.boolean(),
}) satisfies z.ZodType<StateFlags>;

export const evidenceSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  source: z.string().min(1),
  timestamp: z.date(),
  confidence: z.number().min(0).max(1),
  content: z.string(),
  isRestricted: z.boolean(),
}) satisfies z.ZodType<Evidence>;

export const personSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  title: z.string().optional(),
  reasonToTalk: z.string(),
  evidenceRefs: z.array(z.string()),
}) satisfies z.ZodType<Person>;

export const snapshotSchema = z.object({
  tenantId: z.string().min(1),
  companyId: z.string().min(1),
  eligibilityState: eligibilityStateSchema,
  reasonToContact: z.string().optional(),
  people: z.array(personSchema),
  evidence: z.array(evidenceSchema),
  stateFlags: stateFlagsSchema,
  trustScore: z.number().min(0).max(1).optional(),
  nextMove: z.string().max(MAX_NEXT_MOVE_CHARS).optional(),
  createdAt: z.date(),
}) satisfies z.ZodType<Snapshot>;

export const thresholdConfigSchema = z.object({
  freshnessMaxDays: z.number().int().nonnegative(),
  minConfidence: z.number().min(0).max(1),
}) satisfies z.ZodType<ThresholdConfig>;

export const llmProviderTypeSchema = z.enum([
  "anthropic",
  "openai",
  "gemini",
  "openrouter",
  "custom",
]) satisfies z.ZodType<LlmProviderType>;

export const llmProviderConfigSchema = z.object({
  provider: llmProviderTypeSchema,
  model: z.string().min(1),
  apiKeyRef: z.string().min(1),
  endpointUrl: z.string().url().optional(),
}) satisfies z.ZodType<LlmProviderConfig>;

export const providerConfigSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean(),
  apiKeyRef: z.string().min(1),
  thresholds: thresholdConfigSchema,
  // Slice 2 Step 10 hygiene — per-provider domain allow/block lists stored
  // in `provider_config.{allow_list,block_list}` jsonb columns.
  allowList: z.array(z.string()).optional(),
  blockList: z.array(z.string()).optional(),
}) satisfies z.ZodType<ProviderConfig>;

export const tenantSettingsSchema = z.object({
  defaultLlmProvider: llmProviderTypeSchema.optional(),
  thresholds: thresholdConfigSchema,
  providers: z.array(providerConfigSchema),
}) satisfies z.ZodType<TenantSettings>;

export const tenantConfigSchema = z.object({
  tenantId: z.string().min(1),
  hubspotPortalId: z.string().min(1),
  settings: tenantSettingsSchema.optional(),
}) satisfies z.ZodType<TenantConfig>;
