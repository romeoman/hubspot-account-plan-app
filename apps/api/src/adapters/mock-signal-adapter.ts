/**
 * V1 mock signal adapter.
 *
 * Produces Evidence arrays matched to the QA fixture families defined in
 * `@hap/config` (strong, stale, degraded, empty). Used by tests and the
 * snapshot route (via `?state=` fixture selection in Slice 1) to exercise
 * every state-flag branch without hitting real provider endpoints.
 *
 * Real adapters (Exa, HubSpot, news, enrichment) are Slice 2 and plug into the
 * same {@link ProviderAdapter} interface so the call sites never change.
 *
 * @todo Slice 2: replace with real adapter factory — one factory per provider
 * that accepts a resolved `ProviderConfig` (including decrypted `apiKeyRef`)
 * and honors tenant-specific thresholds. Do not expand this mock further.
 */

import { createEvidence, type Evidence } from "@hap/config";
import type { ProviderAdapter } from "./provider-adapter";

const DAY_MS = 24 * 60 * 60 * 1000;

export type MockSignalFixture = "strong" | "stale" | "degraded" | "empty";

export interface MockSignalAdapterOptions {
  fixture?: MockSignalFixture;
}

/**
 * Create a mock {@link ProviderAdapter} that returns Evidence for the chosen
 * fixture family. `tenantId` on every returned row is always the caller's
 * tenantId — NEVER the one baked into the fixture factory — so cross-tenant
 * isolation is guaranteed at this boundary.
 *
 * Default fixture: `'strong'`.
 */
export function createMockSignalAdapter(opts: MockSignalAdapterOptions = {}): ProviderAdapter {
  const fixture: MockSignalFixture = opts.fixture ?? "strong";

  return {
    name: "mock-signal",
    async fetchSignals(
      tenantId: string,
      _companyName: string,
      _domain?: string,
    ): Promise<Evidence[]> {
      switch (fixture) {
        case "empty":
          return [];
        case "stale":
          return buildStale(tenantId);
        case "degraded":
          return buildDegraded(tenantId);
        case "strong":
          return buildStrong(tenantId);
      }
    },
  };
}

function buildStrong(tenantId: string): Evidence[] {
  return [
    createEvidence(tenantId, {
      id: "ev-strong-1",
      source: "hubspot",
      confidence: 0.92,
      content: "Target account flagged with recent engagement.",
    }),
    createEvidence(tenantId, {
      id: "ev-strong-2",
      source: "news",
      confidence: 0.87,
      content: "Funding round announced this week.",
    }),
    createEvidence(tenantId, {
      id: "ev-strong-3",
      source: "hubspot",
      confidence: 0.9,
      content: "Email open from champion 2 days ago.",
    }),
  ];
}

function buildStale(tenantId: string): Evidence[] {
  const staleTs = new Date(Date.now() - 120 * DAY_MS);
  return [
    createEvidence(tenantId, {
      id: "ev-stale-1",
      source: "news",
      confidence: 0.85,
      content: "Old partnership announcement.",
      timestamp: staleTs,
    }),
  ];
}

function buildDegraded(tenantId: string): Evidence[] {
  return [
    createEvidence(tenantId, {
      id: "ev-degraded-1",
      source: "hubspot",
      confidence: 0.7,
      content: "Partial data: news adapter timed out.",
    }),
  ];
}
