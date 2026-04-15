import { hubspot, Text } from "@hubspot/ui-extensions";
import { createRenderer } from "@hubspot/ui-extensions/testing";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_API_BASE_URL } from "../api-fetcher";
import { useSnapshot } from "../use-snapshot";

/**
 * Valid wire-shape Snapshot (dates as ISO strings).
 *
 * The hook is expected to validate + coerce ISO strings to Dates before
 * returning the parsed Snapshot.
 */
const VALID_WIRE_SNAPSHOT = {
  tenantId: "tenant-1",
  companyId: "company-1",
  eligibilityState: "eligible" as const,
  reasonToContact: "Dominant signal: product launch.",
  people: [],
  evidence: [
    {
      id: "ev-1",
      tenantId: "tenant-1",
      source: "mock",
      timestamp: "2026-04-01T00:00:00.000Z",
      confidence: 0.82,
      content: "Public launch announcement.",
      isRestricted: false,
    },
  ],
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

function Probe({
  companyId,
  fetcher,
  triggerRefetch,
}: {
  companyId: string;
  fetcher: Parameters<typeof useSnapshot>[0]["fetcher"];
  triggerRefetch?: boolean;
}) {
  const state = useSnapshot({ companyId, fetcher });
  const snapshot = state.snapshot;
  return (
    <Text>
      {JSON.stringify({
        loading: state.loading,
        error: state.error ? state.error.message : null,
        hasSnapshot: snapshot !== null,
        createdAtIsDate: snapshot ? snapshot.createdAt instanceof Date : false,
        evidenceTimestampIsDate: snapshot?.evidence[0]
          ? snapshot.evidence[0].timestamp instanceof Date
          : false,
        eligibilityState: snapshot?.eligibilityState ?? null,
        refetchIsFn: typeof state.refetch === "function",
        triggerRefetch: triggerRefetch === true,
      })}
    </Text>
  );
}

describe("useSnapshot", () => {
  it("loads a valid snapshot and coerces ISO strings to Date objects", async () => {
    const renderer = createRenderer("crm.record.tab");
    const fetcher = vi.fn(async () => VALID_WIRE_SNAPSHOT);

    renderer.render(<Probe companyId="company-1" fetcher={fetcher} />);

    await renderer.waitFor(() => {
      const parsed = JSON.parse(renderer.find(Text).text ?? "{}");
      expect(parsed.loading).toBe(false);
    });

    const parsed = JSON.parse(renderer.find(Text).text ?? "{}");
    expect(parsed.error).toBeNull();
    expect(parsed.hasSnapshot).toBe(true);
    expect(parsed.createdAtIsDate).toBe(true);
    expect(parsed.evidenceTimestampIsDate).toBe(true);
    expect(parsed.eligibilityState).toBe("eligible");
    expect(fetcher).toHaveBeenCalledWith("company-1");
  });

  it("surfaces fetch rejections as error state", async () => {
    const renderer = createRenderer("crm.record.tab");
    const fetcher = vi.fn(async () => {
      throw new Error("network-failed");
    });

    renderer.render(<Probe companyId="company-2" fetcher={fetcher} />);

    await renderer.waitFor(() => {
      const parsed = JSON.parse(renderer.find(Text).text ?? "{}");
      expect(parsed.loading).toBe(false);
    });
    const parsed = JSON.parse(renderer.find(Text).text ?? "{}");
    expect(parsed.error).toBe("network-failed");
    expect(parsed.hasSnapshot).toBe(false);
  });

  it("rejects malformed responses with a validation error (no silent bad data)", async () => {
    const renderer = createRenderer("crm.record.tab");
    const fetcher = vi.fn(async () => ({
      // Missing required fields (no tenantId, no stateFlags, etc.).
      companyId: "company-3",
      eligibilityState: "eligible",
    }));

    renderer.render(<Probe companyId="company-3" fetcher={fetcher} />);

    await renderer.waitFor(() => {
      const parsed = JSON.parse(renderer.find(Text).text ?? "{}");
      expect(parsed.loading).toBe(false);
    });
    const parsed = JSON.parse(renderer.find(Text).text ?? "{}");
    expect(parsed.hasSnapshot).toBe(false);
    expect(parsed.error).not.toBeNull();
  });

  it("exposes a refetch function that ACTUALLY re-runs the fetcher", async () => {
    const renderer = createRenderer("crm.record.tab");
    let call = 0;
    const fetcher = vi.fn(async () => {
      call += 1;
      return { ...VALID_WIRE_SNAPSHOT, reasonToContact: `call-${call}` };
    });

    // Capture refetch in module scope so the test can invoke it directly.
    let capturedRefetch: (() => void) | null = null;

    function RefetchProbe({ companyId }: { companyId: string }) {
      const state = useSnapshot({ companyId, fetcher });
      capturedRefetch = state.refetch;
      return (
        <Text>
          {JSON.stringify({
            loading: state.loading,
            reason: state.snapshot?.reasonToContact ?? null,
          })}
        </Text>
      );
    }

    renderer.render(<RefetchProbe companyId="company-1" />);
    await renderer.waitFor(() => {
      const parsed = JSON.parse(renderer.find(Text).text ?? "{}");
      expect(parsed.loading).toBe(false);
      expect(parsed.reason).toBe("call-1");
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Trigger the refetch and assert the fetcher fires again with new content.
    if (!capturedRefetch) throw new Error("refetch was not captured");
    (capturedRefetch as () => void)();
    await renderer.waitFor(() => {
      const parsed = JSON.parse(renderer.find(Text).text ?? "{}");
      expect(parsed.loading).toBe(false);
      expect(parsed.reason).toBe("call-2");
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("uses the real hubspot.fetch()-backed default fetcher when none is injected", async () => {
    // Step 11 anti-regression: with no fetcher passed, useSnapshot must
    // call through to `createHubSpotApiFetcher()` which hits
    // `POST {DEFAULT_API_BASE_URL}/api/snapshot/:companyId` via
    // `hubspot.fetch()`. This binds the hook's production default to the
    // same origin that `app-hsmeta.json` whitelists in permittedUrls.fetch.
    const fetchSpy = vi.spyOn(hubspot, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => VALID_WIRE_SNAPSHOT,
    } as unknown as Response);

    function DefaultProbe({ companyId }: { companyId: string }) {
      const state = useSnapshot({ companyId });
      return (
        <Text>
          {JSON.stringify({
            loading: state.loading,
            hasSnapshot: state.snapshot !== null,
            error: state.error ? state.error.message : null,
          })}
        </Text>
      );
    }

    const renderer = createRenderer("crm.record.tab");
    renderer.render(<DefaultProbe companyId="company-99" />);

    await renderer.waitFor(() => {
      const parsed = JSON.parse(renderer.find(Text).text ?? "{}");
      expect(parsed.loading).toBe(false);
    });

    const parsed = JSON.parse(renderer.find(Text).text ?? "{}");
    expect(parsed.error).toBeNull();
    expect(parsed.hasSnapshot).toBe(true);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    if (!call) throw new Error("hubspot.fetch was not called");
    const [url, options] = call;
    expect(url).toBe(`${DEFAULT_API_BASE_URL}/api/snapshot/company-99`);
    expect((options as { method: string }).method).toBe("POST");
    // Anti-regression: never send client-side auth headers.
    expect((options as { headers?: unknown }).headers).toBeUndefined();

    fetchSpy.mockRestore();
  });
});
