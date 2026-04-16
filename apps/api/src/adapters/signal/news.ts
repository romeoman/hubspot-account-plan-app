/**
 * News signal adapter — Exa news vertical (Slice 3 Task 11).
 *
 * Uses the same Exa search API as the existing Exa adapter but with a
 * news-focused query builder. Decision documented in preflight notes §7:
 * Exa news vertical (no new dependency, reuses EXA_API_KEY infrastructure).
 *
 * Query strategy: `"{companyName} recent news {domain?}"` + `category: "news"`
 * in the request body. Exa's neural search with the news category filter
 * produces recent press coverage, funding rounds, partnership announcements.
 *
 * Security: same rules as ExaAdapter — API key never in error messages,
 * Evidence stamped with caller-supplied tenantId.
 */

import { createEvidence, type Evidence } from "@hap/config";
import type { ProviderAdapter, ProviderCompanyContext } from "../provider-adapter";

export const NEWS_PROVIDER_NAME = "news" as const;

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const DEFAULT_NUM_RESULTS = 5;
const EVIDENCE_CONTENT_MAX_CHARS = 2000;
const EXA_TEXT_MAX_CHARACTERS = 1500;
const NEWS_DEFAULT_CONFIDENCE = 0.65;

export class NewsError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`news adapter request failed (status=${status})`);
    this.name = "NewsError";
    this.status = status;
  }
}

export interface NewsAdapterOptions {
  apiKey: string;
  numResults?: number;
  fetch?: typeof fetch;
}

interface ExaSearchResult {
  id?: string;
  url?: string;
  title?: string;
  publishedDate?: string | null;
  text?: string;
  author?: string | null;
}

interface ExaSearchResponse {
  results?: ExaSearchResult[];
}

function sourceFromUrl(url: string | undefined): string {
  if (!url) return "news";
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.length > 0 ? host : "news";
  } catch {
    return "news";
  }
}

function parseTimestamp(raw: string | null | undefined, fallback: Date): Date {
  if (!raw) return fallback;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function truncate(text: string, cap: number): string {
  return text.length <= cap ? text : text.slice(0, cap);
}

export class NewsAdapter implements ProviderAdapter {
  readonly name = NEWS_PROVIDER_NAME;
  private readonly apiKey: string;
  private readonly numResults: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NewsAdapterOptions) {
    this.apiKey = options.apiKey;
    this.numResults = options.numResults ?? DEFAULT_NUM_RESULTS;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async fetchSignals(tenantId: string, company: ProviderCompanyContext): Promise<Evidence[]> {
    const companyName = company.companyName ?? company.companyId;
    const queryParts = [companyName, "recent news"];
    if (company.domain) queryParts.push(company.domain);
    const query = queryParts.join(" ");

    const body = {
      query,
      numResults: this.numResults,
      category: "news",
      contents: { text: { maxCharacters: EXA_TEXT_MAX_CHARACTERS } },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await this.fetchImpl(EXA_SEARCH_URL, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new NewsError(408);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new NewsError(response.status);
    }

    const json = (await response.json()) as ExaSearchResponse;
    const results = json.results ?? [];
    const now = new Date();

    return results
      .filter(
        (r): r is ExaSearchResult & { text: string } =>
          typeof r.text === "string" && r.text.length > 0,
      )
      .map((r, i) =>
        createEvidence(tenantId, {
          id: r.url ? `news:${r.url}` : `news:result-${i}`,
          source: sourceFromUrl(r.url),
          timestamp: parseTimestamp(r.publishedDate, now),
          confidence: NEWS_DEFAULT_CONFIDENCE,
          content: truncate(r.title ? `${r.title}: ${r.text}` : r.text, EVIDENCE_CONTENT_MAX_CHARS),
          isRestricted: false,
        }),
      );
  }
}
