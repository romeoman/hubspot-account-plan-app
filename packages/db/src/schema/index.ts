import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { evidence } from "./evidence.js";
import { llmConfig } from "./llm-config.js";
import { people } from "./people.js";
import { providerConfig } from "./provider-config.js";
import { signedRequestNonce } from "./signed-request-nonce.js";
import { snapshots } from "./snapshots.js";
import { tenantHubspotOauth } from "./tenant-hubspot-oauth.js";
import { tenants } from "./tenants.js";

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
