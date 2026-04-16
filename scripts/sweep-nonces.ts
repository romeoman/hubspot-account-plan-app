#!/usr/bin/env node
import { createDatabase } from "@hap/db";
import { sweepExpiredNonces } from "../apps/api/src/lib/replay-nonce";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to sweep signed request nonces.");
  }

  const db = createDatabase(databaseUrl);
  const result = await sweepExpiredNonces(db, 10);
  console.log(`[sweep-nonces] deleted ${result.deletedCount} expired nonce rows`);
}

main().catch((error) => {
  console.error("[sweep-nonces] failed", error);
  process.exitCode = 1;
});
