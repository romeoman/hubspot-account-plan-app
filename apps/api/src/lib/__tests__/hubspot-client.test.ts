/**
 * Tests for the server-side HubSpot CRM client.
 *
 * Slice 2 Step 4 established the constructor contract and the
 * Authorization-header wiring for `getCompanyProperties`. Step 14 extends
 * the client with write + search methods consumed by the test-portal
 * seed script (`scripts/seed-hubspot-test-portal.ts`).
 *
 * All tests stub `fetch`; no live HubSpot calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HubSpotClient } from "../hubspot-client";

const ORIGINAL_TOKEN = process.env.HUBSPOT_DEV_PORTAL_TOKEN;

beforeEach(() => {
  process.env.HUBSPOT_DEV_PORTAL_TOKEN = "pat-test-abc-123";
});

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env.HUBSPOT_DEV_PORTAL_TOKEN;
  } else {
    process.env.HUBSPOT_DEV_PORTAL_TOKEN = ORIGINAL_TOKEN;
  }
  vi.restoreAllMocks();
});

describe("HubSpotClient", () => {
  it("constructor throws when HUBSPOT_DEV_PORTAL_TOKEN is missing", () => {
    delete process.env.HUBSPOT_DEV_PORTAL_TOKEN;
    expect(() => new HubSpotClient()).toThrowError(/HUBSPOT_DEV_PORTAL_TOKEN/);
  });

  it("constructor throws when HUBSPOT_DEV_PORTAL_TOKEN is empty string", () => {
    process.env.HUBSPOT_DEV_PORTAL_TOKEN = "";
    expect(() => new HubSpotClient()).toThrowError(/HUBSPOT_DEV_PORTAL_TOKEN/);
  });

  it("getCompanyProperties calls fetch with Bearer token and parses properties", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "123",
          properties: { name: "Acme", domain: "acme.test" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const client = new HubSpotClient();
    const props = await client.getCompanyProperties("123", ["name", "domain"]);

    expect(props).toEqual({ name: "Acme", domain: "acme.test" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/crm\/v3\/objects\/companies\/123/);
    expect(url).toContain("properties=name");
    expect(url).toContain("properties=domain");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer pat-test-abc-123");
  });

  it("getCompanyProperties throws on non-2xx without leaking the token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("forbidden", { status: 403 }));
    const client = new HubSpotClient();
    await expect(client.getCompanyProperties("123", ["name"])).rejects.toThrow(/hubspot: 403/i);
    // The thrown message must NOT include the token.
    try {
      await client.getCompanyProperties("123", ["name"]);
    } catch (err) {
      expect((err as Error).message).not.toContain("pat-test-abc-123");
    }
  });

  it("createCompany POSTs to /crm/v3/objects/companies with properties body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "co-101",
          properties: {
            name: "Slice2-EligibleStrong-AcmeCorp",
            hs_is_target_account: "true",
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new HubSpotClient();
    const result = await client.createCompany({
      name: "Slice2-EligibleStrong-AcmeCorp",
      domain: "acme.test",
      hs_is_target_account: true,
    });

    expect(result.id).toBe("co-101");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.hubapi.com/crm/v3/objects/companies");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer pat-test-abc-123");
    expect(headers.get("content-type")).toBe("application/json");
    const body = JSON.parse(init.body as string);
    // HubSpot CRM v3 requires ALL property values to be strings on the
    // wire (server parses back per the schema). Client coerces booleans
    // and numbers at the boundary.
    expect(body).toEqual({
      properties: {
        name: "Slice2-EligibleStrong-AcmeCorp",
        domain: "acme.test",
        hs_is_target_account: "true",
      },
    });
  });

  it("createCompany throws on non-2xx without leaking token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    const client = new HubSpotClient();
    try {
      await client.createCompany({ name: "x" });
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error).message).toMatch(/hubspot: 500/);
      expect((err as Error).message).not.toContain("pat-test-abc-123");
    }
  });

  it("createContact POSTs to /crm/v3/objects/contacts", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "ct-7", properties: { email: "a@b.test" } }), {
        status: 201,
      }),
    );
    const client = new HubSpotClient();
    const result = await client.createContact({
      firstname: "Alex",
      lastname: "Champion",
      email: "alex@acme.test",
      jobtitle: "VP Engineering",
    });

    expect(result.id).toBe("ct-7");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.hubapi.com/crm/v3/objects/contacts");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.properties.firstname).toBe("Alex");
    expect(body.properties.email).toBe("alex@acme.test");
  });

  it("updateCompany PATCHes to /crm/v3/objects/companies/{id}", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "co-55", properties: { name: "Updated" } }), {
        status: 200,
      }),
    );
    const client = new HubSpotClient();
    await client.updateCompany("co-55", {
      name: "Updated",
      hs_is_target_account: false,
    });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.hubapi.com/crm/v3/objects/companies/co-55");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string);
    // Boolean coerced to "false" string at the wire boundary.
    expect(body.properties.hs_is_target_account).toBe("false");
  });

  it("associateContactWithCompany PUTs to the default-association endpoint", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));
    const client = new HubSpotClient();
    await client.associateContactWithCompany("co-1", "ct-9");

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.hubapi.com/crm/v4/objects/companies/co-1/associations/default/contacts/ct-9",
    );
    expect(init.method).toBe("PUT");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer pat-test-abc-123");
  });

  it("associateContactWithCompany throws on non-2xx without leaking token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 404 }));
    const client = new HubSpotClient();
    try {
      await client.associateContactWithCompany("co-1", "ct-9");
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error).message).toMatch(/hubspot: 404/);
      expect((err as Error).message).not.toContain("pat-test-abc-123");
    }
  });

  it("searchCompaniesByMarker POSTs filterGroups and returns results array", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "co-A",
              properties: { name: "Slice2-EligibleStrong-AcmeCorp" },
            },
            { id: "co-B", properties: { name: "Slice2-Empty-GammaCo" } },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = new HubSpotClient();
    const rows = await client.searchCompaniesByMarker("hap_seed_marker", "slice2-walkthrough-v1");

    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBe("co-A");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.hubapi.com/crm/v3/objects/companies/search");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.filterGroups[0].filters[0]).toEqual({
      propertyName: "hap_seed_marker",
      operator: "EQ",
      value: "slice2-walkthrough-v1",
    });
  });

  it("searchCompaniesByMarker returns empty array when no results", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const client = new HubSpotClient();
    const rows = await client.searchCompaniesByMarker("hap_seed_marker", "unknown");
    expect(rows).toEqual([]);
  });

  it("findContactByEmail returns the first match", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "ct-1",
              properties: { email: "a@b.example.com", firstname: "A" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = new HubSpotClient();
    const contact = await client.findContactByEmail("a@b.example.com");
    expect(contact?.id).toBe("ct-1");
  });

  it("findContactByEmail returns null when no match", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    const client = new HubSpotClient();
    const contact = await client.findContactByEmail("ghost@nowhere.example.com");
    expect(contact).toBeNull();
  });
});
