/**
 * Next-move recommendation service (Slice 2 Step 13).
 *
 * Generates a single-line "recommended next action" for an already-assembled,
 * non-restricted, non-ineligible, non-empty eligible snapshot.
 *
 * ## Zero-leak short-circuit (security boundary)
 *
 * BEFORE any call to `llmAdapter.complete`, this function checks four
 * conditions. If any of them hold the function returns `null` and the LLM
 * adapter is NEVER invoked. A spy test in
 * `__tests__/next-move.test.ts` asserts `complete` was called zero times for
 * each condition — that assertion IS the zero-leak invariant:
 *
 *   1. `snapshot.stateFlags.restricted === true`
 *   2. `snapshot.eligibilityState === "ineligible"` OR
 *      `snapshot.stateFlags.ineligible === true`
 *   3. `snapshot.stateFlags.empty === true`
 *   4. `snapshot.reasonToContact` is absent / empty / whitespace-only
 *
 * Never summarize restricted or ineligible accounts. Never ask an LLM about
 * accounts whose reason-to-contact was suppressed. If evidence is weak,
 * prefer an honest empty state over bluffing.
 *
 * On any LLM error the function returns `null` — next-move is best-effort,
 * not a blocking stage. The wrapped adapter logs the error via the shared
 * observability layer; we do not re-log the raw error here (provider errors
 * can smuggle request URLs or auth material into `Error.message`).
 */

import { MAX_NEXT_MOVE_CHARS, type Snapshot } from "@hap/config";
import type { LlmAdapter } from "../adapters/llm-adapter";

export interface NextMoveDeps {
  /** Post-hygiene, post-suppression snapshot. */
  snapshot: Snapshot;
  /** Already wrapped via `wrapWithGuards` by the caller. */
  llmAdapter: LlmAdapter;
  /** Optional — the wrapped adapter already threads correlation IDs. */
  correlationId?: string;
}

/**
 * Derive the dominant-evidence source + content for the prompt. We pick the
 * highest-confidence non-restricted row. Restricted rows never reach this
 * point (zero-leak short-circuit already returned), but we defensively
 * filter one more time before building the prompt.
 */
function pickDominant(snapshot: Snapshot): { source: string; content: string } | null {
  const safe = snapshot.evidence.filter((e) => e.isRestricted === false);
  if (safe.length === 0) return null;
  const best = safe.reduce((acc, cur) => (cur.confidence > acc.confidence ? cur : acc));
  return { source: best.source, content: best.content };
}

/**
 * Build the next-move prompt. The prompt references ONLY the reason string
 * plus the dominant signal — never the full evidence list, never the
 * contacts, never restricted content.
 */
function buildPrompt(reason: string, dominant: { source: string; content: string } | null): string {
  const lines = [
    "You recommend ONE short next action for a sales or partnerships rep based on a",
    "single reason-to-contact. Reply with ONE sentence, no preamble, no numbering.",
    "Do not invent facts. Keep it under 280 characters.",
    "",
    `Reason: ${reason}`,
  ];
  if (dominant) {
    lines.push(`Dominant signal source: ${dominant.source}`);
    lines.push(`Dominant signal summary: ${dominant.content}`);
  }
  lines.push("", "Recommended next action:");
  return lines.join("\n");
}

/**
 * Generate the next-move string, or null when suppressed / degraded.
 *
 * @see Module docblock for the full zero-leak contract.
 */
export async function generateNextMove(deps: NextMoveDeps): Promise<string | null> {
  const { snapshot, llmAdapter } = deps;

  // --- Zero-leak short-circuit. Runs BEFORE any LLM call. ---
  if (snapshot.stateFlags.restricted === true) return null;
  if (snapshot.eligibilityState === "ineligible" || snapshot.stateFlags.ineligible === true) {
    return null;
  }
  if (snapshot.stateFlags.empty === true) return null;

  const reason =
    typeof snapshot.reasonToContact === "string" ? snapshot.reasonToContact.trim() : "";
  if (reason.length === 0) return null;
  // --- End zero-leak short-circuit. ---

  const dominant = pickDominant(snapshot);
  const prompt = buildPrompt(reason, dominant);

  let raw: string;
  try {
    const res = await llmAdapter.complete(prompt, {
      maxTokens: 100,
      temperature: 0.4,
    });
    raw = res.content;
  } catch {
    // Best-effort: swallow the error. Wrapped adapter already emitted the
    // structured log line + metric; re-logging here would duplicate noise
    // and risk echoing a raw provider error message into shared logs.
    return null;
  }

  const trimmed = raw.replace(/\s+$/u, "");
  if (trimmed.length === 0) return null;
  if (trimmed.length <= MAX_NEXT_MOVE_CHARS) return trimmed;
  return trimmed.slice(0, MAX_NEXT_MOVE_CHARS);
}
