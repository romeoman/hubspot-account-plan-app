import {
  type ExtensionPointApiActions,
  type ExtensionPointApiContext,
  Text,
} from "@hubspot/ui-extensions";
import { useMemo } from "react";
import { SnapshotStateRenderer } from "../features/snapshot/components/snapshot-state-renderer";
import { createHubSpotApiFetcher } from "../features/snapshot/hooks/api-fetcher";
import { useCompanyContext } from "../features/snapshot/hooks/use-company-context";
import { type SnapshotFetcher, useSnapshot } from "../features/snapshot/hooks/use-snapshot";

export type ExtensionRootProps = {
  context: ExtensionPointApiContext<"crm.record.tab">;
  fetchCrmObjectProperties: ExtensionPointApiActions<"crm.record.tab">["fetchCrmObjectProperties"];
  snapshotFetcher?: SnapshotFetcher;
};

export const ExtensionRoot = ({
  context,
  fetchCrmObjectProperties,
  snapshotFetcher,
}: ExtensionRootProps) => {
  const apiBaseUrl = (context as { variables?: Record<string, unknown> }).variables?.API_ORIGIN;
  const resolvedBaseUrl = typeof apiBaseUrl === "string" ? apiBaseUrl : undefined;
  const defaultFetcher = useMemo(
    () =>
      createHubSpotApiFetcher({
        baseUrl: resolvedBaseUrl,
      }),
    [resolvedBaseUrl],
  );
  const resolvedFetcher = snapshotFetcher ?? defaultFetcher;
  const company = useCompanyContext(context, fetchCrmObjectProperties);
  const snapshotState = useSnapshot({
    companyId: company.companyId,
    fetcher: resolvedFetcher,
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
