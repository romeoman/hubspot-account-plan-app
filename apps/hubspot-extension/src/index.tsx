import { hubspot } from "@hubspot/ui-extensions";
import { ExtensionRoot, type ExtensionRootProps } from "./shared/extension-root";

export const Extension = (props: ExtensionRootProps) => <ExtensionRoot {...props} />;

/**
 * Entry point registration. MUST use `hubspot.extend()` — not `export default`.
 * See CLAUDE.md → "HubSpot UI Extensions patterns".
 */
hubspot.extend<"crm.record.tab">(({ context, actions }) => (
  <Extension context={context} fetchCrmObjectProperties={actions.fetchCrmObjectProperties} />
));
