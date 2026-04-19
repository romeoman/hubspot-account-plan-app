/**
 * Public surface of `@hap/config`.
 *
 * Consumers: `@hap/api`, `@hap/hubspot-extension`, `@hap/validators`, tests.
 *
 * - `domain-types`: wire-level types (Snapshot, Evidence, Person, StateFlags,
 *   EligibilityState, ThresholdConfig, ProviderConfig, LlmProviderConfig,
 *   LlmProviderType, TenantSettings, TenantConfig).
 * - `factories`: tenant-aware constructors + 8 distinct QA fixtures.
 */
export * from "./domain-types";
export * from "./env";
export * from "./factories";
export * from "./llm-catalog";
