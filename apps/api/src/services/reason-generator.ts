/**
 * Reason generation service.
 *
 * Two responsibilities:
 *  1. Extract the single "dominant" signal from a pool of Evidence, applying
 *     tenant-configured freshness + confidence thresholds. Returns `null` when
 *     nothing qualifies — callers MUST then render the empty state, never
 *     fabricate a reason.
 *  2. Generate human-readable reason text from the dominant signal. V1 uses a
 *     template that grounds the text in `source` + `content`. An optional
 *     {@link LlmAdapter} may be passed to rewrite the text; on LLM error we
 *     fall back to the template rather than bluff.
 *
 * Honesty rule: if the LLM returns empty or throws, fall back to template.
 * Never invent content that isn't present in the source evidence.
 */

import type { Evidence, ThresholdConfig } from "@hap/config";
import type { LlmAdapter } from "../adapters/llm-adapter.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pick the highest-confidence, still-fresh piece of evidence.
 *
 * Tie-breakers:
 *  - higher `confidence` wins
 *  - on equal confidence, more recent `timestamp` wins
 *
 * Returns `null` when no evidence passes both thresholds.
 */
export function extractDominantSignal(
  signals: Evidence[],
  thresholds: ThresholdConfig,
  now: Date = new Date(),
): Evidence | null {
  const nowMs = now.getTime();
  const maxAgeMs = thresholds.freshnessMaxDays * DAY_MS;

  const qualifying = signals.filter((s) => {
    if (s.confidence < thresholds.minConfidence) return false;
    const ageMs = nowMs - s.timestamp.getTime();
    // Consistent with `trust.evaluateFreshness`: a future-dated row (clock
    // skew or bad upstream data) is NOT fresh. Otherwise the assembler can
    // mark the snapshot stale yet still pick that row as the dominant
    // signal, producing a `reasonToContact` generated from evidence the
    // same pipeline just flagged as untrustworthy.
    if (ageMs < 0) return false;
    if (ageMs > maxAgeMs) return false;
    return true;
  });

  if (qualifying.length === 0) return null;

  return qualifying.reduce((best, cur) => {
    if (cur.confidence > best.confidence) return cur;
    if (cur.confidence === best.confidence && cur.timestamp > best.timestamp) return cur;
    return best;
  });
}

/**
 * Build a template-grounded reason string that references `source` and
 * `content` verbatim. Short, honest, provenance-first.
 */
function templateReason(signal: Evidence): string {
  return `${signal.source} reported: ${signal.content}`;
}

/**
 * Generate reason text for a dominant signal.
 *
 * V1 strategy:
 *  - Always compute the template-grounded fallback first.
 *  - If an `llmAdapter` is supplied, ask it to rewrite; on error or empty
 *    output, return the template.
 *
 * The LLM must never be asked to invent content — the prompt constrains it
 * to rephrase what the evidence already says.
 */
export async function generateReasonText(
  signal: Evidence,
  llmAdapter?: LlmAdapter,
): Promise<string> {
  const fallback = templateReason(signal);
  if (!llmAdapter) return fallback;

  try {
    const prompt = [
      "Rewrite the following single piece of CRM evidence as a short, honest",
      "reason-to-contact sentence. Do not invent facts. Keep it under 160 chars.",
      "",
      `Source: ${signal.source}`,
      `Content: ${signal.content}`,
    ].join("\n");

    const res = await llmAdapter.complete(prompt);
    const trimmed = res.content.trim();
    if (trimmed.length === 0) return fallback;
    return trimmed;
  } catch (err) {
    // Failure must not propagate — falling back to the template is the
    // honest path. Log a stable error class so prod observability can see
    // LLM adapter health drift; never log raw err.message (provider error
    // messages can carry request URLs / api-key context).
    console.warn("reason_generator.llm_adapter_failed", {
      adapter: llmAdapter.provider,
      errorClass: err instanceof Error ? err.constructor.name : typeof err,
    });
    return fallback;
  }
}
