/**
 * Tests for the real `hubspot.fetch()`-backed snapshot fetcher.
 *
 * Contract confirmed against HubSpot docs (Context7 `/websites/developers_hubspot`,
 * "hubspot.fetch fetching data", retrieved 2026-04-15):
 *   - Signature: `hubspot.fetch(url, options?)` returns `Promise<Response>`
 *   - Options: `{ method, body, timeout }` ONLY. Custom auth headers are NOT
 *     supported — HubSpot signs the request and injects portalId/userId
 *     server-side. The extension MUST NOT try to add Authorization/x-portal-id.
 *   - URL must appear in `permittedUrls.fetch[]` in `app-hsmeta.json`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the @hubspot/ui-extensions module's `hubspot.fetch` BEFORE importing the
// module under test, so the factory picks up the mock.
const fetchMock = vi.fn();
vi.mock("@hubspot/ui-extensions", () => ({
  hubspot: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

// Import AFTER vi.mock so the mock is in effect.
import { ApiFetcherError, createHubSpotApiFetcher, DEFAULT_API_BASE_URL } from "../api-fetcher";

const VALID_WIRE_SNAPSHOT = {
  tenantId: "tenant-1",
  companyId: "company-1",
  eligibilityState: "eligible" as const,
  reasonToContact: "Dominant signal: product launch.",
  people: [],
  evidence: [],
  stateFlags: {
    stale: false,
    degraded: false,
    lowConfidence: false,
    ineligible: false,
    restricted: false,
    empty: false,
  },
  trustScore: 0.8,
  createdAt: "2026-04-10T12:00:00.000Z",
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : status === 401 ? "Unauthorized" : "Server Error",
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  fetchMock.mockReset();
});

describe("createHubSpotApiFetcher", () => {
  it("exposes the default Slice 2 API origin (must match app-hsmeta permittedUrls.fetch)", () => {
    // Hard-coded here so the scaffold anti-regression test can bind against it.
    // If you change this, update `apps/hubspot-project/src/app/app-hsmeta.json`
    // and `apps/hubspot-project/__validate__/scaffold.test.ts`.
    expect(DEFAULT_API_BASE_URL).toBe("https://hap-signal-workspace.vercel.app");
  });

  it("returns parsed JSON snapshot on a 200 response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, VALID_WIRE_SNAPSHOT));
    const fetcher = createHubSpotApiFetcher();
    const result = await fetcher("company-1");
    expect(result).toEqual(VALID_WIRE_SNAPSHOT);
  });

  it("calls hubspot.fetch with POST and the correct URL", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, VALID_WIRE_SNAPSHOT));
    const fetcher = createHubSpotApiFetcher();
    await fetcher("company-42");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("hubspot.fetch was not called");
    const [url, options] = call;
    expect(url).toBe(`${DEFAULT_API_BASE_URL}/api/snapshot/company-42`);
    expect((options as { method: string }).method).toBe("POST");
  });

  it("does NOT pass custom auth headers (HubSpot signs the request server-side)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, VALID_WIRE_SNAPSHOT));
    const fetcher = createHubSpotApiFetcher();
    await fetcher("company-1");

    const hdrCall = fetchMock.mock.calls[0];
    if (!hdrCall) throw new Error("hubspot.fetch was not called");
    const [, options] = hdrCall;
    // The options object MUST NOT contain a `headers` field. hubspot.fetch
    // doesn't support it; including one risks silent rejection by HubSpot's
    // outbound proxy or confusing the backend tenant middleware (Step 4)
    // into looking at the wrong header.
    expect((options as { headers?: unknown }).headers).toBeUndefined();
  });

  it("passes the request body as a plain object containing the companyId (per HubSpotFetchOptions type)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, VALID_WIRE_SNAPSHOT));
    const fetcher = createHubSpotApiFetcher();
    await fetcher("company-7");

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("hubspot.fetch was not called");
    const [, options] = call;
    expect((options as { body: unknown }).body).toEqual({
      companyId: "company-7",
    });
  });

  it("honours a custom baseUrl override", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, VALID_WIRE_SNAPSHOT));
    const fetcher = createHubSpotApiFetcher({
      baseUrl: "https://hap-signal-workspace-staging.vercel.app",
    });
    await fetcher("company-1");

    const overrideCall = fetchMock.mock.calls[0];
    if (!overrideCall) throw new Error("hubspot.fetch was not called");
    const [overrideUrl] = overrideCall;
    expect(overrideUrl).toBe(
      "https://hap-signal-workspace-staging.vercel.app/api/snapshot/company-1",
    );
  });

  it("throws ApiFetcherError with status 401 on an unauthorized response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }));
    const fetcher = createHubSpotApiFetcher();
    await expect(fetcher("company-1")).rejects.toMatchObject({
      name: "ApiFetcherError",
      status: 401,
    });
  });

  it("throws ApiFetcherError with status 500 on a server error response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: "boom" }));
    const fetcher = createHubSpotApiFetcher();
    await expect(fetcher("company-1")).rejects.toBeInstanceOf(ApiFetcherError);
    try {
      await (async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: "boom" }));
        await fetcher("company-1");
      })();
      throw new Error("expected throw");
    } catch (err) {
      expect((err as ApiFetcherError).status).toBe(500);
    }
  });

  it("propagates network-level rejections from hubspot.fetch", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network-failed"));
    const fetcher = createHubSpotApiFetcher();
    await expect(fetcher("company-1")).rejects.toThrow("network-failed");
  });
});
