import { type Database, sql as drizzleSql } from "@hap/db";

type TenantScopedDatabase = Database & {
  release(): Promise<void>;
  abort(error?: Error): Promise<void>;
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
  let resolveRelease!: (commit: boolean) => void;
  const releaseBarrier = new Promise<boolean>((resolve) => {
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
    const shouldCommit = await releaseBarrier;
    if (!shouldCommit) {
      throw new Error("tenant transaction aborted");
    }
  });

  await Promise.race([ready, transactionPromise]);

  const scopedTx = tenantTx as TenantScopedDatabase;
  scopedTx.release = async () => {
    if (released) {
      return;
    }
    released = true;
    resolveRelease(true);
    await transactionPromise;
  };
  scopedTx.abort = async (error?: Error) => {
    if (released) {
      return;
    }
    released = true;
    resolveRelease(false);
    try {
      await transactionPromise;
    } catch {
      throw error ?? new Error("tenant transaction aborted");
    }
  };
  return scopedTx;
}
