import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export { and, eq, like, sql } from "drizzle-orm";
export * from "./schema";

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl);
  return drizzle(client, { schema });
}

export function createTestClient(databaseUrl: string) {
  return postgres(databaseUrl);
}
