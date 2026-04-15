/**
 * Provider adapter interface (signals / evidence sources).
 *
 * V1 ships with a single mock implementation ({@link ./mock-signal-adapter})
 * that returns fixture-backed Evidence arrays. Real adapters for Exa, HubSpot
 * enrichment, news sources, etc. land in Slice 2 — see
 * `@todo Slice 2` markers across this file and siblings.
 *
 * Contract expectations for ALL implementations:
 *  - `fetchSignals` MUST tag every returned Evidence with the caller-supplied
 *    `tenantId` so cross-tenant leakage is impossible at this boundary.
 *  - Adapters MUST be config-driven. No hardcoded provider keys, thresholds,
 *    or install-time assumptions live in adapter code — those are resolved via
 *    `config-resolver` using per-tenant `provider_config` rows.
 *
 * @todo Slice 2: add real adapters (Exa, HubSpot enrichment, news). The
 * adapter factory pattern (one factory function per provider, accepting a
 * resolved {@link ProviderConfig}) is locked so the interface does not change.
 */

import type { Evidence } from "@hap/config";

export interface ProviderAdapter {
  /** Stable identifier — used for logging, config lookup, and fixture names. */
  readonly name: string;
  /**
   * Fetch zero or more Evidence rows for the given company.
   *
   * Implementations MUST NOT throw on "no results" — return `[]` instead.
   * Transport errors MAY throw; the caller (signals service in Slice 2)
   * catches and marks the snapshot `degraded`.
   */
  fetchSignals(tenantId: string, companyName: string, domain?: string): Promise<Evidence[]>;
}
