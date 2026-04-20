/**
 * Settings connection-test service.
 *
 * Owned by Issue B (B4). Backs `POST /api/settings/test-connection`, the
 * explicit verification path for LLM + Exa credentials. Operators currently
 * find out their credentials are wrong via a silently empty snapshot; this
 * service fails loud at save time.
 *
 * Security posture (non-negotiable — enforced by tests):
 *   - Plaintext keys are NEVER logged, NEVER echoed in responses, NEVER
 *     persisted from this code path. Draft keys live in the request body
 *     for the duration of one vendor call, saved keys are decrypted in-process
 *     and discarded immediately after use.
 *   - Vendor error bodies are NOT forwarded verbatim. Every failure maps to
 *     a narrow {@link TestConnectionErrorCode}.
 *   - Custom endpoint URLs are SSRF-guarded here: HTTPS-only, reject
 *     loopback / link-local / private-range / cloud-metadata hosts.
 *   - The caller (route layer) is responsible for tenant auth + rate
 *     limiting. This service trusts its `tenantId` input.
 *
 * Dependency injection: {@link TestConnectionDeps} exposes `fetch`, `logger`,
 * and `loadSavedKey` as injectable seams so unit tests can mock vendor
 * responses, assert log outputs, and stub the encryption path without a DB.
 */

import { BlockList, isIP } from "node:net";
import type {
  LlmProviderType,
  TestConnectionBody,
  TestConnectionErrorCode,
  TestConnectionLlmBody,
  TestConnectionResponse,
} from "@hap/config";
import { type Database, llmConfig, providerConfig } from "@hap/db";
import { and, eq } from "drizzle-orm";
import { decryptProviderKey } from "./encryption";

/**
 * Authoritative blocklist of IP ranges that are unsafe for outbound
 * custom-endpoint probes. Uses Node's built-in {@link BlockList} — the
 * same primitive undici/fetch uses internally to parse addresses — so
 * IPv4-mapped IPv6 forms like `::ffff:169.254.169.254` and hex forms
 * like `::ffff:a9fe:a9fe` are normalized and matched correctly.
 *
 * Naive string-prefix checks on the bracket-stripped host are NOT
 * sufficient: they miss v4-mapped v6 (credential-metadata bypass) and
 * the hex representation of the same addresses.
 */
const BLOCKED_IPS: BlockList = (() => {
  const list = new BlockList();
  // IPv4 unsafe ranges.
  list.addSubnet("0.0.0.0", 8, "ipv4");
  list.addSubnet("10.0.0.0", 8, "ipv4");
  list.addSubnet("127.0.0.0", 8, "ipv4");
  list.addSubnet("169.254.0.0", 16, "ipv4");
  list.addSubnet("172.16.0.0", 12, "ipv4");
  list.addSubnet("192.168.0.0", 16, "ipv4");
  // IPv6 unsafe ranges.
  list.addAddress("::", "ipv6"); // unspecified
  list.addAddress("::1", "ipv6"); // loopback
  list.addSubnet("fc00::", 7, "ipv6"); // unique-local (ULA)
  list.addSubnet("fe80::", 10, "ipv6"); // link-local
  // IPv4-mapped IPv6 space (::ffff:0:0/96) — covers every v4-mapped v6
  // including hex forms like ::ffff:a9fe:a9fe. `BlockList.check` with
  // family "ipv6" resolves the embedded IPv4 against this subnet.
  list.addSubnet("::ffff:0:0", 96, "ipv6");
  // 6to4 encapsulation (RFC 3056). 2002:<v4>::/48 decodes to an arbitrary
  // IPv4 destination, so 2002:a9fe:a9fe::/48 → 169.254.169.254 metadata.
  // Block the entire 2002::/16 tunnel prefix — we never legitimately probe
  // a 6to4-encapsulated endpoint from this service.
  list.addSubnet("2002::", 16, "ipv6");
  // Teredo (RFC 4380) — 2001::/32 tunnels IPv4 over UDP/IPv6. Same class
  // of v4 smuggling risk as 6to4. Block the tunnel prefix.
  list.addSubnet("2001::", 32, "ipv6");
  return list;
})();

/**
 * Detect IPv4-compatible IPv6 addresses (`::a.b.c.d`, deprecated per
 * RFC 4291 §2.5.5.1 but still resolvable on some stacks). These are
 * distinct from the IPv4-mapped form (`::ffff:a.b.c.d`) already handled
 * by the BlockList: IPv4-compat has zero in the "ffff" word, so
 * `::169.254.169.254` → `::a9fe:a9fe`, which passes `::ffff:0:0/96`.
 *
 * Any non-zero IPv4 embedded in the last 32 bits of an all-zero-upper
 * IPv6 address is suspect. `::` and `::1` are already separately
 * blocked; this helper covers the rest of `::/96` with a non-zero v4.
 */
function isBlockedIpv4CompatibleIpv6(hostStripped: string, family: number): boolean {
  if (family !== 6) return false;
  // Normalize "::a.b.c.d" to "::a.b.c.d" and "::hex:hex" forms by parsing
  // through URL. A 6-word-zero + final 32-bit form means the upper 96 bits
  // are zero.
  // Quick literal check for dotted form.
  const dotted = /^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(hostStripped);
  if (dotted) return true;
  // Hex form: `::x:y` where x,y are 1-4 hex. Reject unless explicitly
  // whitelisted (::1 and :: are already handled upstream).
  if (/^::[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(hostStripped)) {
    return hostStripped !== "::1"; // ::1 already caught earlier
  }
  return false;
}

/**
 * Minimal structured logger surface. Matches the fields emitted by
 * {@link ./observability} but decoupled so we can inject a spy.
 *
 * IMPORTANT: callers of this service MUST NOT put plaintext keys into any
 * field passed to the logger. Tests assert against a captured logger spy
 * with a sentinel plaintext string to guarantee no accidental leaks.
 */
export interface ConnectionTestLogger {
  info(event: string, fields: Record<string, unknown>): void;
  warn(event: string, fields: Record<string, unknown>): void;
  error(event: string, fields: Record<string, unknown>): void;
}

const DEFAULT_LOGGER: ConnectionTestLogger = {
  info: (event, fields) => console.error(JSON.stringify({ level: "info", event, ...fields })),
  warn: (event, fields) => console.error(JSON.stringify({ level: "warn", event, ...fields })),
  error: (event, fields) => console.error(JSON.stringify({ level: "error", event, ...fields })),
};

/**
 * Resolve a saved API key for the given tenant/target. Returns `null` when
 * no saved key exists.
 *
 * The default impl queries `provider_config` for Exa and `llm_config` for
 * LLM targets, then {@link decryptProviderKey decrypts} in-process. Tests
 * inject a stub to avoid touching the DB.
 */
export type SavedKeyTarget = { target: "exa" } | { target: "llm"; provider: LlmProviderType };

export type SavedKeyLoader = (tenantId: string, target: SavedKeyTarget) => Promise<string | null>;

export interface TestConnectionDeps {
  fetch?: typeof fetch;
  logger?: ConnectionTestLogger;
  loadSavedKey?: SavedKeyLoader;
  /** Clock source for latency measurement; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Default {@link SavedKeyLoader}. Reads the ciphertext for the requested
 * target from the tenant's provider_config / llm_config rows and decrypts
 * in-process via {@link decryptProviderKey}. Plaintext is returned to the
 * caller and discarded by the caller immediately after the vendor call.
 */
export function createDefaultSavedKeyLoader(db: Database): SavedKeyLoader {
  return async (tenantId, target) => {
    if (target.target === "exa") {
      const rows = await db
        .select({ ciphertext: providerConfig.apiKeyEncrypted })
        .from(providerConfig)
        .where(and(eq(providerConfig.tenantId, tenantId), eq(providerConfig.providerName, "exa")))
        .limit(1);
      const ct = rows[0]?.ciphertext ?? null;
      return ct ? decryptProviderKey(tenantId, ct) : null;
    }
    const rows = await db
      .select({ ciphertext: llmConfig.apiKeyEncrypted })
      .from(llmConfig)
      .where(and(eq(llmConfig.tenantId, tenantId), eq(llmConfig.providerName, target.provider)))
      .limit(1);
    const ct = rows[0]?.ciphertext ?? null;
    return ct ? decryptProviderKey(tenantId, ct) : null;
  };
}

const DEFAULT_NOW = () => Date.now();

/** Build a short sanitized failure message. NEVER includes plaintext keys. */
function fail(code: TestConnectionErrorCode, message: string): TestConnectionResponse {
  return { ok: false, code, message };
}

/**
 * SSRF guard for `provider === "custom"` endpoint URLs.
 *
 * Rules:
 *   - Must parse as a URL.
 *   - Must use https scheme.
 *   - Must not contain userinfo (`https://example.com@169.254.169.254/`
 *     style bypass).
 *   - IP literal hosts (v4 or v6, in any normalized form) are checked
 *     against {@link BLOCKED_IPS} — a Node {@link BlockList} covering
 *     loopback, link-local, private, ULA, unspecified, and the
 *     IPv4-mapped-IPv6 (`::ffff:0:0/96`) subnet so that forms like
 *     `::ffff:169.254.169.254` and `::ffff:a9fe:a9fe` cannot bypass
 *     the v4 checks.
 *   - Hostnames resolving to `localhost` or ending in `.localhost`
 *     (per RFC 6761) are rejected.
 *
 * A DNS-resolution pass for arbitrary hostnames is out of scope for V1;
 * this still blocks the literal-IP and localhost bypass classes.
 */
export function assertSafeCustomEndpoint(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfError("invalid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new SsrfError("must be HTTPS");
  }
  // Reject userinfo in the authority — e.g. https://example.com@169.254.169.254/.
  // URL.username/password are empty strings when absent.
  if (parsed.username !== "" || parsed.password !== "") {
    throw new SsrfError("userinfo not allowed");
  }

  const host = parsed.hostname.toLowerCase();
  const stripped = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

  const family = isIP(stripped);
  if (family === 4) {
    if (BLOCKED_IPS.check(stripped, "ipv4")) {
      throw new SsrfError("blocked IPv4 host");
    }
    return;
  }
  if (family === 6) {
    if (BLOCKED_IPS.check(stripped, "ipv6")) {
      throw new SsrfError("blocked IPv6 host");
    }
    // IPv4-compatible IPv6 (`::a.b.c.d`, deprecated) is not caught by
    // `::ffff:0:0/96` because the "ffff" word is zero. Reject these too —
    // they smuggle the v4 destination through a format the BlockList
    // can't match without a separate check.
    if (isBlockedIpv4CompatibleIpv6(stripped, family)) {
      throw new SsrfError("blocked IPv4-compatible IPv6 host");
    }
    return;
  }

  // Hostname path. family === 0.
  if (stripped === "localhost" || stripped === "ip6-localhost") {
    throw new SsrfError("loopback host not allowed");
  }
  // RFC 6761: any name ending in `.localhost` must resolve to loopback.
  if (stripped.endsWith(".localhost")) {
    throw new SsrfError("loopback host not allowed");
  }
}

/** Internal sentinel — collapsed to `code: "endpoint"` by callers. */
export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

/**
 * Resolve the API key for a draft or saved-key request. Returns `null` when
 * the saved-key path was requested but no key is stored.
 */
async function resolveKey(
  tenantId: string,
  body: TestConnectionBody,
  loader: SavedKeyLoader,
): Promise<string | null> {
  if (body.apiKey) return body.apiKey;
  if (!body.useSavedKey) return null; // validator guarantees we don't reach here
  const target: SavedKeyTarget =
    body.target === "exa" ? { target: "exa" } : { target: "llm", provider: body.provider };
  return loader(tenantId, target);
}

/**
 * Map a fetch Response to a TestConnectionErrorCode for the common HTTP
 * failure shapes. 200-299 is NOT handled here; callers own success.
 */
function mapHttpStatusToCode(status: number): TestConnectionErrorCode {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "model";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "network";
  return "unknown";
}

/**
 * Public entry point: dispatch on `body.target`. Delegates to the LLM or Exa
 * branch and guarantees the response never leaks plaintext keys.
 */
export async function testConnection(
  tenantId: string,
  body: TestConnectionBody,
  deps: TestConnectionDeps = {},
): Promise<TestConnectionResponse> {
  if (body.target === "llm") {
    return testLlmConnection(tenantId, body, deps);
  }
  return testExaConnection(tenantId, body, deps);
}

/**
 * LLM test dispatcher. For each provider we pick the cheapest possible
 * auth-gated check and validate that the selected `model` is actually
 * callable (either by listing models or by asking for one token).
 */
export async function testLlmConnection(
  tenantId: string,
  body: TestConnectionLlmBody,
  deps: TestConnectionDeps = {},
): Promise<TestConnectionResponse> {
  const logger = deps.logger ?? DEFAULT_LOGGER;
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? DEFAULT_NOW;
  const loader =
    deps.loadSavedKey ??
    (async () => {
      // If no loader is configured the caller forgot to wire one; fail safely.
      return null;
    });

  // SSRF guard runs BEFORE key resolution so a malicious custom endpoint
  // cannot cause us to decrypt a saved key and then fail.
  if (body.provider === "custom") {
    if (!body.endpointUrl) {
      return fail("endpoint", "endpointUrl is required for custom provider");
    }
    try {
      assertSafeCustomEndpoint(body.endpointUrl);
    } catch (err) {
      logger.warn("settings.test_connection.ssrf_rejected", {
        tenantId,
        provider: body.provider,
        // NB: do not log the URL host even here — it may be attacker-controlled.
        reason: err instanceof Error ? err.name : "unknown",
      });
      return fail("endpoint", "endpoint rejected");
    }
  }

  const key = await resolveKey(tenantId, body, loader);
  if (!key) {
    return fail("auth", "No stored key");
  }

  const started = now();
  try {
    switch (body.provider) {
      case "openai":
        return await probeOpenAi(fetchImpl, key, body.model, started, now);
      case "anthropic":
        return await probeAnthropic(fetchImpl, key, body.model, started, now);
      case "gemini":
        return await probeGemini(fetchImpl, key, body.model, started, now);
      case "openrouter":
        return await probeOpenRouter(fetchImpl, key, body.model, started, now);
      case "custom":
        return await probeCustom(
          fetchImpl,
          key,
          body.model,
          body.endpointUrl as string,
          started,
          now,
        );
    }
  } catch (err) {
    logger.error("settings.test_connection.fetch_failed", {
      tenantId,
      provider: body.provider,
      errorClass: err instanceof Error ? err.name : "Unknown",
    });
    return fail("network", "network error");
  }
}

/**
 * Exa test. POST `api.exa.ai/search` with a trivial single-result query.
 * 2xx → ok. Standard status-code mapping otherwise.
 */
export async function testExaConnection(
  tenantId: string,
  body: { target: "exa"; apiKey?: string; useSavedKey?: true },
  deps: TestConnectionDeps = {},
): Promise<TestConnectionResponse> {
  const logger = deps.logger ?? DEFAULT_LOGGER;
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? DEFAULT_NOW;
  const loader = deps.loadSavedKey ?? (async () => null);

  const key = await resolveKey(tenantId, body, loader);
  if (!key) {
    return fail("auth", "No stored key");
  }

  const started = now();
  try {
    const res = await fetchImpl("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "connection test", numResults: 1 }),
    });
    if (res.ok) {
      return { ok: true, latencyMs: Math.max(0, now() - started) };
    }
    return fail(mapHttpStatusToCode(res.status), `exa status ${res.status}`);
  } catch (err) {
    logger.error("settings.test_connection.fetch_failed", {
      tenantId,
      provider: "exa",
      errorClass: err instanceof Error ? err.name : "Unknown",
    });
    return fail("network", "network error");
  }
}

// -- Provider probes --------------------------------------------------------

async function probeOpenAi(
  fetchImpl: typeof fetch,
  key: string,
  model: string,
  started: number,
  now: () => number,
): Promise<TestConnectionResponse> {
  const res = await fetchImpl("https://api.openai.com/v1/models", {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    return fail(mapHttpStatusToCode(res.status), `openai status ${res.status}`);
  }
  const models = await extractOpenAiStyleModelIds(res);
  if (!models.includes(model)) {
    return fail("model", `model '${model}' not available`);
  }
  return {
    ok: true,
    latencyMs: Math.max(0, now() - started),
    providerEcho: { model },
  };
}

async function probeAnthropic(
  fetchImpl: typeof fetch,
  key: string,
  model: string,
  started: number,
  now: () => number,
): Promise<TestConnectionResponse> {
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "." }],
    }),
  });
  if (res.ok) {
    return {
      ok: true,
      latencyMs: Math.max(0, now() - started),
      providerEcho: { model },
    };
  }
  // Anthropic surfaces "model not found" as 404 AND as 400 with a specific
  // error.type. We treat both paths as `code: "model"` without forwarding the
  // vendor body verbatim.
  if (res.status === 404) {
    return fail("model", `model '${model}' not available`);
  }
  if (res.status === 400) {
    const detail = await peekJsonErrorType(res);
    if (detail && /not_found|invalid_request/i.test(detail)) {
      return fail("model", `model '${model}' not available`);
    }
  }
  return fail(mapHttpStatusToCode(res.status), `anthropic status ${res.status}`);
}

async function probeGemini(
  fetchImpl: typeof fetch,
  key: string,
  model: string,
  started: number,
  now: () => number,
): Promise<TestConnectionResponse> {
  // `GET /v1beta/models/{model}?key={apiKey}` — auth-gated, no billed tokens.
  // The model id often appears in the docs with a `models/` prefix; pass it
  // through as-is. Gemini returns 403 for bad auth and 404 for unknown model.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}?key=${encodeURIComponent(key)}`;
  const res = await fetchImpl(url, { method: "GET" });
  if (res.ok) {
    return {
      ok: true,
      latencyMs: Math.max(0, now() - started),
      providerEcho: { model },
    };
  }
  if (res.status === 404) {
    return fail("model", `model '${model}' not available`);
  }
  return fail(mapHttpStatusToCode(res.status), `gemini status ${res.status}`);
}

async function probeOpenRouter(
  fetchImpl: typeof fetch,
  key: string,
  model: string,
  started: number,
  now: () => number,
): Promise<TestConnectionResponse> {
  const res = await fetchImpl("https://openrouter.ai/api/v1/models", {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    return fail(mapHttpStatusToCode(res.status), `openrouter status ${res.status}`);
  }
  const models = await extractOpenAiStyleModelIds(res);
  if (!models.includes(model)) {
    return fail("model", `model '${model}' not available`);
  }
  return {
    ok: true,
    latencyMs: Math.max(0, now() - started),
    providerEcho: { model },
  };
}

async function probeCustom(
  fetchImpl: typeof fetch,
  key: string,
  model: string,
  endpointUrl: string,
  started: number,
  now: () => number,
): Promise<TestConnectionResponse> {
  // Tolerate trailing slash. Try `/v1/models` first, fall back to `/models`
  // for OpenAI-compatible servers that don't namespace under `/v1`.
  const base = endpointUrl.replace(/\/+$/, "");
  const candidates = [`${base}/v1/models`, `${base}/models`];
  let lastStatus = 0;
  for (const url of candidates) {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) {
      const models = await extractOpenAiStyleModelIds(res);
      if (!models.includes(model)) {
        return fail("model", `model '${model}' not available`);
      }
      return {
        ok: true,
        latencyMs: Math.max(0, now() - started),
        providerEcho: { model },
      };
    }
    lastStatus = res.status;
    if (res.status === 401 || res.status === 403) {
      return fail("auth", `custom status ${res.status}`);
    }
    // 404 on one path may mean the other path is canonical; keep trying.
    if (res.status !== 404) {
      return fail(mapHttpStatusToCode(res.status), `custom status ${res.status}`);
    }
  }
  return fail(mapHttpStatusToCode(lastStatus || 404), `custom status ${lastStatus || 404}`);
}

// -- Helpers ----------------------------------------------------------------

async function extractOpenAiStyleModelIds(res: Response): Promise<string[]> {
  try {
    const json = (await res.json()) as unknown;
    if (
      json &&
      typeof json === "object" &&
      "data" in json &&
      Array.isArray((json as { data: unknown }).data)
    ) {
      return ((json as { data: unknown[] }).data as unknown[])
        .map((item) =>
          item && typeof item === "object" && "id" in item
            ? String((item as { id: unknown }).id)
            : "",
        )
        .filter((s) => s.length > 0);
    }
  } catch {
    // Fall through; treat as empty.
  }
  return [];
}

async function peekJsonErrorType(res: Response): Promise<string | null> {
  try {
    const json = (await res.json()) as unknown;
    if (json && typeof json === "object" && "error" in json) {
      const err = (json as { error: unknown }).error;
      if (err && typeof err === "object" && "type" in err) {
        const t = (err as { type: unknown }).type;
        if (typeof t === "string") return t;
      }
    }
  } catch {
    // Fall through.
  }
  return null;
}
