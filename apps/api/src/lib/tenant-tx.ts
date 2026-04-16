import { type Database, sql as drizzleSql } from "@hap/db";

type TenantScopedDatabase = Database & {
  release(): Promise<void>;
};

function tenantSettingSql(tenantId: string) {
  return drizzleSql`select set_config('app.tenant_id', ${tenantId}, true)`;
}

export async function withTenantTx<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(tenantSettingSql(tenantId));
    return fn(tx as unknown as Database);
  });
}

export async function withTenantTxHandle(
  db: Database,
  tenantId: string,
): Promise<TenantScopedDatabase> {
  let released = false;
  let resolveRelease!: () => void;
  const releaseBarrier = new Promise<void>((resolve) => {
    resolveRelease = resolve;
  });

  let tenantTx: Database | undefined;
  let markReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  const transactionPromise = db.transaction(async (tx) => {
    await tx.execute(tenantSettingSql(tenantId));
    tenantTx = tx as unknown as Database;
    markReady();
    await releaseBarrier;
  });

  await Promise.race([ready, transactionPromise]);

  const scopedTx = tenantTx as TenantScopedDatabase;
  scopedTx.release = async () => {
    if (released) {
      return;
    }
    released = true;
    resolveRelease();
    await transactionPromise;
  };
  return scopedTx;
}
