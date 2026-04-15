// One-shot diagnostic: confirm vitest.setup.ts loads .env from the main repo
// even when invoked from inside a worktree. Run with: pnpm tsx scripts/check-env-load.ts
import "../vitest.setup";

const keys = [
  "DATABASE_URL",
  "ROOT_KEK",
  "HUBSPOT_CLIENT_ID",
  "HUBSPOT_CLIENT_SECRET",
  "HUBSPOT_PRIVATE_APP_TOKEN",
  "LLM_PROVIDER",
  "LLM_API_KEY",
  "EXA_API_KEY",
  "ALLOW_TEST_AUTH",
  "NODE_ENV",
  "HUBSPOT_TEST_PORTAL_ID",
];

for (const k of keys) {
  const v = process.env[k];
  console.log(k.padEnd(28), v ? `set (${v.length} chars)` : "EMPTY");
}
