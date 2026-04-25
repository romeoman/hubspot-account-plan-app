/**
 * Exa search adapter (Slice 2 Step 9).
 *
 * Docs: https://exa.ai/docs/reference/search
 * Retrieval date: 2026-04-15
 *
 * Confirmed shape (verified against the public API reference):
 *  - Endpoint: `POST https://api.exa.ai/search`
 *  - Auth:     `x-api-key: <apiKey>` (Exa also accepts `Authorization: Bearer <key>`,
 *               but we use x-api-key to match the reference's first-class example).
 *  - Request:  `{ query, numResults?, includeDomains?, excludeDomains?, contents? }`
 *              We always request `contents.text` with a bounded `maxCharacters`
 *              so the response payload is predictable and our Evidence.content
 *              cap stays meaningful.
 *  - Response: `{ requestId, results: [{ id, url, title, publishedDate?, text?, author?, image?, favicon? }], ... }`
 *              Note: the documented search response does NOT carry a numeric
 *              relevance `score` on each result. We therefore assign a constant
 *              default confidence (see {@link EXA_DEFAULT_CONFIDENCE}); the
 *              trust evaluator is what decides restriction/stale/low-conf —
 *              adapters don't editorialize.
 *  - Errors:   non-2xx responses throw {@link ExaError}. Rate-limit responses
 *              surface the `Retry-After` header when present (seconds).
 *
 * Security:
 *  - The API key is NEVER interpolated into error messages, log lines, or
 *    `toString()` output. {@link ExaError} carries only HTTP status, a provider
 *    error code (if one can be extracted from the JSON body), and the optional
 *    Retry-After hint.
 *  - Rate-limit enforcement + observability live one layer up
 *    ({@link ./factory.wrapSignalWithGuards}). This adapter is transport-only.
 *  - Every returned Evidence is stamped with the caller-supplied `tenantId`
 *    so cross-tenant leakage is impossible at this boundary (Step 10 hygiene
 *    relies on this invariant when merging multi-provider results).
 *
 * Testability: the constructor accepts an injected `fetch` so replay-cassette
 * tests ({@link ./__tests__/exa.test.ts}) can drive deterministic responses
 * without network access. Cassette file:
 * `__tests__/cassettes/exa-search.json` (SCRUBBED of the API key).
 */

import { createEvidence, type Evidence } from "@hap/config";
import type { ProviderAdapter, ProviderCompanyContext } from "../provider-adapter.js";

/** Stable provider identifier — used by the factory and `provider_config.provider_name`. */
export const EXA_PROVIDER_NAME = "exa" as const;

/** Endpoint locked at the module level so tests can assert it verbatim. */
const EXA_SEARCH_URL = "https://api.exa.ai/search";

/** Bounded payload size — prevents a single long article from dominating Evidence.content. */
const EVIDENCE_CONTENT_MAX_CHARS = 2000;

/** Exa responses request text with this cap; keeps wire size predictable. */
const EXA_TEXT_MAX_CHARACTERS = 1500;

/**
 * Default confidence assigned to Exa results.
 *
 * The public search endpoint doesn't return a per-result relevance score we
 * can trust as a confidence proxy (it returns a shared `searchTime` /
 * `costDollars` envelope and per-result `highlightScores` only when the
 * `highlights` block is requested — which we don't). Slice 2 picks a stable
 * mid-range default; Step 10 hygiene + trust.ts can up/down-weight based on
 * source domain allow/block lists, freshness, and dedup evidence. The trust
 * evaluator is authoritative on restriction — the adapter does NOT editorialize.
 */
export const EXA_DEFAULT_CONFIDENCE = 0.7;

/** Default number of results requested from Exa per query. */
const DEFAULT_NUM_RESULTS = 5;

export interface ExaAdapterOptions {
  apiKey: string;
  /** Override `numResults` sent to Exa. Defaults to {@link DEFAULT_NUM_RESULTS}. */
  numResults?: number;
  /** Optional domain allow-list passed straight through. */
  includeDomains?: readonly string[];
  /** Optional domain block-list passed straight through. */
  excludeDomains?: readonly string[];
  /** Defaults to the global `fetch`. Inject in tests. */
  fetch?: typeof fetch;
}

/**
 * Error thrown on every non-2xx response from Exa.
 *
 * Fields exposed:
 *  - `status`            – HTTP status from the response.
 *  - `code`              – provider error code (when the JSON body carries one).
 *  - `retryAfterSeconds` – parsed `Retry-After` header when the server supplied one.
 *
 * `message` is a stable, redacted description; it NEVER includes the API key,
 * URL query parameters, or response body excerpts that could smuggle secrets
 * into shared log aggregators.
 */
export class ExaError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(args: {
    status: number;
    code: string | null;
    retryAfterSeconds: number | null;
  }) {
    super(`exa request failed (status=${args.status})`);
    this.name = "ExaError";
    this.status = args.status;
    this.code = args.code;
    this.retryAfterSeconds = args.retryAfterSeconds;
  }
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
  requestId?: string;
  results?: ExaSearchResult[];
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const n = Number.parseInt(header, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function extractErrorCode(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const rec = body as Record<string, unknown>;
  if (typeof rec.code === "string") return rec.code;
  if (typeof rec.error === "string") return rec.error;
  if (rec.error && typeof rec.error === "object" && !Array.isArray(rec.error)) {
    const code = (rec.error as Record<string, unknown>).code;
    if (typeof code === "string") return code;
  }
  return null;
}

/**
 * Derive an Evidence.source value from the result URL. We use the URL host so
 * downstream hygiene (Step 10 dedup + allow/block lists) has a canonical,
 * comparable source string regardless of path or query.
 *
 * Falls back to `"exa"` when the URL can't be parsed — this can't happen on
 * well-formed Exa responses but keeps the adapter robust against schema drift.
 */
function sourceFromUrl(url: string | undefined): string {
  if (!url) return "exa";
  try {
    // hostname (not host) — drops `:port` so `example.com:8080` becomes
    // `example.com`. Source tokens feed into trust evaluator's allow/block
    // matching and degraded-source classification; a stray port would
    // cause spurious mismatches (cubic review P2).
    const host = new URL(url).hostname.toLowerCase();
    return host.length > 0 ? host : "exa";
  } catch {
    return "exa";
  }
}

function parseTimestamp(raw: string | null | undefined, fallback: Date): Date {
  if (!raw) return fallback;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/** Stable per-result id: prefer Exa's `id`, then url, then a synthesized value. */
function deriveId(result: ExaSearchResult, index: number): string {
  if (result.id && typeof result.id === "string" && result.id.length > 0) {
    return `exa:${result.id}`;
  }
  if (result.url && typeof result.url === "string" && result.url.length > 0) {
    return `exa:${result.url}`;
  }
  return `exa:result-${index}`;
}

/** Truncate Evidence.content so a single long article can't dominate the snapshot. */
function truncate(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return text.slice(0, cap);
}

/**
 * Real Exa search adapter. Tenant isolation is handled upstream: the factory
 * decrypts the tenant's key and passes it into this constructor. This class
 * holds the plaintext key only in its closure; it never logs it.
 */
export class ExaAdapter implements ProviderAdapter {
  readonly name = EXA_PROVIDER_NAME;
  private readonly apiKey: string;
  private readonly numResults: number;
  private readonly includeDomains: readonly string[] | undefined;
  private readonly excludeDomains: readonly string[] | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ExaAdapterOptions) {
    this.apiKey = options.apiKey;
    this.numResults = options.numResults ?? DEFAULT_NUM_RESULTS;
    this.includeDomains = options.includeDomains;
    this.excludeDomains = options.excludeDomains;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async fetchSignals(tenantId: string, company: ProviderCompanyContext): Promise<Evidence[]> {
    const companyName = company.companyName ?? company.companyId;
    const query = company.domain ? `${companyName} ${company.domain}` : companyName;

    const body: Record<string, unknown> = {
      query,
      numResults: this.numResults,
      contents: { text: { maxCharacters: EXA_TEXT_MAX_CHARACTERS } },
    };
    if (this.includeDomains && this.includeDomains.length > 0) {
      body.includeDomains = this.includeDomains;
    }
    if (this.excludeDomains && this.excludeDomains.length > 0) {
      body.excludeDomains = this.excludeDomains;
    }

    const res = await this.fetchImpl(EXA_SEARCH_URL, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      let errorCode: string | null = null;
      try {
        const errorBody: unknown = await res.json();
        errorCode = extractErrorCode(errorBody);
      } catch {
        // Non-JSON error body — keep code null. NEVER log the raw body: it can
        // include request URLs, model IDs, or server-side detail that shouldn't
        // leak into aggregators.
      }
      throw new ExaError({
        status: res.status,
        code: errorCode,
        retryAfterSeconds: retryAfter,
      });
    }

    let parsed: ExaSearchResponse;
    try {
      parsed = (await res.json()) as ExaSearchResponse;
    } catch (_err) {
      throw new ExaError({
        status: res.status,
        code: "malformed_json",
        retryAfterSeconds: null,
      });
    }

    if (!parsed.results || !Array.isArray(parsed.results)) {
      throw new ExaError({
        status: res.status,
        code: "missing_results",
        retryAfterSeconds: null,
      });
    }

    const now = new Date();
    const out: Evidence[] = [];
    parsed.results.forEach((r, i) => {
      const url = typeof r.url === "string" ? r.url : "";
      // Skip malformed rows rather than fabricating Evidence with empty fields.
      if (!url) return;
      const title = typeof r.title === "string" ? r.title : "";
      const text = typeof r.text === "string" ? r.text : "";
      // Prefer text; fall back to title when text is empty. Truncated to bound payload.
      const content = truncate(text.length > 0 ? text : title, EVIDENCE_CONTENT_MAX_CHARS);

      out.push(
        createEvidence(tenantId, {
          id: deriveId(r, i),
          source: sourceFromUrl(url),
          confidence: EXA_DEFAULT_CONFIDENCE,
          content,
          timestamp: parseTimestamp(r.publishedDate, now),
          isRestricted: false,
        }),
      );
    });

    return out;
  }
}
