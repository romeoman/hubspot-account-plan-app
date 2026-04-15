import { EmptyState, hubspot, Text } from "@hubspot/ui-extensions";

/**
 * Slice 2 Step 1.5 — minimal HubSpot project scaffold card.
 *
 * Intentionally placeholder: this card exists to prove the HubSpot project
 * envelope (hsproject.json, app-hsmeta.json, card-hsmeta.json) builds and
 * uploads successfully and to provision the developer app + CLIENT_SECRET.
 *
 * Step 11 (`ext-fetcher`) replaces this body with the real Slice 1
 * extension logic (snapshot-state-renderer + `useSnapshot` via
 * `hubspot.fetch()`). The Slice 1 React code currently lives at
 * `apps/hubspot-extension/src/index.tsx` and is fully covered by vitest.
 * Wiring it into HubSpot's bundle (which does not understand our pnpm
 * workspace deps) is Step 11's responsibility.
 */
hubspot.extend<"crm.record.tab">(({ context }) => <Card context={context} />);

interface CardProps {
  context: { crm: { objectId: string | number } };
}

const Card = ({ context }: CardProps) => (
  <EmptyState title="HAP Signal Workspace — scaffold ready" layout="vertical" imageName="building">
    <Text>
      Slice 2 in progress. This card will display the credible reason-to-contact for company{" "}
      {String(context.crm.objectId)} once the API fetcher (Step 11) is wired.
    </Text>
  </EmptyState>
);
