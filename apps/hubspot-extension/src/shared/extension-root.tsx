import {
  type ExtensionPointApiActions,
  type ExtensionPointApiContext,
  Text,
} from "@hubspot/ui-extensions";
import { SnapshotStateRenderer } from "../features/snapshot/components/snapshot-state-renderer";
import { useCompanyContext } from "../features/snapshot/hooks/use-company-context";
import {
  type SnapshotFetcher,
  useSnapshot,
  v1UnwiredFetcher,
} from "../features/snapshot/hooks/use-snapshot";

export type ExtensionRootProps = {
  context: ExtensionPointApiContext<"crm.record.tab">;
  fetchCrmObjectProperties: ExtensionPointApiActions<"crm.record.tab">["fetchCrmObjectProperties"];
  snapshotFetcher?: SnapshotFetcher;
};

export const ExtensionRoot = ({
  context,
  fetchCrmObjectProperties,
  snapshotFetcher = v1UnwiredFetcher,
}: ExtensionRootProps) => {
  const company = useCompanyContext(context, fetchCrmObjectProperties);
  const snapshotState = useSnapshot({
    companyId: company.companyId,
    fetcher: snapshotFetcher,
  });

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
    return <Text>Error</Text>;
  }

  return <SnapshotStateRenderer snapshot={snapshotState.snapshot} />;
};
