import { hubspot } from "@hubspot/ui-extensions";
import { HubSpotSettingsPage } from "./settings-page";

export default function HubSpotSettingsEntry() {
  return <HubSpotSettingsPage />;
}

hubspot.extend<"settings">(() => <HubSpotSettingsEntry />);
