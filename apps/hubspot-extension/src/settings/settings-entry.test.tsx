import { createRenderer } from "@hubspot/ui-extensions/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as settingsApi from "./api-fetcher";
import SettingsEntry from "./settings-entry";

describe("HubSpot settings bundle entry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the HubSpot profile API origin when present in context.variables", () => {
    const renderer = createRenderer("settings");
    const fetcherSpy = vi
      .spyOn(settingsApi, "createSettingsFetcher")
      .mockReturnValue(vi.fn(async () => null));
    const updaterSpy = vi
      .spyOn(settingsApi, "createSettingsUpdater")
      .mockReturnValue(vi.fn(async () => null));

    renderer.mocks.context.variables = {
      API_ORIGIN: "https://hap-signal-workspace-staging.vercel.app",
    };

    renderer.render(<SettingsEntry context={renderer.mocks.context} />);

    expect(fetcherSpy).toHaveBeenCalledWith("https://hap-signal-workspace-staging.vercel.app");
    expect(updaterSpy).toHaveBeenCalledWith("https://hap-signal-workspace-staging.vercel.app");
  });
});
