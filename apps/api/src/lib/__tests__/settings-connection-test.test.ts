import type { TestConnectionBody } from "@hap/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertSafeCustomEndpoint,
  type ConnectionTestLogger,
  type SavedKeyLoader,
  SsrfError,
  testConnection,
} from "../settings-connection-test";

/** Sentinel used by logger-spy tests to prove we never log plaintext keys. */
const PLAINTEXT_SENTINEL = "sk-test-PLAINTEXT-SENTINEL-1234567890";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeLoggerSpy(): {
  logger: ConnectionTestLogger;
  captured: Array<{
    level: string;
    event: string;
    fields: Record<string, unknown>;
  }>;
} {
  const captured: Array<{
    level: string;
    event: string;
    fields: Record<string, unknown>;
  }> = [];
  const record = (level: string) => (event: string, fields: Record<string, unknown>) => {
    captured.push({ level, event, fields });
  };
  return {
    logger: {
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
    },
    captured,
  };
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn((input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return Promise.resolve(handler(url, init));
  }) as unknown as typeof fetch;
}

const tenantA = "tenant-a";
const tenantB = "tenant-b";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("testLlmConnection — OpenAI", () => {
  const body = (model = "gpt-5.4"): TestConnectionBody => ({
    target: "llm",
    provider: "openai",
    model,
    apiKey: PLAINTEXT_SENTINEL,
  });

  it("maps a 401 from /v1/models to code: 'auth'", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(401, { error: "invalid" }));
    const { logger, captured } = makeLoggerSpy();
    const result = await testConnection(tenantA, body(), {
      fetch: fetchImpl,
      logger,
      now: () => 1000,
    });
    expect(result).toEqual({
      ok: false,
      code: "auth",
      message: expect.any(String),
    });
    // No plaintext leak in logs.
    const joined = JSON.stringify(captured);
    expect(joined).not.toContain(PLAINTEXT_SENTINEL);
  });

  it("maps a 200 without the selected model to code: 'model'", async () => {
    const fetchImpl = stubFetch(() =>
      jsonResponse(200, { data: [{ id: "gpt-5.4-mini" }, { id: "o4-mini" }] }),
    );
    const result = await testConnection(tenantA, body("gpt-5.4"), {
      fetch: fetchImpl,
      now: () => 1000,
    });
    expect(result).toEqual({
      ok: false,
      code: "model",
      message: expect.any(String),
    });
  });

  it("returns ok with latencyMs and providerEcho when the model is present", async () => {
    const fetchImpl = stubFetch(() =>
      jsonResponse(200, { data: [{ id: "gpt-5.4" }, { id: "gpt-5.4-mini" }] }),
    );
    let t = 1000;
    const now = () => {
      const v = t;
      t += 42;
      return v;
    };
    const result = await testConnection(tenantA, body("gpt-5.4"), {
      fetch: fetchImpl,
      now,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.providerEcho?.model).toBe("gpt-5.4");
    }
  });
});

describe("testLlmConnection — Anthropic", () => {
  const body = (model = "claude-sonnet-4-6"): TestConnectionBody => ({
    target: "llm",
    provider: "anthropic",
    model,
    apiKey: PLAINTEXT_SENTINEL,
  });

  it("maps a 401 to code: 'auth'", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(401, {}));
    const result = await testConnection(tenantA, body(), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "auth" });
  });

  it("maps a 404 model-not-found to code: 'model'", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(404, { error: { type: "not_found_error" } }));
    const result = await testConnection(tenantA, body(), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "model" });
  });

  it("maps a 429 to code: 'rate_limit'", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(429, {}));
    const result = await testConnection(tenantA, body(), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "rate_limit" });
  });
});

describe("testLlmConnection — Gemini", () => {
  const body = (model = "gemini-2.5-pro"): TestConnectionBody => ({
    target: "llm",
    provider: "gemini",
    model,
    apiKey: PLAINTEXT_SENTINEL,
  });

  it("maps a 404 to code: 'model'", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(404, {}));
    const result = await testConnection(tenantA, body(), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "model" });
  });
});

describe("testLlmConnection — OpenRouter", () => {
  const body = (model = "anthropic/claude-sonnet-4.5"): TestConnectionBody => ({
    target: "llm",
    provider: "openrouter",
    model,
    apiKey: PLAINTEXT_SENTINEL,
  });

  it("maps a missing slug in the catalog to code: 'model'", async () => {
    const fetchImpl = stubFetch(() =>
      jsonResponse(200, { data: [{ id: "anthropic/claude-haiku-4.5" }] }),
    );
    const result = await testConnection(tenantA, body("anthropic/claude-sonnet-4.5"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "model" });
  });
});

describe("testLlmConnection — Custom (SSRF + URL rules)", () => {
  const customBody = (endpointUrl: string): TestConnectionBody => ({
    target: "llm",
    provider: "custom",
    model: "oss-model",
    endpointUrl,
    apiKey: PLAINTEXT_SENTINEL,
  });

  it("rejects http:// URLs with code: 'endpoint'", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, { data: [{ id: "oss-model" }] }));
    const result = await testConnection(tenantA, customBody("http://example.com"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "endpoint" });
    // fetch must NOT have been called for a rejected endpoint.
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("rejects https://localhost/", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, {}));
    const result = await testConnection(tenantA, customBody("https://localhost/v1"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "endpoint" });
  });

  it("rejects https://169.254.169.254/ (cloud metadata)", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, {}));
    const result = await testConnection(tenantA, customBody("https://169.254.169.254/"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "endpoint" });
  });

  it("rejects https://10.0.0.5/", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, {}));
    const result = await testConnection(tenantA, customBody("https://10.0.0.5/"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "endpoint" });
  });

  it("accepts a safe HTTPS URL and probes it", async () => {
    const seen: string[] = [];
    const fetchImpl = stubFetch((url) => {
      seen.push(url);
      return jsonResponse(200, { data: [{ id: "oss-model" }] });
    });
    const result = await testConnection(tenantA, customBody("https://api.example.com"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result.ok).toBe(true);
    expect(seen[0]).toMatch(/^https:\/\/api\.example\.com\/(v1\/)?models$/);
  });

  it("unit: assertSafeCustomEndpoint rejects additional private ranges", () => {
    expect(() => assertSafeCustomEndpoint("https://172.16.0.1/")).toThrow(SsrfError);
    expect(() => assertSafeCustomEndpoint("https://192.168.1.1/")).toThrow(SsrfError);
    expect(() => assertSafeCustomEndpoint("https://[::1]/")).toThrow(SsrfError);
    expect(() => assertSafeCustomEndpoint("not a url")).toThrow(SsrfError);
  });
});

describe("assertSafeCustomEndpoint — IPv4-mapped IPv6 + unspecified + hex", () => {
  const customBody = (endpointUrl: string): TestConnectionBody => ({
    target: "llm",
    provider: "custom",
    model: "oss-model",
    endpointUrl,
    apiKey: PLAINTEXT_SENTINEL,
  });

  it("rejects https://[::ffff:169.254.169.254]/v1/models (AWS metadata via v4-mapped v6)", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, { data: [{ id: "oss-model" }] }));
    const result = await testConnection(
      tenantA,
      customBody("https://[::ffff:169.254.169.254]/v1/models"),
      { fetch: fetchImpl, now: () => 1 },
    );
    expect(result).toMatchObject({ ok: false, code: "endpoint" });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("rejects https://[::ffff:169.254.169.254]/ bare (AWS metadata via v4-mapped v6)", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, {}));
    const result = await testConnection(tenantA, customBody("https://[::ffff:169.254.169.254]/"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "endpoint" });
  });

  it("rejects https://[::ffff:127.0.0.1]/ (loopback via v4-mapped v6)", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, {}));
    const result = await testConnection(tenantA, customBody("https://[::ffff:127.0.0.1]/"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "endpoint" });
  });

  it("rejects https://[::ffff:10.0.0.5]/ (private v4 via v4-mapped v6)", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, {}));
    const result = await testConnection(tenantA, customBody("https://[::ffff:10.0.0.5]/"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "endpoint" });
  });

  it("rejects https://[::ffff:192.168.1.1]/", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, {}));
    const result = await testConnection(tenantA, customBody("https://[::ffff:192.168.1.1]/"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "endpoint" });
  });

  it("rejects https://[::ffff:172.16.0.1]/", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, {}));
    const result = await testConnection(tenantA, customBody("https://[::ffff:172.16.0.1]/"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "endpoint" });
  });

  it("rejects https://[::]/ (unspecified IPv6)", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, {}));
    const result = await testConnection(tenantA, customBody("https://[::]/"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "endpoint" });
  });

  it("rejects https://[::ffff:a9fe:a9fe]/ (hex form of 169.254.169.254)", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, {}));
    const result = await testConnection(tenantA, customBody("https://[::ffff:a9fe:a9fe]/"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "endpoint" });
  });

  it("rejects https://[::ffff:7f00:1]/ (hex form of 127.0.0.1)", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, {}));
    const result = await testConnection(tenantA, customBody("https://[::ffff:7f00:1]/"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "endpoint" });
  });

  it("rejects https://foo.localhost/ (hostname ending in .localhost)", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, {}));
    const result = await testConnection(tenantA, customBody("https://foo.localhost/"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "endpoint" });
  });

  it("sanity: https://api.openai.com/v1/models still succeeds", async () => {
    const seen: string[] = [];
    const fetchImpl = stubFetch((url) => {
      seen.push(url);
      return jsonResponse(200, { data: [{ id: "oss-model" }] });
    });
    const result = await testConnection(tenantA, customBody("https://api.openai.com"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result.ok).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toMatch(/^https:\/\/api\.openai\.com\/(v1\/)?models$/);
  });
});

describe("assertSafeCustomEndpoint — 6to4 / Teredo / IPv4-compatible IPv6", () => {
  const customBody = (endpointUrl: string): TestConnectionBody => ({
    target: "llm",
    provider: "custom",
    model: "oss-model",
    endpointUrl,
    apiKey: PLAINTEXT_SENTINEL,
  });

  it("rejects 6to4 encapsulation of AWS metadata: https://[2002:a9fe:a9fe::]/", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, {}));
    const result = await testConnection(tenantA, customBody("https://[2002:a9fe:a9fe::]/"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "endpoint" });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("rejects arbitrary 6to4 prefix: https://[2002::1]/", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, {}));
    const result = await testConnection(tenantA, customBody("https://[2002::1]/"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "endpoint" });
  });

  it("rejects Teredo prefix: https://[2001::1]/", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, {}));
    const result = await testConnection(tenantA, customBody("https://[2001::1]/"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "endpoint" });
  });

  it("rejects IPv4-compatible IPv6 dotted form: https://[::169.254.169.254]/", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, {}));
    const result = await testConnection(tenantA, customBody("https://[::169.254.169.254]/"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "endpoint" });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("rejects IPv4-compatible IPv6 hex form: https://[::a9fe:a9fe]/", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, {}));
    const result = await testConnection(tenantA, customBody("https://[::a9fe:a9fe]/"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "endpoint" });
  });

  it("rejects IPv4-compatible loopback: https://[::127.0.0.1]/", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, {}));
    const result = await testConnection(tenantA, customBody("https://[::127.0.0.1]/"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "endpoint" });
  });

  it("sanity: public IPv6 addresses outside tunnel/compat ranges still succeed", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, { data: [{ id: "oss-model" }] }));
    // 2606:4700:4700::1111 is Cloudflare public DNS — a valid public IPv6
    // that must NOT be blocked by our guard.
    const result = await testConnection(tenantA, customBody("https://[2606:4700:4700::1111]/"), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result.ok).toBe(true);
  });
});

describe("testExaConnection", () => {
  const body = (): TestConnectionBody => ({
    target: "exa",
    apiKey: PLAINTEXT_SENTINEL,
  });

  it("maps a 401 to code: 'auth'", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(401, {}));
    const result = await testConnection(tenantA, body(), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "auth" });
  });

  it("maps a 429 to code: 'rate_limit'", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(429, {}));
    const result = await testConnection(tenantA, body(), {
      fetch: fetchImpl,
      now: () => 1,
    });
    expect(result).toMatchObject({ ok: false, code: "rate_limit" });
  });

  it("returns ok with latencyMs on a 200", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, { results: [] }));
    let t = 500;
    const now = () => {
      const v = t;
      t += 12;
      return v;
    };
    const result = await testConnection(tenantA, body(), {
      fetch: fetchImpl,
      now,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("saved-key path", () => {
  it("returns { code: 'auth', message: 'No stored key' } when no key is stored", async () => {
    const loader: SavedKeyLoader = async () => null;
    const fetchImpl = stubFetch(() => jsonResponse(200, { data: [{ id: "gpt-5.4" }] }));
    const result = await testConnection(
      tenantA,
      {
        target: "llm",
        provider: "openai",
        model: "gpt-5.4",
        useSavedKey: true,
      },
      { fetch: fetchImpl, loadSavedKey: loader, now: () => 1 },
    );
    expect(result).toEqual({
      ok: false,
      code: "auth",
      message: "No stored key",
    });
  });

  it("scopes saved-key loads to the requesting tenant (cross-tenant isolation)", async () => {
    // tenantA should never see tenantB's saved key.
    const loader: SavedKeyLoader = vi.fn(async (tenantId, target) => {
      if (tenantId === tenantB && target.target === "exa") return "secret-for-b";
      return null;
    });
    const fetchImpl = stubFetch(() => jsonResponse(200, {}));
    const result = await testConnection(
      tenantA,
      { target: "exa", useSavedKey: true },
      { fetch: fetchImpl, loadSavedKey: loader, now: () => 1 },
    );
    expect(result).toEqual({
      ok: false,
      code: "auth",
      message: "No stored key",
    });
    // The loader was called with tenantA, never tenantB.
    expect((loader as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([
      tenantA,
    ]);
  });
});

describe("logger spy — no plaintext key fragment leaks", () => {
  it("does not log the plaintext key on auth failures", async () => {
    const { logger, captured } = makeLoggerSpy();
    const fetchImpl = stubFetch(() => jsonResponse(401, { error: "bad key" }));
    await testConnection(
      tenantA,
      {
        target: "llm",
        provider: "openai",
        model: "gpt-5.4",
        apiKey: PLAINTEXT_SENTINEL,
      },
      { fetch: fetchImpl, logger, now: () => 1 },
    );
    const joined = JSON.stringify(captured);
    expect(joined).not.toContain(PLAINTEXT_SENTINEL);
  });

  it("does not log the plaintext key on network errors", async () => {
    const { logger, captured } = makeLoggerSpy();
    const fetchImpl = vi.fn(() =>
      Promise.reject(new Error(`connection refused for key=${PLAINTEXT_SENTINEL}`)),
    ) as unknown as typeof fetch;
    const result = await testConnection(
      tenantA,
      {
        target: "exa",
        apiKey: PLAINTEXT_SENTINEL,
      },
      { fetch: fetchImpl, logger, now: () => 1 },
    );
    expect(result).toMatchObject({ ok: false, code: "network" });
    const joined = JSON.stringify(captured);
    expect(joined).not.toContain(PLAINTEXT_SENTINEL);
  });

  it("does not log the plaintext key on success paths", async () => {
    const { logger, captured } = makeLoggerSpy();
    const fetchImpl = stubFetch(() => jsonResponse(200, { data: [{ id: "gpt-5.4" }] }));
    await testConnection(
      tenantA,
      {
        target: "llm",
        provider: "openai",
        model: "gpt-5.4",
        apiKey: PLAINTEXT_SENTINEL,
      },
      { fetch: fetchImpl, logger, now: () => 1 },
    );
    const joined = JSON.stringify(captured);
    expect(joined).not.toContain(PLAINTEXT_SENTINEL);
  });
});
