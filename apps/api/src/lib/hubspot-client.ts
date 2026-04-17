/**
 * Server-side HubSpot CRM client — Slice 3 per-tenant OAuth.
 *
 * Each install yields per-tenant access_token + refresh_token, stored
 * encrypted in the `tenant_hubspot_oauth` table via AES-256-GCM.
 *
 * Constructor takes `{ tenantId, db, fetch? }`:
 *   - `tenantId` — the tenant UUID from auth middleware.
 *   - `db` — a Drizzle handle (from `@hap/db createDatabase()`).
 *   - `fetch?` — optional injectable fetch for tests.
 *
 * Token lifecycle:
 *   - On first API call, queries `tenant_hubspot_oauth` for the tenant.
 *   - Decrypts the access token using `decryptProviderKey(tenantId, ciphertext)`.
 *   - Caches the decrypted token + `expires_at` to avoid re-decrypting.
 *   - If `expires_at - 60_000 < Date.now()`, proactively refreshes before use.
 *   - On any 401, refreshes and retries once (no infinite loop).
 *
 * See `docs/security/SECURITY.md` section 16 for the full migration plan.
 */

import { loadEnv } from "@hap/config";
import type { Database } from "@hap/db";
import { tenantHubspotOauth } from "@hap/db";
import { eq } from "drizzle-orm";
import { decryptProviderKey, encryptProviderKey } from "./encryption";
import { OAuthHttpError, refreshAccessToken } from "./oauth";
import { deactivateTenant } from "./tenant-lifecycle";

const HUBSPOT_API_ROOT = "https://api.hubapi.com";

/** Pre-expiry refresh window: refresh when token expires within 60 seconds. */
const PRE_EXPIRY_WINDOW_MS = 60_000;

/**
 * Minimal record shape returned by the CRM v3 object endpoints for the
 * paths this client uses.
 */
interface HubSpotObjectResponse {
  id: string;
  properties: Record<string, string>;
}

export type HubSpotEngagementType = "note" | "task" | "call" | "email" | "meeting";

export interface HubSpotEngagement {
  id: string;
  type: HubSpotEngagementType;
  timestamp: Date;
  content: string;
}

type AssociationReadResponse = {
  results?: Array<{
    from?: { id?: string };
    to?: Array<{ toObjectId?: string | number }>;
  }>;
};

type BatchReadResponse = {
  results?: Array<HubSpotObjectResponse>;
};

/**
 * HubSpot CRM v3 requires ALL property values to be strings on the wire.
 */
function coercePropertiesToStrings(
  properties: Record<string, string | boolean | number>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    out[key] = typeof value === "string" ? value : String(value);
  }
  return out;
}

function combineText(parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join("\n\n");
}

function parseTimestamp(raw: string | undefined): Date {
  if (!raw) return new Date(0);
  if (/^\d+$/.test(raw)) {
    const millis = Number(raw);
    if (Number.isFinite(millis)) {
      return new Date(millis);
    }
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

const ENGAGEMENT_OBJECTS: Array<{
  objectType: "notes" | "tasks" | "calls" | "emails" | "meetings";
  type: HubSpotEngagementType;
  properties: string[];
  renderContent: (properties: Record<string, string>) => string;
}> = [
  {
    objectType: "notes",
    type: "note",
    properties: ["hs_note_body", "hs_timestamp"],
    renderContent: (properties) => combineText([properties.hs_note_body]),
  },
  {
    objectType: "tasks",
    type: "task",
    properties: ["hs_task_subject", "hs_task_body", "hs_timestamp"],
    renderContent: (properties) =>
      combineText([properties.hs_task_subject, properties.hs_task_body]),
  },
  {
    objectType: "calls",
    type: "call",
    properties: ["hs_call_title", "hs_call_body", "hs_timestamp"],
    renderContent: (properties) => combineText([properties.hs_call_title, properties.hs_call_body]),
  },
  {
    objectType: "emails",
    type: "email",
    properties: ["hs_email_subject", "hs_email_text", "hs_timestamp"],
    renderContent: (properties) =>
      combineText([properties.hs_email_subject, properties.hs_email_text]),
  },
  {
    objectType: "meetings",
    type: "meeting",
    properties: ["hs_meeting_title", "hs_meeting_body", "hs_timestamp"],
    renderContent: (properties) =>
      combineText([properties.hs_meeting_title, properties.hs_meeting_body]),
  },
];

/** Cached decrypted token + expiry to avoid decrypting on every call. */
interface TokenCache {
  accessToken: string;
  expiresAt: Date;
}

export class TenantAccessRevokedError extends Error {
  constructor(message = "hubspot access revoked or app uninstalled for tenant") {
    super(message);
    this.name = "TenantAccessRevokedError";
  }
}

function isUnrecoverableRefreshFailure(error: unknown): error is OAuthHttpError {
  if (!(error instanceof OAuthHttpError) || error.status !== 400) {
    return false;
  }

  const body = error.body as { error?: unknown; error_description?: unknown } | null;
  const code = typeof body?.error === "string" ? body.error.toLowerCase() : "";
  const description =
    typeof body?.error_description === "string" ? body.error_description.toLowerCase() : "";

  return code === "invalid_grant" || description.includes("revoked");
}

/** Constructor options for per-tenant OAuth client. */
export interface HubSpotClientOptions {
  tenantId: string;
  db: Database;
  fetch?: typeof globalThis.fetch;
}

/**
 * Per-tenant HubSpot CRM client. Resolves OAuth tokens from the database,
 * decrypts them, caches locally, and auto-refreshes on expiry or 401.
 */
export class HubSpotClient {
  private readonly tenantId: string;
  private readonly db: Database;
  private readonly fetchImpl: typeof globalThis.fetch;
  private tokenCache: TokenCache | null = null;
  private refreshInFlight: Promise<string> | null = null;

  constructor(options: HubSpotClientOptions) {
    this.tenantId = options.tenantId;
    this.db = options.db;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  /**
   * Resolve the current access token. Queries DB on first call, then uses
   * cache. Proactively refreshes if within the pre-expiry window.
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid (outside pre-expiry window)
    if (
      this.tokenCache &&
      this.tokenCache.expiresAt.getTime() - PRE_EXPIRY_WINDOW_MS > Date.now()
    ) {
      return this.tokenCache.accessToken;
    }

    // Query DB for the tenant's OAuth row
    const row = await this.db.query.tenantHubspotOauth.findFirst({
      where: eq(tenantHubspotOauth.tenantId, this.tenantId),
    });

    if (!row) {
      throw new TenantAccessRevokedError();
    }

    // Check if token is within the pre-expiry window (or already expired)
    if (row.expiresAt.getTime() - PRE_EXPIRY_WINDOW_MS < Date.now()) {
      const refreshed = await this.serializedRefresh(row.refreshTokenEncrypted);
      return refreshed;
    }

    // Decrypt and cache
    const accessToken = decryptProviderKey(this.tenantId, row.accessTokenEncrypted);
    this.tokenCache = {
      accessToken,
      expiresAt: row.expiresAt,
    };
    return accessToken;
  }

  /**
   * Serialized refresh — ensures only one refresh runs at a time per client
   * instance. Concurrent callers await the same in-flight promise instead
   * of racing (HubSpot rotates refresh tokens, so a second concurrent
   * refresh with the old token would fail).
   */
  private async serializedRefresh(refreshTokenEncrypted: string): Promise<string> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    this.refreshInFlight = this.performTokenRefresh(refreshTokenEncrypted).finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  /**
   * Refresh the access token, persist rotated tokens to DB, update cache.
   */
  private async performTokenRefresh(refreshTokenEncrypted: string): Promise<string> {
    const env = loadEnv();
    const refreshToken = decryptProviderKey(this.tenantId, refreshTokenEncrypted);

    let result: Awaited<ReturnType<typeof refreshAccessToken>>;
    try {
      result = await refreshAccessToken({
        clientId: env.HUBSPOT_CLIENT_ID,
        clientSecret: env.HUBSPOT_CLIENT_SECRET,
        refreshToken,
        // Use the injected fetch for refresh calls too
        fetch: this.fetchImpl,
      });
    } catch (error) {
      if (isUnrecoverableRefreshFailure(error)) {
        try {
          await deactivateTenant({
            db: this.db,
            tenantId: this.tenantId,
            reason: "oauth_refresh_failed",
          });
        } catch (deactivateError) {
          console.error("hubspot_client.oauth_refresh_deactivate_failed", {
            tenantId: this.tenantId,
            errorClass:
              deactivateError instanceof Error
                ? deactivateError.constructor.name
                : typeof deactivateError,
          });
        }
        throw new TenantAccessRevokedError();
      }
      throw error;
    }

    const newExpiresAt = new Date(Date.now() + result.expiresIn * 1000);

    // Encrypt + persist the rotated tokens
    const newAccessTokenEncrypted = encryptProviderKey(this.tenantId, result.accessToken);
    const newRefreshTokenEncrypted = encryptProviderKey(this.tenantId, result.refreshToken);

    await this.db
      .update(tenantHubspotOauth)
      .set({
        accessTokenEncrypted: newAccessTokenEncrypted,
        refreshTokenEncrypted: newRefreshTokenEncrypted,
        expiresAt: newExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(tenantHubspotOauth.tenantId, this.tenantId));

    // Update local cache
    this.tokenCache = {
      accessToken: result.accessToken,
      expiresAt: newExpiresAt,
    };

    return result.accessToken;
  }

  /**
   * Execute a fetch request with the tenant's Bearer token. On 401, refresh
   * and retry once. On second 401, throw (no infinite loop).
   */
  private async authenticatedFetch(
    url: string,
    init: RequestInit,
    isRetry = false,
  ): Promise<Response> {
    const token = await this.getAccessToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);

    const res = await this.fetchImpl(url, { ...init, headers });

    if (res.status === 401 && !isRetry) {
      // Invalidate cache and refresh
      this.tokenCache = null;

      // Re-fetch the DB row to get the current refresh token
      const row = await this.db.query.tenantHubspotOauth.findFirst({
        where: eq(tenantHubspotOauth.tenantId, this.tenantId),
      });

      if (!row) {
        throw new TenantAccessRevokedError();
      }

      await this.serializedRefresh(row.refreshTokenEncrypted);
      return this.authenticatedFetch(url, init, true);
    }

    return res;
  }

  // ---------------------------------------------------------------------------
  // Public API — signatures unchanged from Slice 2
  // ---------------------------------------------------------------------------

  async getCompanyProperties(
    companyId: string,
    properties: readonly string[],
  ): Promise<Record<string, string>> {
    const params = new URLSearchParams();
    for (const p of properties) params.append("properties", p);

    const url = `${HUBSPOT_API_ROOT}/crm/v3/objects/companies/${encodeURIComponent(companyId)}?${params.toString()}`;

    const res = await this.authenticatedFetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      throw new Error(`hubspot: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as {
      properties?: Record<string, string>;
    };
    return json.properties ?? {};
  }

  async getCompanyEngagements(companyId: string): Promise<HubSpotEngagement[]> {
    const engagements: HubSpotEngagement[] = [];

    for (const config of ENGAGEMENT_OBJECTS) {
      const associationUrl = `${HUBSPOT_API_ROOT}/crm/v4/associations/companies/${config.objectType}/batch/read`;
      const associationRes = await this.authenticatedFetch(associationUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          inputs: [{ id: companyId }],
        }),
      });

      if (!associationRes.ok) {
        throw new Error(`hubspot: ${associationRes.status} ${associationRes.statusText}`);
      }

      const associationJson = (await associationRes.json()) as AssociationReadResponse;
      const engagementIds = (associationJson.results ?? [])
        .flatMap((result) => result.to ?? [])
        .map((item) => (item.toObjectId === undefined ? "" : String(item.toObjectId)))
        .filter((id) => id.length > 0);

      if (engagementIds.length === 0) {
        continue;
      }

      const batchUrl = `${HUBSPOT_API_ROOT}/crm/v3/objects/${config.objectType}/batch/read`;
      const batchRes = await this.authenticatedFetch(batchUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          inputs: engagementIds.map((id) => ({ id })),
          properties: config.properties,
        }),
      });

      if (!batchRes.ok) {
        throw new Error(`hubspot: ${batchRes.status} ${batchRes.statusText}`);
      }

      const batchJson = (await batchRes.json()) as BatchReadResponse;
      for (const row of batchJson.results ?? []) {
        const properties = row.properties ?? {};
        const content = config.renderContent(properties);
        if (!content) {
          continue;
        }

        engagements.push({
          id: row.id,
          type: config.type,
          timestamp: parseTimestamp(properties.hs_timestamp),
          content,
        });
      }
    }

    return engagements;
  }

  async createCompany(
    properties: Record<string, string | boolean | number>,
  ): Promise<HubSpotObjectResponse> {
    const url = `${HUBSPOT_API_ROOT}/crm/v3/objects/companies`;
    const res = await this.authenticatedFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        properties: coercePropertiesToStrings(properties),
      }),
    });

    if (!res.ok) {
      throw new Error(`hubspot: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as HubSpotObjectResponse;
    return { id: json.id, properties: json.properties ?? {} };
  }

  async findContactByEmail(email: string): Promise<HubSpotObjectResponse | null> {
    const url = `${HUBSPOT_API_ROOT}/crm/v3/objects/contacts/search`;
    const res = await this.authenticatedFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [{ propertyName: "email", operator: "EQ", value: email }],
          },
        ],
        properties: ["email", "firstname", "lastname"],
        limit: 1,
      }),
    });
    if (!res.ok) {
      throw new Error(`hubspot: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as {
      results?: Array<HubSpotObjectResponse>;
    };
    return json.results?.[0] ?? null;
  }

  async createContact(properties: Record<string, string>): Promise<HubSpotObjectResponse> {
    const url = `${HUBSPOT_API_ROOT}/crm/v3/objects/contacts`;
    const res = await this.authenticatedFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        properties: coercePropertiesToStrings(properties),
      }),
    });

    if (!res.ok) {
      throw new Error(`hubspot: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as HubSpotObjectResponse;
    return { id: json.id, properties: json.properties ?? {} };
  }

  async updateCompany(
    companyId: string,
    properties: Record<string, string | boolean | number>,
  ): Promise<HubSpotObjectResponse> {
    const url = `${HUBSPOT_API_ROOT}/crm/v3/objects/companies/${encodeURIComponent(companyId)}`;
    const res = await this.authenticatedFetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        properties: coercePropertiesToStrings(properties),
      }),
    });

    if (!res.ok) {
      throw new Error(`hubspot: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as HubSpotObjectResponse;
    return { id: json.id, properties: json.properties ?? {} };
  }

  async associateContactWithCompany(companyId: string, contactId: string): Promise<void> {
    const url = `${HUBSPOT_API_ROOT}/crm/v4/objects/companies/${encodeURIComponent(companyId)}/associations/default/contacts/${encodeURIComponent(contactId)}`;
    const res = await this.authenticatedFetch(url, {
      method: "PUT",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      throw new Error(`hubspot: ${res.status} ${res.statusText}`);
    }
  }

  async searchCompaniesByMarker(
    markerProperty: string,
    markerValue: string,
    operator: "EQ" | "CONTAINS_TOKEN" = "EQ",
  ): Promise<Array<HubSpotObjectResponse>> {
    const url = `${HUBSPOT_API_ROOT}/crm/v3/objects/companies/search`;
    const body = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: markerProperty,
              operator,
              value: markerValue,
            },
          ],
        },
      ],
      properties: [markerProperty, "name", "domain", "hs_is_target_account"],
      limit: 100,
    };

    const res = await this.authenticatedFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`hubspot: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as {
      results?: Array<HubSpotObjectResponse>;
    };
    return (json.results ?? []).map((r) => ({
      id: r.id,
      properties: r.properties ?? {},
    }));
  }
}
