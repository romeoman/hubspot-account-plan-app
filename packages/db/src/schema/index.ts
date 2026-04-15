import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { evidence } from "./evidence";
import { llmConfig } from "./llm-config";
import { people } from "./people";
import { providerConfig } from "./provider-config";
import { signedRequestNonce } from "./signed-request-nonce";
import { snapshots } from "./snapshots";
import { tenantHubspotOauth } from "./tenant-hubspot-oauth";
import { tenants } from "./tenants";

export {
  evidence,
  llmConfig,
  people,
  providerConfig,
  signedRequestNonce,
  snapshots,
  tenantHubspotOauth,
  tenants,
};

// Select (row) types
export type Tenant = InferSelectModel<typeof tenants>;
export type Snapshot = InferSelectModel<typeof snapshots>;
export type Evidence = InferSelectModel<typeof evidence>;
export type Person = InferSelectModel<typeof people>;
export type ProviderConfig = InferSelectModel<typeof providerConfig>;
export type LlmConfig = InferSelectModel<typeof llmConfig>;
export type TenantHubspotOauth = InferSelectModel<typeof tenantHubspotOauth>;
export type SignedRequestNonce = InferSelectModel<typeof signedRequestNonce>;

// Insert types
export type NewTenant = InferInsertModel<typeof tenants>;
export type NewSnapshot = InferInsertModel<typeof snapshots>;
export type NewEvidence = InferInsertModel<typeof evidence>;
export type NewPerson = InferInsertModel<typeof people>;
export type NewProviderConfig = InferInsertModel<typeof providerConfig>;
export type NewLlmConfig = InferInsertModel<typeof llmConfig>;
export type NewTenantHubspotOauth = InferInsertModel<typeof tenantHubspotOauth>;
export type NewSignedRequestNonce = InferInsertModel<typeof signedRequestNonce>;
