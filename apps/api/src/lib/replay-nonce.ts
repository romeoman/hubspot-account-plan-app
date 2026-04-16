import { createHash } from "node:crypto";
import { type Database, sql as drizzleSql, signedRequestNonce, tenants } from "@hap/db";
import { withTenantTx } from "./tenant-tx";

export type RecordNonceArgs = {
  tenantId: string;
  timestamp: number;
  bodyHash: Buffer;
};

export function computeBodyHash(body: string): Buffer {
  return createHash("sha256").update(body).digest();
}

export async function recordNonce(
  db: Database,
  args: RecordNonceArgs,
): Promise<{ duplicate: boolean }> {
  const rows = await db
    .insert(signedRequestNonce)
    .values({
      tenantId: args.tenantId,
      timestamp: args.timestamp,
      bodyHash: args.bodyHash,
    })
    .onConflictDoNothing({
      target: [
        signedRequestNonce.tenantId,
        signedRequestNonce.timestamp,
        signedRequestNonce.bodyHash,
      ],
    })
    .returning({
      tenantId: signedRequestNonce.tenantId,
    });

  return { duplicate: rows.length === 0 };
}

export async function sweepExpiredNonces(
  db: Database,
  maxAgeMinutes = 10,
): Promise<{ deletedCount: number }> {
  const tenantRows = await db.select({ id: tenants.id }).from(tenants);
  let deletedCount = 0;

  for (const tenant of tenantRows) {
    const rows = await withTenantTx(db, tenant.id, async (tx) =>
      tx.execute<{ deleted_count: number }>(
        drizzleSql`
          with deleted as (
            delete from signed_request_nonce
            where created_at < now() - (${maxAgeMinutes} * interval '1 minute')
            returning 1
          )
          select count(*)::int as deleted_count from deleted
        `,
      ),
    );
    deletedCount += rows[0]?.deleted_count ?? 0;
  }

  return { deletedCount };
}
