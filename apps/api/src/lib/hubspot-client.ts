/**
 * Server-side HubSpot CRM client — Slice 2 dev-only bridge.
 *
 * DEV-ONLY, SINGLE-PORTAL. This client reads `HUBSPOT_DEV_PORTAL_TOKEN` from
 * the environment — a long-lived, single-portal legacy private-app token. It
 * exists ONLY because Slice 2's app is configured `auth.type: "static"` +
 * `distribution: "private"`, which per HubSpot docs is installable on the
 * dev portal only.
 *
 * Slice 3 replaces this entirely:
 *   - App switches to `auth.type: "oauth"` + `distribution: "marketplace"`
 *     (or `"private"` with allowlist for pilot).
 *   - Each install yields per-tenant access_token + refresh_token, stored
 *     encrypted in the `tenants` table via the Slice 2 AES-256-GCM envelope.
 *   - Constructor takes a `tenantId`, reads that tenant's token, refreshes
 *     on 401 using the refresh_token, swaps the bearer per request.
 *   - `HUBSPOT_DEV_PORTAL_TOKEN` env var is REMOVED.
 *
 * See `docs/security/SECURITY.md` §16 for the full migration plan.
 *
 * The token NEVER reaches the UI extension or the inbound request — it is
 * resolved from the environment at client construction time only.
 *
 * Slice 2 scope:
 *   - Required scopes: `crm.objects.companies.read`, `crm.objects.contacts.read`.
 *   - Step 14 seed extends writes: `crm.objects.companies.write`,
 *     `crm.objects.contacts.write` (write scopes granted on the dev portal's
 *     private-app settings page).
 *
 * @todo Slice 3: replace `HUBSPOT_DEV_PORTAL_TOKEN` env-var path with
 *   per-tenant OAuth tokens from the `tenants` table (encrypted via
 *   Step 3 AES-256-GCM). See SECURITY.md §16.
 */

import { loadEnv } from "@hap/config";

const HUBSPOT_API_ROOT = "https://api.hubapi.com";

/**
 * HUBSPOT_DEFINED primary association type id for `companies → contacts`.
 *
 * Source: https://developers.hubspot.com/docs/api-reference/latest/crm/objects/companies/guide
 * (retrieved 2026-04-15). The Step 14 seed uses the "default" label form of
 * the association PUT endpoint to avoid hardcoding numeric type ids:
 *   `PUT /crm/v4/objects/companies/{companyId}/associations/default/contacts/{contactId}`
 */

/**
 * Minimal record shape returned by the CRM v3 object endpoints for the
 * paths this client uses.
 */
interface HubSpotObjectResponse {
  id: string;
  properties: Record<string, string>;
}

/**
 * HubSpot CRM v3 requires ALL property values to be strings on the wire —
 * native booleans and numbers are rejected with a 400 PROPERTY_VALUE_INVALID
 * even for properties that semantically hold boolean/number data (the server
 * parses the string back to the target type per the schema). We coerce
 * at this boundary so callers can pass idiomatic JS values.
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

/**
 * Thin CRM client. Construct once per request/task (Step 9 will plumb it
 * behind the signal adapter). The token is bound at construction so callers
 * cannot accidentally pass in tenant-inbound credentials.
 */
/**
 * @todo Slice 3 (security audit advisory A2): add a startup health-check in
 * `apps/api/src/index.ts` that instantiates `HubSpotClient` once when the
 * Step 9 enrichment adapter ships, so a missing `HUBSPOT_DEV_PORTAL_TOKEN`
 * fails loud at process start instead of latent-until-first-call.
 */
export class HubSpotClient {
  private readonly token: string;

  constructor() {
    const env = loadEnv();
    const token = env.HUBSPOT_DEV_PORTAL_TOKEN;
    if (!token || token.length === 0) {
      throw new Error(
        "HubSpotClient: HUBSPOT_DEV_PORTAL_TOKEN is not set; required for server-to-HubSpot calls (Step 9 onward).",
      );
    }
    this.token = token;
  }

  /**
   * Fetch a company record's properties via the CRM v3 API.
   *
   * Returns a plain `{ propertyName: value }` map. Missing properties are
   * simply absent from the response object. Step 9 will wire real semantics
   * (caching, rate-limit handling); for Step 4 we only lock in the token
   * and header shape.
   *
   * @throws on non-2xx responses. The error message does NOT include the
   *   bearer token.
   */
  async getCompanyProperties(
    companyId: string,
    properties: readonly string[],
  ): Promise<Record<string, string>> {
    const params = new URLSearchParams();
    for (const p of properties) params.append("properties", p);

    const url = `${HUBSPOT_API_ROOT}/crm/v3/objects/companies/${encodeURIComponent(companyId)}?${params.toString()}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      // Never include the token in the error. We also avoid echoing the
      // response body which could contain server-side hints.
      throw new Error(`hubspot: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as {
      properties?: Record<string, string>;
    };
    return json.properties ?? {};
  }

  /**
   * Create a company via `POST /crm/v3/objects/companies`.
   *
   * Used by the Step 14 seed script. Accepts string/boolean/number property
   * values — HubSpot stringifies everything server-side, but the caller is
   * in charge of matching the target property's declared type (e.g.,
   * `hs_is_target_account` is a boolean).
   *
   * @throws on non-2xx. Error message excludes the bearer token.
   */
  async createCompany(
    properties: Record<string, string | boolean | number>,
  ): Promise<HubSpotObjectResponse> {
    const url = `${HUBSPOT_API_ROOT}/crm/v3/objects/companies`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
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

  /**
   * Create a contact via `POST /crm/v3/objects/contacts`. Used by the seed
   * script; associations are applied in a follow-up call for clarity.
   *
   * @throws on non-2xx. Error message excludes the bearer token.
   */
  /**
   * Search for a contact by exact email match. Used by the seed script to
   * make contact creation idempotent across reruns (HubSpot rejects
   * duplicate emails with 409 Conflict).
   *
   * Endpoint: `POST /crm/v3/objects/contacts/search`.
   *
   * @throws on non-2xx. Error message excludes the bearer token.
   */
  async findContactByEmail(email: string): Promise<HubSpotObjectResponse | null> {
    const url = `${HUBSPOT_API_ROOT}/crm/v3/objects/contacts/search`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
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
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
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

  /**
   * Update a company's properties via `PATCH /crm/v3/objects/companies/{id}`.
   *
   * Used by the seed script when the marker lookup finds an existing row.
   *
   * @throws on non-2xx. Error message excludes the bearer token.
   */
  async updateCompany(
    companyId: string,
    properties: Record<string, string | boolean | number>,
  ): Promise<HubSpotObjectResponse> {
    const url = `${HUBSPOT_API_ROOT}/crm/v3/objects/companies/${encodeURIComponent(companyId)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.token}`,
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

  /**
   * Associate an existing contact with an existing company via the default
   * (primary) HUBSPOT_DEFINED association type.
   *
   * Uses the `default` label form of the PUT endpoint so we don't have to
   * hardcode the numeric association-type id (which has changed historically).
   * Source: HubSpot CRM v3 Companies guide, retrieved 2026-04-15.
   *
   * @throws on non-2xx. Error message excludes the bearer token.
   */
  async associateContactWithCompany(companyId: string, contactId: string): Promise<void> {
    const url = `${HUBSPOT_API_ROOT}/crm/v4/objects/companies/${encodeURIComponent(companyId)}/associations/default/contacts/${encodeURIComponent(contactId)}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`hubspot: ${res.status} ${res.statusText}`);
    }
  }

  /**
   * Search for companies by an exact-match value on a marker property.
   *
   * Used by the Step 14 seed script to find previously-seeded rows (keyed
   * by a known property name + constant value) so a rerun can UPDATE
   * instead of creating duplicate companies.
   *
   * Endpoint: `POST /crm/v3/objects/companies/search`.
   *
   * @throws on non-2xx. Error message excludes the bearer token.
   */
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

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
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
