import type { ExtensionPointApiContext } from "@hubspot/ui-extensions";
import { hubspot } from "@hubspot/ui-extensions";
import { createSettingsFetcher, createSettingsUpdater } from "./api-fetcher";
import { HubSpotSettingsPage } from "./settings-page";

type HubSpotSettingsEntryProps = {
  context: ExtensionPointApiContext<"settings">;
};

export default function HubSpotSettingsEntry({ context }: HubSpotSettingsEntryProps) {
  const apiBaseUrl = (context as { variables?: Record<string, unknown> }).variables?.API_ORIGIN;
  const resolvedBaseUrl = typeof apiBaseUrl === "string" ? apiBaseUrl : undefined;

  return (
    <HubSpotSettingsPage
      fetchSettings={createSettingsFetcher(resolvedBaseUrl)}
      updateSettings={createSettingsUpdater(resolvedBaseUrl)}
    />
  );
}

hubspot.extend<"settings">(({ context }) => <HubSpotSettingsEntry context={context} />);
