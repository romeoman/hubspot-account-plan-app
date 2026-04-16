import type { ExtensionPointApiActions, ExtensionPointApiContext } from "@hubspot/ui-extensions";
import { hubspot } from "@hubspot/ui-extensions";
import { ExtensionRoot } from "./shared/extension-root";

type HubSpotCardEntryProps = {
  context: ExtensionPointApiContext<"crm.record.tab">;
  actions: Pick<ExtensionPointApiActions<"crm.record.tab">, "fetchCrmObjectProperties">;
};

export default function HubSpotCardEntry({ context, actions }: HubSpotCardEntryProps) {
  return (
    <ExtensionRoot context={context} fetchCrmObjectProperties={actions.fetchCrmObjectProperties} />
  );
}

hubspot.extend<"crm.record.tab">(({ context, actions }) => (
  <HubSpotCardEntry context={context} actions={actions} />
));
