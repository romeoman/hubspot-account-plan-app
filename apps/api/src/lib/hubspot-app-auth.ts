/**
 * Slice 11 Task 2 — HubSpot app-level auth client (client-credentials flow).
 *
 * Provides a single export — {@link getAppAccessToken} — that returns a
 * bearer token scoped to the HubSpot webhooks-journal subscriptions API.
 *
 * Behavior locked by `docs/slice-11-preflight-notes.md`:
 *   - POST https://api.hubapi.com/oauth/v1/token,
 *     Content-Type: application/x-www-form-urlencoded,
 *     form fields: grant_type=client_credentials, client_id, client_secret,
 *     scope=<space-separated read + write scopes>.
 *   - Response `{ access_token, expires_in, token_type }` is cached in-memory.
 *     Cache TTL trusts `expires_in` from the response and subtracts 60s skew.
 *   - `HUBSPOT_APP_ID` is required (for log correlation) but is NOT sent to
 *     the token endpoint.
 *
 * Secrets posture:
 *   - `HUBSPOT_APP_CLIENT_SECRET` and the returned bearer token MUST NOT
 *     appear in logs, thrown error messages, or response bodies re-thrown
 *     to callers.
 *   - Missing-env errors name the variable but never its value.
 *   - Non-2xx responses surface status code + HubSpot correlationId only.
 */

export const HUBSPOT_APP_TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";

export const HUBSPOT_APP_AUTH_SCOPES =
  "developer.webhooks_journal.subscriptions.read developer.webhooks_journal.subscriptions.write";

const SKEW_MS = 60_000;

export class AppAuthError extends Error {
  readonly status?: number;
  readonly correlationId?: string;
  constructor(message: string, opts?: { status?: number; correlationId?: string }) {
    super(message);
    this.name = "AppAuthError";
    this.status = opts?.status;
    this.correlationId = opts?.correlationId;
  }
}

type CacheEntry = {
  clientId: string;
  token: string;
  expiresAtMs: number;
};

// Module-scoped single-slot cache. The app-auth identity is app-global, so
// one slot is enough. We still key on clientId so a clientId change in the
// environment forces a re-fetch rather than returning a stale token for the
// previous app identity.
let cache: CacheEntry | null = null;

/** Test-only: clear the module-scoped cache. Not exported from the package index. */
export function __resetAppAuthCache(): void {
  cache = null;
}

export type GetAppAccessTokenOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
};

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new AppAuthError(`missing required env var: ${name}`);
  }
  return value;
}

type HubSpotTokenResponseBody = {
  access_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
};

async function safeReadCorrelationId(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.clone().json()) as { correlationId?: unknown };
    if (typeof body.correlationId === "string") return body.correlationId;
  } catch {
    // Non-JSON body — ignore. We will not echo the body itself.
  }
  return undefined;
}

/**
 * Fetch (or return cached) an app-level bearer token for the HubSpot
 * client-credentials flow.
 *
 * The returned token is suitable for the webhooks-journal subscriptions
 * management API (`/webhooks-journal/subscriptions/2026-03`).
 *
 * @throws {AppAuthError} when required env is missing, when the token
 *   endpoint returns non-2xx, or when the underlying fetch rejects. Error
 *   messages NEVER include the client secret or the bearer token.
 */
export async function getAppAccessToken(options: GetAppAccessTokenOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowMs = options.nowMs ?? Date.now;

  // Validate env eagerly so a cached token can never mask a subsequent
  // mis-configuration.
  const clientId = requireEnv(env, "HUBSPOT_APP_CLIENT_ID");
  const clientSecret = requireEnv(env, "HUBSPOT_APP_CLIENT_SECRET");
  requireEnv(env, "HUBSPOT_APP_ID");

  const now = nowMs();
  if (cache && cache.clientId === clientId && cache.expiresAtMs > now) {
    return cache.token;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: HUBSPOT_APP_AUTH_SCOPES,
  });

  let response: Response;
  try {
    response = await fetchImpl(HUBSPOT_APP_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch {
    // Intentionally drop the underlying error message — it may echo back
    // request bodies (some runtimes include the POST body in connection
    // error strings). Preserve only the fact that the network call failed.
    throw new AppAuthError("hubspot token endpoint network error");
  }

  if (!response.ok) {
    const correlationId = await safeReadCorrelationId(response);
    throw new AppAuthError(`hubspot token endpoint returned ${response.status}`, {
      status: response.status,
      correlationId,
    });
  }

  let parsed: HubSpotTokenResponseBody;
  try {
    parsed = (await response.json()) as HubSpotTokenResponseBody;
  } catch {
    throw new AppAuthError("hubspot token endpoint returned non-json body");
  }
  const accessToken = parsed.access_token;
  const expiresIn = parsed.expires_in;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new AppAuthError("hubspot token endpoint response missing access_token");
  }
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new AppAuthError("hubspot token endpoint response missing valid expires_in");
  }

  const effectiveLifetimeMs = Math.max(expiresIn * 1000 - SKEW_MS, 0);
  cache = {
    clientId,
    token: accessToken,
    expiresAtMs: now + effectiveLifetimeMs,
  };
  return accessToken;
}
