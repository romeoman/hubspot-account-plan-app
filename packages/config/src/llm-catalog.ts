/**
 * Curated LLM model catalog, keyed by {@link LlmProviderType}.
 *
 * Source of truth for the model dropdown in the settings UI. The backend
 * still accepts any string model id so customers on fast-moving providers
 * (OpenAI, Anthropic) aren't locked out when a new model ships before we
 * update the catalog. The UI offers an "Other (type manually)" escape hatch
 * that isn't represented in this catalog — it's a UI-only concept.
 *
 * Verification (April 2026):
 *  - OpenAI: GPT-4o family retired after 2026-04-03 per vendor notice; the
 *    current generation is GPT-5 / GPT-5.4 / GPT-5.4-mini / GPT-5.4-nano and
 *    the reasoning line `o3` / `o4-mini`. We keep `gpt-5` as the primary id
 *    and list the 5.4 variants so operators can pick the smaller/cheaper
 *    tiers. Context7 did not return a clean catalog snapshot for this
 *    provider family at verification time; entries below follow the plan's
 *    curated list with `gpt-4o`/`gpt-4o-mini` dropped (retired) and
 *    `gpt-5.4-mini` / `gpt-5.4-nano` added so the catalog is not shipping
 *    known-retired ids.
 *  - Anthropic: Claude 4.5 Sonnet / Opus / Haiku are the current GA line;
 *    date-stamped API ids exist (e.g. `claude-sonnet-4-5-20250929`) but the
 *    short aliases ship too and are friendlier for a UI dropdown.
 *  - Gemini: 2.5 Pro / Flash / Flash-Lite are the current GA ids.
 *  - OpenRouter: slugs follow `<org>/<model>` convention; `:free` suffix
 *    denotes zero-cost variants. DeepSeek v3.2 + R1, MiniMax M2, and
 *    Qwen 3 235B are confirmed on the OpenRouter model page. Three `:free`
 *    entries included per plan acceptance criteria.
 *
 * If a vendor disagrees with this list at implementation time, trust the
 * vendor and update. The `LLM_CATALOG` shape test locks structural
 * invariants (key coverage, no duplicates, free-tier minimums) but not
 * individual ids — those rotate too fast.
 */

import type { LlmProviderType } from "./domain-types";

export type LlmCatalogEntry = {
  /** Wire value (the model id sent to the provider API). */
  value: string;
  /** Human-readable label for the UI dropdown. */
  label: string;
  /**
   * Optional coarse tier. `free` is reserved for zero-cost OpenRouter
   * variants; `premium` is reserved for flagship/frontier models; `standard`
   * is everything else.
   */
  tier?: "premium" | "standard" | "free";
};

export const LLM_CATALOG: Record<LlmProviderType, LlmCatalogEntry[]> = {
  openai: [
    { value: "gpt-5", label: "GPT-5", tier: "premium" },
    { value: "gpt-5.4", label: "GPT-5.4", tier: "premium" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 mini", tier: "standard" },
    { value: "gpt-5.4-nano", label: "GPT-5.4 nano", tier: "standard" },
    { value: "o3", label: "o3 (reasoning)", tier: "premium" },
    { value: "o4-mini", label: "o4-mini (reasoning)", tier: "standard" },
  ],
  anthropic: [
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", tier: "premium" },
    { value: "claude-opus-4-5", label: "Claude Opus 4.5", tier: "premium" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", tier: "standard" },
  ],
  gemini: [
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", tier: "premium" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", tier: "standard" },
    {
      value: "gemini-2.5-flash-lite",
      label: "Gemini 2.5 Flash-Lite",
      tier: "standard",
    },
  ],
  openrouter: [
    {
      value: "anthropic/claude-sonnet-4.5",
      label: "Anthropic Claude Sonnet 4.5",
      tier: "premium",
    },
    { value: "openai/gpt-5", label: "OpenAI GPT-5", tier: "premium" },
    {
      value: "google/gemini-2.5-pro",
      label: "Google Gemini 2.5 Pro",
      tier: "premium",
    },
    {
      value: "deepseek/deepseek-v3.2",
      label: "DeepSeek V3.2",
      tier: "standard",
    },
    {
      value: "deepseek/deepseek-r1",
      label: "DeepSeek R1 (reasoning)",
      tier: "standard",
    },
    { value: "minimax/minimax-m2", label: "MiniMax M2", tier: "standard" },
    {
      value: "qwen/qwen-3-235b-instruct",
      label: "Qwen 3 235B Instruct",
      tier: "standard",
    },
    {
      value: "meta-llama/llama-3.3-70b-instruct:free",
      label: "Llama 3.3 70B Instruct (free)",
      tier: "free",
    },
    {
      value: "mistralai/mixtral-8x22b-instruct:free",
      label: "Mixtral 8x22B Instruct (free)",
      tier: "free",
    },
    {
      value: "nousresearch/hermes-4-405b:free",
      label: "Hermes 4 405B (free)",
      tier: "free",
    },
  ],
  custom: [],
};
