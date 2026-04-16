import { hubspot, Text } from "@hubspot/ui-extensions";
import { createRenderer } from "@hubspot/ui-extensions/testing";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_API_BASE_URL } from "../api-fetcher";
import { type UseSettingsArgs, useSettings } from "../use-settings";

const VALID_SETTINGS = {
  tenantId: "tenant-1",
  signalProviders: {
    exa: { enabled: true, hasApiKey: true },
    news: { enabled: false, hasApiKey: false },
    hubspotEnrichment: { enabled: true, hasApiKey: false },
  },
  llm: {
    provider: "openai" as const,
    model: "gpt-5.4-mini",
    hasApiKey: true,
  },
  eligibility: {
    propertyName: "hs_is_target_account",
  },
  thresholds: {
    freshnessMaxDays: 30,
    minConfidence: 0.5,
  },
};

function Probe({
  fetchSettings,
  updateSettings,
  triggerSave,
}: {
  fetchSettings?: UseSettingsArgs["fetchSettings"];
  updateSettings?: UseSettingsArgs["updateSettings"];
  triggerSave?: boolean;
}) {
  const state = useSettings({ fetchSettings, updateSettings });

  useEffect(() => {
    if (triggerSave && !state.loading && !state.saving && state.settings) {
      void state.save({
        signalProviders: {
          exa: { enabled: false },
        },
      });
    }
  }, [state, triggerSave]);

  return (
    <Text>
      {JSON.stringify({
        loading: state.loading,
        saving: state.saving,
        error: state.error ? state.error.message : null,
        tenantId: state.settings?.tenantId ?? null,
        exaEnabled: state.settings?.signalProviders.exa.enabled ?? null,
        exaHasApiKey: state.settings?.signalProviders.exa.hasApiKey ?? null,
        saveSucceeded: state.saveSucceeded,
        saveIsFn: typeof state.save === "function",
      })}
    </Text>
  );
}

describe("useSettings", () => {
  it("loads valid settings and exposes a save function", async () => {
    const renderer = createRenderer("settings");
    const fetchSettings = vi.fn(async () => VALID_SETTINGS);

    renderer.render(<Probe fetchSettings={fetchSettings} />);

    await renderer.waitFor(() => {
      const parsed = JSON.parse(renderer.find(Text).text ?? "{}");
      expect(parsed.loading).toBe(false);
    });

    const parsed = JSON.parse(renderer.find(Text).text ?? "{}");
    expect(parsed.error).toBeNull();
    expect(parsed.tenantId).toBe("tenant-1");
    expect(parsed.exaEnabled).toBe(true);
    expect(parsed.exaHasApiKey).toBe(true);
    expect(parsed.saveSucceeded).toBe(false);
    expect(parsed.saveIsFn).toBe(true);
  });

  it("updates the local settings state after a successful save", async () => {
    const renderer = createRenderer("settings");
    const fetchSettings = vi.fn(async () => VALID_SETTINGS);
    const updateSettings = vi.fn(async () => ({
      ...VALID_SETTINGS,
      signalProviders: {
        ...VALID_SETTINGS.signalProviders,
        exa: { enabled: false, hasApiKey: true },
      },
    }));

    renderer.render(
      <Probe fetchSettings={fetchSettings} updateSettings={updateSettings} triggerSave={true} />,
    );

    await renderer.waitFor(() => {
      const parsed = JSON.parse(renderer.find(Text).text ?? "{}");
      expect(parsed.loading).toBe(false);
      expect(parsed.saving).toBe(false);
      expect(parsed.exaEnabled).toBe(false);
      expect(parsed.saveSucceeded).toBe(true);
    });

    expect(updateSettings).toHaveBeenCalledWith({
      signalProviders: {
        exa: { enabled: false },
      },
    });
  });

  it("surfaces validation errors for malformed settings responses", async () => {
    const renderer = createRenderer("settings");
    const fetchSettings = vi.fn(async () => ({
      tenantId: "tenant-1",
    }));

    renderer.render(<Probe fetchSettings={fetchSettings} />);

    await renderer.waitFor(() => {
      const parsed = JSON.parse(renderer.find(Text).text ?? "{}");
      expect(parsed.loading).toBe(false);
    });

    const parsed = JSON.parse(renderer.find(Text).text ?? "{}");
    expect(parsed.tenantId).toBeNull();
    expect(parsed.error).not.toBeNull();
  });

  it("uses the real hubspot.fetch transport when no custom fetchers are injected", async () => {
    const fetchSpy = vi.spyOn(hubspot, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => VALID_SETTINGS,
    } as unknown as Response);

    const renderer = createRenderer("settings");
    renderer.render(<Probe />);

    await renderer.waitFor(() => {
      const parsed = JSON.parse(renderer.find(Text).text ?? "{}");
      expect(parsed.loading).toBe(false);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    if (!call) throw new Error("hubspot.fetch was not called");
    const [url, options] = call;
    expect(url).toBe(`${DEFAULT_API_BASE_URL}/api/settings`);
    expect((options as { method: string }).method).toBe("GET");

    fetchSpy.mockRestore();
  });
});
