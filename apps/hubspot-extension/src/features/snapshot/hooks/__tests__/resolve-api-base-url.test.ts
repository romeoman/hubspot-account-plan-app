/**
 * Tests for `resolveApiBaseUrl()` — profile/build-time API origin resolver.
 *
 * Resolution precedence (highest wins):
 *   1. A build-time global constant `__HAP_API_ORIGIN__` (injected by Vite
 *      `define` from `process.env.API_ORIGIN` at `vite build` time). This
 *      is the production path — the HubSpot project build runs once per
 *      profile, so each bundle carries the correct origin literally.
 *   2. `process.env.API_ORIGIN` — the test/runtime escape hatch. Applies
 *      only in Node runtimes (vitest, SSR). In the real HubSpot extension
 *      environment `process` is undefined, so this branch never fires.
 *   3. The hardcoded `DEFAULT_API_BASE_URL` (prod Vercel), so an
 *      unconfigured build still has a safe default rather than crashing.
 *
 * A value of `""`, whitespace-only, or a non-string is treated as absent so
 * an empty `process.env.API_ORIGIN` doesn't silently nuke the fallback.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_API_BASE_URL, resolveApiBaseUrl } from "../api-fetcher";

const INJECTED_KEY = "__HAP_API_ORIGIN__";

type GlobalWithInjected = typeof globalThis & { [INJECTED_KEY]?: unknown };

function setInjected(value: unknown): void {
  (globalThis as GlobalWithInjected)[INJECTED_KEY] = value;
}

function clearInjected(): void {
  delete (globalThis as GlobalWithInjected)[INJECTED_KEY];
}

describe("resolveApiBaseUrl()", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.API_ORIGIN;
    delete process.env.API_ORIGIN;
    clearInjected();
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.API_ORIGIN;
    } else {
      process.env.API_ORIGIN = savedEnv;
    }
    clearInjected();
  });

  it("returns the build-time injected constant when it is a non-empty string", () => {
    setInjected("https://hap-signal-workspace-staging.vercel.app");

    expect(resolveApiBaseUrl()).toBe("https://hap-signal-workspace-staging.vercel.app");
  });

  it("prefers the build-time injected constant over a runtime env override", () => {
    setInjected("https://hap-signal-workspace.vercel.app");
    process.env.API_ORIGIN = "http://localhost:3001";

    expect(resolveApiBaseUrl()).toBe("https://hap-signal-workspace.vercel.app");
  });

  it("falls back to process.env.API_ORIGIN when the build-time constant is missing", () => {
    process.env.API_ORIGIN = "http://localhost:3001";

    expect(resolveApiBaseUrl()).toBe("http://localhost:3001");
  });

  it("falls back to DEFAULT_API_BASE_URL when the build-time constant is an empty string", () => {
    setInjected("");

    expect(resolveApiBaseUrl()).toBe(DEFAULT_API_BASE_URL);
  });

  it("falls back to DEFAULT_API_BASE_URL when the build-time constant is whitespace only", () => {
    setInjected("   ");

    expect(resolveApiBaseUrl()).toBe(DEFAULT_API_BASE_URL);
  });

  it("falls back to DEFAULT_API_BASE_URL when nothing is configured", () => {
    // Neither injected constant nor env var — the safe prod default.
    expect(resolveApiBaseUrl()).toBe(DEFAULT_API_BASE_URL);
  });

  it("ignores a non-string injected value rather than coercing it", () => {
    // A misconfigured Vite `define` that passes a raw number instead of
    // `JSON.stringify(...)` would leave us with a non-string. Treat it as
    // absent — the fallback is always a string URL.
    setInjected(123);

    expect(resolveApiBaseUrl()).toBe(DEFAULT_API_BASE_URL);
  });
});
