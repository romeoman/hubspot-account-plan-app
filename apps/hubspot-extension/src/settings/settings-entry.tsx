import { hubspot } from "@hubspot/ui-extensions";

export default function HubSpotSettingsEntry() {
  return null;
}

hubspot.extend<"settings">(() => <HubSpotSettingsEntry />);
