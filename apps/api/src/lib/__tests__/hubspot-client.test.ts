/**
 * Tests for the server-side HubSpot CRM client.
 *
 * Slice 2 Step 4 only establishes the constructor contract and the
 * Authorization-header wiring. Step 9 exercises real fetches against
 * recorded cassettes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HubSpotClient } from "../hubspot-client";

const ORIGINAL_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;

beforeEach(() => {
  process.env.HUBSPOT_PRIVATE_APP_TOKEN = "pat-test-abc-123";
});

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  } else {
    process.env.HUBSPOT_PRIVATE_APP_TOKEN = ORIGINAL_TOKEN;
  }
  vi.restoreAllMocks();
});

describe("HubSpotClient", () => {
  it("constructor throws when HUBSPOT_PRIVATE_APP_TOKEN is missing", () => {
    delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;
    expect(() => new HubSpotClient()).toThrowError(/HUBSPOT_PRIVATE_APP_TOKEN/);
  });

  it("constructor throws when HUBSPOT_PRIVATE_APP_TOKEN is empty string", () => {
    process.env.HUBSPOT_PRIVATE_APP_TOKEN = "";
    expect(() => new HubSpotClient()).toThrowError(/HUBSPOT_PRIVATE_APP_TOKEN/);
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
});
