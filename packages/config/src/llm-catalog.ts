/**
 * Curated LLM model catalog, keyed by {@link LlmProviderType}.
 *
 * Source of truth for the model dropdown in the settings UI. The backend
 * still accepts any string model id so customers on fast-moving providers
 * (OpenAI, Anthropic) aren't locked out when a new model ships before we
 * update the catalog. The UI offers an "Other (type manually)" escape hatch
 * that isn't represented in this catalog — it's a UI-only concept.
 *
 * Verification (2026-04-19, primary vendor sources):
 *  - OpenAI: `https://platform.openai.com/docs/models` — current GA text
 *    models are `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`. The `gpt-4o`
 *    family, `gpt-4.1`, plain `gpt-5`, and the `o3`/`o4-mini` reasoning
 *    models were NOT listed as current on the docs page; dropped from the
 *    catalog per the user's "conservative, currently-documented only" rule.
 *  - Anthropic: `https://docs.claude.com/en/docs/about-claude/models/overview`
 *    — current GA is Opus 4.7 / Sonnet 4.6 / Haiku 4.5. Aliases used:
 *    `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5`. Legacy
 *    aliases (`claude-sonnet-4-5`, `claude-opus-4-5`, `claude-opus-4-6`)
 *    remain available per Anthropic's docs but are excluded here to keep
 *    the catalog conservative; users can still select "Other (type
 *    manually)" to enter a legacy alias.
 *  - Gemini: `https://ai.google.dev/gemini-api/docs/models` — 2.5 Pro /
 *    Flash / Flash-Lite are documented GA. Gemini 3.x entries on the docs
 *    page are marked preview and are intentionally excluded.
 *  - OpenRouter: `https://openrouter.ai/api/v1/models` (live JSON) — every
 *    slug below was verified present in the public model list on the
 *    verification date. The previous plan draft included
 *    `minimax/minimax-m2` and `qwen/qwen-3-235b-instruct`; both were NOT
 *    present in the OpenRouter catalog and have been replaced with
 *    currently-listed alternatives (`minimax/minimax-m2.7`, a free-tier
 *    Gemini variant).
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
    { value: "gpt-5.4", label: "GPT-5.4", tier: "premium" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 mini", tier: "standard" },
    { value: "gpt-5.4-nano", label: "GPT-5.4 nano", tier: "standard" },
  ],
  anthropic: [
    { value: "claude-opus-4-7", label: "Claude Opus 4.7", tier: "premium" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", tier: "premium" },
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
      value: "anthropic/claude-opus-4.7",
      label: "Anthropic Claude Opus 4.7",
      tier: "premium",
    },
    {
      value: "anthropic/claude-sonnet-4.6",
      label: "Anthropic Claude Sonnet 4.6",
      tier: "premium",
    },
    { value: "openai/gpt-5.4", label: "OpenAI GPT-5.4", tier: "premium" },
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
    { value: "minimax/minimax-m2.7", label: "MiniMax M2.7", tier: "standard" },
    {
      value: "google/gemini-2.5-flash-lite:free",
      label: "Gemini 2.5 Flash-Lite (free)",
      tier: "free",
    },
    {
      value: "nvidia/nemotron-3-super-120b-a12b:free",
      label: "Nemotron 3 Super 120B (free)",
      tier: "free",
    },
    {
      value: "minimax/minimax-m2.5:free",
      label: "MiniMax M2.5 (free)",
      tier: "free",
    },
  ],
  custom: [],
};
