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
 *
 * OAuth refresh-token flow is deferred to Slice 3+ (marketplace distribution).
 *
 * @todo Slice 3: OAuth refresh-token flow when the app is distributed via the
 *   HubSpot marketplace; swap in per-install token storage and auto-refresh.
 */

import { loadEnv } from "@hap/config";

const HUBSPOT_API_ROOT = "https://api.hubapi.com";

/**
 * Thin CRM client. Construct once per request/task (Step 9 will plumb it
 * behind the signal adapter). The token is bound at construction so callers
 * cannot accidentally pass in tenant-inbound credentials.
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
}
