/**
 * Real `hubspot.fetch()`-backed snapshot fetcher (Slice 2 Step 11).
 *
 * HubSpot docs reference: `/websites/developers_hubspot` (Context7), topic
 * "hubspot.fetch fetching data" — retrieved 2026-04-15.
 *
 * Key contract points from the docs:
 *   - `hubspot.fetch(url, options?)` returns `Promise<Response>`.
 *   - `options` supports `{ method, body, timeout }` ONLY. Custom headers
 *     (Authorization, x-portal-id, etc.) are NOT honored.
 *   - HubSpot signs every outbound request server-side and injects the
 *     authenticated portalId / userId into the signed payload. The backend
 *     tenant-resolution middleware (Slice 2 Step 4) reads these from the
 *     signed payload — NOT from any client-supplied header.
 *   - The destination URL MUST appear in `permittedUrls.fetch[]` inside
 *     `apps/hubspot-project/src/app/app-hsmeta.json`. That file lists the
 *     template variable `${API_ORIGIN}`, which HubSpot expands at upload
 *     time from the active profile (hsprofile.*.json). The Vite build
 *     passes the matching `process.env.API_ORIGIN` through to the bundled
 *     JS via `define`, and `resolveApiBaseUrl()` (below) reads it at
 *     runtime. The scaffold anti-regression test keeps the placeholder +
 *     profile variable contract intact.
 *   - Per-account outbound limits: 20 concurrent requests, 15s timeout cap,
 *     1MB payload cap. The snapshot route is well inside these bounds.
 *
 * This module intentionally does NOT import from @hap/config or mutate the
 * snapshot shape; it is a thin transport wrapper. The caller (`useSnapshot`)
 * runs zod validation on the returned value.
 */
import { hubspot } from "@hubspot/ui-extensions";
import type { SnapshotFetcher } from "./use-snapshot";

/**
 * Hard-coded prod fallback. Only reached when both the build-time
 * `__HAP_API_ORIGIN__` injection and the runtime `process.env.API_ORIGIN`
 * escape hatch are absent — see {@link resolveApiBaseUrl}. Kept as a string
 * literal (not derived from env) so a misconfigured build is still safe.
 */
export const DEFAULT_API_BASE_URL = "https://hap-signal-workspace.vercel.app";

/**
 * Build-time constant injected by Vite `define` from
 * `process.env.API_ORIGIN` at `vite build` time. The HubSpot project build
 * wrapper sets the env per-profile before invoking vite, so each uploaded
 * bundle literalizes its own target origin. At runtime inside the HubSpot
 * extension host, this symbol is replaced with a string literal (e.g.,
 * `"https://hap-signal-workspace-staging.vercel.app"`) by the time the
 * code executes, and the `typeof` guard is evaluated against that literal.
 */
declare const __HAP_API_ORIGIN__: string | undefined;

/**
 * Resolve the API origin the extension fetcher should target.
 *
 * Precedence (highest wins):
 *   1. `__HAP_API_ORIGIN__` — build-time substitution (the production path).
 *   2. `process.env.API_ORIGIN` — runtime override for Node environments
 *      (vitest, SSR). `process` is undefined inside the HubSpot extension
 *      host, so this branch is Node-only.
 *   3. {@link DEFAULT_API_BASE_URL} — safe prod default.
 *
 * A value of `""`, whitespace-only, or a non-string is treated as absent.
 * This matters because Vite `define` must emit *some* replacement for
 * `__HAP_API_ORIGIN__` even when the env is unset; we emit `""` and rely on
 * this function to fall through.
 */
export function resolveApiBaseUrl(): string {
  const injected =
    typeof __HAP_API_ORIGIN__ !== "undefined" ? (__HAP_API_ORIGIN__ as unknown) : undefined;
  if (typeof injected === "string" && injected.trim().length > 0) {
    return injected;
  }

  if (typeof process !== "undefined") {
    const envOrigin = process.env?.API_ORIGIN;
    if (typeof envOrigin === "string" && envOrigin.trim().length > 0) {
      return envOrigin;
    }
  }

  return DEFAULT_API_BASE_URL;
}

/**
 * Transport-layer error thrown when the snapshot API returns a non-2xx
 * response. Preserves the HTTP status so the UI can distinguish auth
 * failures (401/403) from server errors (500+).
 */
export class ApiFetcherError extends Error {
  public readonly status: number;
  public readonly statusText: string;

  constructor(status: number, statusText: string) {
    super(`snapshot-fetch-failed: ${status} ${statusText}`);
    this.name = "ApiFetcherError";
    this.status = status;
    this.statusText = statusText;
  }
}

export type HubSpotApiFetcherDeps = {
  /**
   * API origin to target. Defaults to the result of {@link resolveApiBaseUrl},
   * which honors the build-time injected origin first, then
   * `process.env.API_ORIGIN`, then {@link DEFAULT_API_BASE_URL}. Tests that
   * want a deterministic origin pass it explicitly.
   */
  baseUrl?: string;
};

/**
 * Build the real snapshot fetcher used by `useSnapshot` in production.
 *
 * Usage:
 *   const fetcher = createHubSpotApiFetcher();
 *   useSnapshot({ companyId, fetcher });
 *
 * The returned function matches the `SnapshotFetcher` contract: it returns
 * the raw parsed JSON body on success, and rejects on non-2xx / network
 * failure. Schema validation + Date coercion happens in `useSnapshot`.
 */
export function createHubSpotApiFetcher(deps: HubSpotApiFetcherDeps = {}): SnapshotFetcher {
  const baseUrl = deps.baseUrl ?? resolveApiBaseUrl();

  return async function fetchSnapshot(companyId: string): Promise<unknown> {
    const url = `${baseUrl}/api/snapshot/${companyId}`;

    // NOTE: NO `headers` key. Although HubSpotFetchOptions permits a
    // `headers` map, we intentionally omit it: HubSpot signs every outbound
    // request server-side and injects the authenticated portalId / userId
    // into the signed payload. The backend tenant-resolution middleware
    // (Step 4) reads these from the signed payload — never from a
    // client-supplied header. Sending an Authorization / x-portal-id
    // header risks confusing the middleware or letting a compromised
    // client impersonate a different portal.
    //
    // `body` is passed as an object per the HubSpotFetchOptions type; the
    // SDK serializes it before handing the request to HubSpot's outbound
    // proxy.
    const response = await hubspot.fetch(url, {
      method: "POST",
      body: { companyId },
    });

    if (!response.ok) {
      throw new ApiFetcherError(response.status, response.statusText);
    }

    return await response.json();
  };
}
