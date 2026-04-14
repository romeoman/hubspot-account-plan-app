/**
 * Snapshot assembler.
 *
 * Pipeline for V1 (Slice 1):
 *   1. eligibility gate (`checkEligibility`)
 *      - ineligible   → ineligible snapshot, empty people/evidence
 *      - unconfigured → unconfigured snapshot, empty people/evidence
 *   2. fetch signals via the injected {@link ProviderAdapter}
 *   3. extract dominant signal (freshness + confidence thresholds)
 *      - none → eligible + `stateFlags.empty = true`, no reason, no people
 *   4. generate reason text (template; optional LLM rephrase)
 *   5. fetch + rank + select people (0..3, never fabricate)
 *   6. assemble Snapshot with caller tenantId stamped everywhere
 *
 * Step 9 (trust + suppression) will insert an additional stage between 2 and 4.
 * The `// TODO Step 9` comment marks the exact seam so the dependency shape
 * here does not change when that stage lands.
 *
 * Tenant isolation: `tenantId` is ALWAYS sourced from the `args.tenantId`
 * parameter. Adapters / fetchers may not override it — evidence rows are
 * re-stamped via `createSnapshot` if any drift slips through.
 */

import {
  createSnapshot,
  createStateFlags,
  type Evidence,
  type Person,
  type Snapshot,
  type ThresholdConfig,
} from "@hap/config";
import type { Database } from "@hap/db";
import type { LlmAdapter } from "../adapters/llm-adapter";
import type { ProviderAdapter } from "../adapters/provider-adapter";
import { type CompanyPropertyFetcher, checkEligibility } from "./eligibility";
import { type ContactFetcher, fetchContacts, rankContacts, selectPeople } from "./people-selector";
import { extractDominantSignal, generateReasonText } from "./reason-generator";
import { createTrustEvaluator, type TrustEvaluator } from "./trust";

export type AssembleSnapshotDeps = {
  db: Database;
  providerAdapter: ProviderAdapter;
  llmAdapter?: LlmAdapter;
  propertyFetcher: CompanyPropertyFetcher;
  contactFetcher: ContactFetcher;
  thresholds: ThresholdConfig;
  /**
   * Optional trust evaluator. Defaults to `createTrustEvaluator()` when omitted;
   * tests may inject a stub to exercise specific suppression paths.
   */
  trustEvaluator?: TrustEvaluator;
  /** Optional clock override for deterministic tests. */
  now?: Date;
};

export type AssembleSnapshotArgs = {
  tenantId: string;
  companyId: string;
};

export async function assembleSnapshot(
  deps: AssembleSnapshotDeps,
  args: AssembleSnapshotArgs,
): Promise<Snapshot> {
  const { tenantId, companyId } = args;
  const now = deps.now ?? new Date();

  // 1. Eligibility gate.
  const eligibility = await checkEligibility(
    { db: deps.db, fetcher: deps.propertyFetcher },
    { tenantId, companyId },
  );

  if (eligibility.reason === "ineligible") {
    return createSnapshot(tenantId, {
      companyId,
      eligibilityState: "ineligible",
      reasonToContact: undefined,
      people: [],
      evidence: [],
      stateFlags: createStateFlags({ ineligible: true }),
      createdAt: now,
    });
  }

  if (eligibility.reason === "unconfigured") {
    return createSnapshot(tenantId, {
      companyId,
      eligibilityState: "unconfigured",
      reasonToContact: undefined,
      people: [],
      evidence: [],
      stateFlags: createStateFlags(),
      createdAt: now,
    });
  }

  // 2. Fetch signals (eligible path).
  let signals: Evidence[] = [];
  let transportDegraded = false;
  try {
    signals = await deps.providerAdapter.fetchSignals(tenantId, companyId);
  } catch {
    // Transport error → mark degraded; continue with empty signal set.
    transportDegraded = true;
    signals = [];
  }

  // 3. Trust + suppression.
  //    - restricted rows are stripped before any downstream stage sees them.
  //    - stale / low-confidence / degraded-source flags flow into final flags.
  const trust = deps.trustEvaluator ?? createTrustEvaluator();
  const suppression = trust.applySuppression(signals, deps.thresholds, now);

  // Zero-leak: if ANY restricted evidence was present, the response must not
  // contain any evidence, people, reason, or trustScore derived from ANY
  // source in this request. The only signal surfaced is `restricted=true`.
  if (suppression.stateFlags.restricted) {
    return createSnapshot(tenantId, {
      companyId,
      eligibilityState: "eligible",
      reasonToContact: undefined,
      people: [],
      evidence: [],
      stateFlags: createStateFlags({ restricted: true }),
      trustScore: undefined,
      createdAt: now,
    });
  }

  // Merge transport-level degraded flag with source-validation degraded flag.
  const degraded = suppression.stateFlags.degraded || transportDegraded;

  // 4. Dominant signal extraction (from filtered evidence only).
  const dominant = extractDominantSignal(suppression.filteredEvidence, deps.thresholds, now);

  if (!dominant) {
    return createSnapshot(tenantId, {
      companyId,
      eligibilityState: "eligible",
      reasonToContact: undefined,
      people: [],
      evidence: suppression.filteredEvidence,
      stateFlags: createStateFlags({
        empty: true,
        degraded,
        stale: suppression.stateFlags.stale,
        lowConfidence: suppression.stateFlags.lowConfidence,
      }),
      createdAt: now,
    });
  }

  // 5. Reason text.
  const reasonToContact = await generateReasonText(dominant, deps.llmAdapter);

  // 6. Contacts → ranked → selected.
  const contacts = await fetchContacts({ fetcher: deps.contactFetcher }, { tenantId, companyId });
  const ranked = rankContacts(contacts, dominant);
  const people: Person[] = selectPeople(ranked, dominant);

  return createSnapshot(tenantId, {
    companyId,
    eligibilityState: "eligible",
    reasonToContact,
    people,
    evidence: suppression.filteredEvidence,
    stateFlags: createStateFlags({
      degraded,
      stale: suppression.stateFlags.stale,
      lowConfidence: suppression.stateFlags.lowConfidence,
      empty: false,
    }),
    createdAt: now,
  });
}
