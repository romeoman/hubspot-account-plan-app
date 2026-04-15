/**
 * V1 mock signal adapter.
 *
 * Produces Evidence arrays matched to the QA fixture families defined in
 * `@hap/config` (strong, stale, degraded, empty). Used by tests and the
 * snapshot route (via `?state=` fixture selection in Slice 1) to exercise
 * every state-flag branch without hitting real provider endpoints.
 *
 * Real adapters plug into the same {@link ProviderAdapter} interface so the
 * call sites never change. Slice 2 Step 9 ships the factory
 * ({@link ./signal/factory.createSignalAdapter}) + real Exa adapter; HubSpot
 * enrichment and news adapters are scaffolded as Slice 3 deferral stubs. This
 * mock remains as the route-level fallback for tenants that predate the
 * Slice 2 provider_config seed script (Step 14 removes the fallback).
 */

import { createEvidence, type Evidence } from "@hap/config";
import type { ProviderAdapter } from "./provider-adapter";

const DAY_MS = 24 * 60 * 60 * 1000;

export type MockSignalFixture =
  | "strong"
  | "stale"
  | "degraded"
  | "empty"
  | "lowconf"
  | "restricted";

export const MOCK_SIGNAL_FIXTURES: readonly MockSignalFixture[] = [
  "strong",
  "stale",
  "degraded",
  "empty",
  "lowconf",
  "restricted",
];

export function isMockSignalFixture(v: unknown): v is MockSignalFixture {
  return typeof v === "string" && (MOCK_SIGNAL_FIXTURES as readonly string[]).includes(v);
}

export interface MockSignalAdapterOptions {
  fixture?: MockSignalFixture;
}

/**
 * Create a mock {@link ProviderAdapter} that returns Evidence for the chosen
 * fixture family. `tenantId` on every returned row is always the caller's
 * tenantId — NEVER the one baked into the fixture factory — so cross-tenant
 * isolation is guaranteed at this boundary.
 *
 * Each fixture is designed so the trust evaluator (`services/trust.ts`) sets
 * the matching `stateFlags.*` when run against `DEFAULT_THRESHOLDS`.
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
        case "lowconf":
          return buildLowConf(tenantId);
        case "restricted":
          return buildRestricted(tenantId);
      }
    },
  };
}

function buildStrong(tenantId: string): Evidence[] {
  // Use clearly-past timestamps (1-3 days ago) so that if the assembler
  // captures `now` BEFORE the adapter resolves, the evidence is not
  // "future-dated" relative to that snapshot's reference clock.
  // Trust.evaluateFreshness now treats future-dated rows as not-fresh.
  const day = 24 * 60 * 60 * 1000;
  const baseNow = Date.now();
  return [
    createEvidence(tenantId, {
      id: "ev-strong-1",
      source: "hubspot",
      confidence: 0.92,
      content: "Target account flagged with recent engagement.",
      timestamp: new Date(baseNow - 1 * day),
    }),
    createEvidence(tenantId, {
      id: "ev-strong-2",
      source: "news",
      confidence: 0.87,
      content: "Funding round announced this week.",
      timestamp: new Date(baseNow - 3 * day),
    }),
    createEvidence(tenantId, {
      id: "ev-strong-3",
      source: "hubspot",
      confidence: 0.9,
      content: "Email open from champion 2 days ago.",
      timestamp: new Date(baseNow - 2 * day),
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
  // Empty source fails trust.ts `validateSource()` (regex requires a leading
  // alphanumeric), which sets stateFlags.degraded.
  return [
    createEvidence(tenantId, {
      id: "ev-degraded-1",
      source: "",
      confidence: 0.7,
      content: "Partial data: source attribution missing.",
    }),
  ];
}

function buildLowConf(tenantId: string): Evidence[] {
  // All confidences below DEFAULT_THRESHOLDS.minConfidence (0.5) → trust
  // evaluator sets stateFlags.lowConfidence. Past timestamps to avoid the
  // future-dated path on slow adapters.
  const day = 24 * 60 * 60 * 1000;
  const baseNow = Date.now();
  return [
    createEvidence(tenantId, {
      id: "ev-lowconf-1",
      source: "hubspot",
      confidence: 0.3,
      content: "Weak engagement signal.",
      timestamp: new Date(baseNow - 1 * day),
    }),
    createEvidence(tenantId, {
      id: "ev-lowconf-2",
      source: "news",
      confidence: 0.25,
      content: "Tangential mention in industry blog.",
      timestamp: new Date(baseNow - 2 * day),
    }),
  ];
}

function buildRestricted(tenantId: string): Evidence[] {
  // Mixed: one restricted row triggers the zero-leak short-circuit in the
  // assembler regardless of any other rows in the batch.
  const day = 24 * 60 * 60 * 1000;
  const baseNow = Date.now();
  return [
    createEvidence(tenantId, {
      id: "ev-restricted-1",
      source: "internal",
      confidence: 0.95,
      content: "REDACTED — permission-restricted source.",
      timestamp: new Date(baseNow - 1 * day),
      isRestricted: true,
    }),
    createEvidence(tenantId, {
      id: "ev-restricted-2",
      source: "hubspot",
      confidence: 0.88,
      content: "This row would be visible if not for the restricted sibling.",
      timestamp: new Date(baseNow - 1 * day),
    }),
  ];
}
