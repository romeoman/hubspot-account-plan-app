import { bigint, customType, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

/**
 * Slice 3 Task 2 — replay-nonce store for HubSpot `X-HubSpot-Signature-v3`.
 *
 * HubSpot's signed-request spec has a 5-minute freshness window but the
 * same signature is replayable within that window. This table rejects
 * duplicate `(tenant_id, timestamp, body_hash)` tuples. Combined with the
 * signature check and freshness window already enforced in
 * `apps/api/src/middleware/hubspot-signature.ts`, it closes the replay
 * gap per SECURITY.md §18.
 *
 * Design invariants (see Slice 3 plan):
 *   - Composite PRIMARY KEY (tenant_id, timestamp, body_hash). Tenant-scoped
 *     so two tenants with identical (timestamp, body_hash) are independent.
 *   - `body_hash` is a raw 32-byte SHA-256 digest — stored as bytea, not
 *     hex text, because bytea equality is faster and the uniqueness of the
 *     32-byte value is the entire point of the column.
 *   - FK cascade — deleting a tenant purges their nonce history.
 *   - Sweep index on `created_at` supports the TTL cron (`scripts/sweep-nonces.ts`)
 *     which drops rows older than the freshness window (10 min with buffer).
 */

// Postgres BYTEA column. drizzle's default bytea handling returns `Buffer` on
// select but expects `Uint8Array | Buffer` on insert; customType makes the
// bi-directional typing explicit and Node-Buffer-friendly.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const signedRequestNonce = pgTable(
  "signed_request_nonce",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    timestamp: bigint("timestamp", { mode: "number" }).notNull(),
    bodyHash: bytea("body_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "signed_request_nonce_pkey",
      columns: [table.tenantId, table.timestamp, table.bodyHash],
    }),
  ],
);
