import {
  type ExtensionPointApiActions,
  type ExtensionPointApiContext,
  hubspot,
  Text,
} from "@hubspot/ui-extensions";
import { SnapshotStateRenderer } from "./features/snapshot/components/snapshot-state-renderer";
import { useCompanyContext } from "./features/snapshot/hooks/use-company-context";
import { useSnapshot } from "./features/snapshot/hooks/use-snapshot";

/**
 * Props accepted by the root extension component.
 *
 * The extension receives the full `crm.record.tab` API from the host:
 * - `context`: current CRM record + user + portal info
 * - `actions.fetchCrmObjectProperties`: CRM property fetcher
 *
 * Both are injected so the component stays testable via
 * `createRenderer('crm.record.tab')` without touching any global HubSpot SDK.
 */
type ExtensionProps = {
  context: ExtensionPointApiContext<"crm.record.tab">;
  fetchCrmObjectProperties: ExtensionPointApiActions<"crm.record.tab">["fetchCrmObjectProperties"];
};

/**
 * HubSpot CRM Record Tab Extension root component.
 *
 * Step 11 wires the hooks' `snapshot` into `SnapshotStateRenderer`, which
 * selects the correct QA state view (eligible / empty / ineligible /
 * restricted / unconfigured) and stacks any warning banners
 * (stale / degraded / low-confidence). Loading and error states remain
 * simple `Text` placeholders — those are transport-level UI, not
 * snapshot-render decisions.
 */
export const Extension = ({ context, fetchCrmObjectProperties }: ExtensionProps) => {
  const company = useCompanyContext(context, fetchCrmObjectProperties);
  const snapshotState = useSnapshot({ companyId: company.companyId });

  if (company.loading || snapshotState.loading) {
    return <Text>Loading…</Text>;
  }

  if (company.error) {
    return <Text>Error</Text>;
  }

  if (snapshotState.error) {
    return <Text>Error</Text>;
  }

  if (!snapshotState.snapshot) {
    // Defensive: a non-loading, non-error state without a snapshot means
    // something upstream skipped the fetch. Surface as error rather than
    // pretending data exists.
    return <Text>Error</Text>;
  }

  return <SnapshotStateRenderer snapshot={snapshotState.snapshot} />;
};

/**
 * Entry point registration. MUST use `hubspot.extend()` — not `export default`.
 * See CLAUDE.md → "HubSpot UI Extensions patterns".
 */
hubspot.extend<"crm.record.tab">(({ context, actions }) => (
  <Extension context={context} fetchCrmObjectProperties={actions.fetchCrmObjectProperties} />
));
