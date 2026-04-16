import "./dist/index.js";

type CardComponent = (props: {
  context: { crm: { objectId: string | number } };
  actions: { fetchCrmObjectProperties: (...args: unknown[]) => Promise<Record<string, string>> };
}) => JSX.Element;

const bundledCard = (globalThis as { HapSignalCard?: CardComponent }).HapSignalCard;

if (!bundledCard) {
  throw new Error("HubSpot card bundle missing: expected globalThis.HapSignalCard");
}

export default bundledCard;
