/**
 * Server-side HubSpot CRM client.
 *
 * Holds the backend-only credential (`HUBSPOT_PRIVATE_APP_TOKEN`) used by
 * Slice 2 Step 9's signal/HubSpot-enrichment adapter to fetch CRM properties
 * on behalf of a tenant. The token NEVER reaches the UI extension or the
 * inbound request — it is resolved from the environment at client
 * construction time.
 *
 * Slice 2 scope:
 *   - Private-app token only (Slice 2 test portal 147062576).
 *   - Required scopes: `crm.objects.companies.read`, `crm.objects.contacts.read`.
 *   - Step 14 seed extends writes: `crm.objects.companies.write`,
 *     `crm.objects.contacts.write`, `crm.schemas.companies.write` (for the
 *     `hap_seed_marker` custom property the seed script uses for idempotency).
 *
 * OAuth refresh-token flow is deferred to Slice 3+ (marketplace distribution).
 *
 * @todo Slice 3: OAuth refresh-token flow when the app is distributed via the
 *   HubSpot marketplace; swap in per-install token storage and auto-refresh.
 */

import { loadEnv } from "@hap/config";

const HUBSPOT_API_ROOT = "https://api.hubapi.com";

/**
 * HUBSPOT_DEFINED primary association type id for `companies → contacts`.
 *
 * Source: https://developers.hubspot.com/docs/api-reference/latest/crm/objects/companies/guide
 * (retrieved 2026-04-15). The Step 14 seed uses the "default" label form of
 * the association PUT endpoint to avoid hardcoding numeric type ids:
 *   `PUT /crm/v3/objects/companies/{companyId}/associations/default/contacts/{contactId}`
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
 * Thin CRM client. Construct once per request/task (Step 9 will plumb it
 * behind the signal adapter). The token is bound at construction so callers
 * cannot accidentally pass in tenant-inbound credentials.
 */
/**
 * @todo Slice 3 (security audit advisory A2): add a startup health-check in
 * `apps/api/src/index.ts` that instantiates `HubSpotClient` once when the
 * Step 9 enrichment adapter ships, so a missing `HUBSPOT_PRIVATE_APP_TOKEN`
 * fails loud at process start instead of latent-until-first-call.
 */
export class HubSpotClient {
  private readonly token: string;

  constructor() {
    const env = loadEnv();
    const token = env.HUBSPOT_PRIVATE_APP_TOKEN;
    if (!token || token.length === 0) {
      throw new Error(
        "HubSpotClient: HUBSPOT_PRIVATE_APP_TOKEN is not set; required for server-to-HubSpot calls (Step 9 onward).",
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
      body: JSON.stringify({ properties }),
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
  async createContact(properties: Record<string, string>): Promise<HubSpotObjectResponse> {
    const url = `${HUBSPOT_API_ROOT}/crm/v3/objects/contacts`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ properties }),
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
      body: JSON.stringify({ properties }),
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
    const url = `${HUBSPOT_API_ROOT}/crm/v3/objects/companies/${encodeURIComponent(companyId)}/associations/default/contacts/${encodeURIComponent(contactId)}`;
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
  ): Promise<Array<HubSpotObjectResponse>> {
    const url = `${HUBSPOT_API_ROOT}/crm/v3/objects/companies/search`;
    const body = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: markerProperty,
              operator: "EQ",
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
