import { type ExtensionPointApiContext, hubspot, Text } from "@hubspot/ui-extensions";

/**
 * Props accepted by the root extension component.
 *
 * The context payload is typed via the HubSpot SDK so downstream code can
 * safely access `context.crm.objectId`, `context.crm.objectType`, `context.user`, etc.
 */
type ExtensionProps = {
  context: ExtensionPointApiContext<"crm.record.tab">;
};

/**
 * HubSpot CRM Record Tab Extension root component.
 *
 * Exported so tests can render it in isolation via `createRenderer('crm.record.tab')`
 * without invoking the top-level `hubspot.extend()` registration.
 */
export const Extension = (_props: ExtensionProps) => {
  return <Text>Signal-First Account Workspace — Loading</Text>;
};

/**
 * Entry point registration. MUST use `hubspot.extend()` — not `export default`.
 * See CLAUDE.md → "HubSpot UI Extensions patterns".
 */
hubspot.extend<"crm.record.tab">(({ context }) => <Extension context={context} />);
