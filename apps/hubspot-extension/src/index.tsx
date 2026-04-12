import { hubspot, Text } from "@hubspot/ui-extensions";

/**
 * HubSpot CRM Record Tab Extension
 * Renders in crm.record.tab on company records.
 *
 * Uses hubspot.extend() as required by HubSpot UI Extensions SDK.
 * The real implementation will use context hooks for company record data.
 */
hubspot.extend<"crm.record.tab">(({ context }) => <Extension context={context} />);

const Extension = ({ context }: { context: any }) => {
  return <Text>Signal-First Account Workspace — Loading</Text>;
};
