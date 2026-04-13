# Stack Reference — HubSpot Signal-First Account Workspace

> Audited 2026-04-12 via npm registry, Context7, Perplexity, Exa. Use this as the source of truth for dependency versions and patterns.

## Version Matrix

| Package                | Range     | Latest Verified       | Notes                                                               |
| ---------------------- | --------- | --------------------- | ------------------------------------------------------------------- |
| pnpm                   | `10.33.0` | 10.33                 | v10 blocks lifecycle scripts. Need `onlyBuiltDependencies`          |
| TypeScript             | `^5.8.0`  | 5.8.x / 6.0 available | 5.8 is safe choice; 6.0 bleeding edge                               |
| Vitest                 | `^4.0.0`  | 4.0.x                 | v4 requires Node 20+, `coverage.all` removed                        |
| Biome                  | `^2.4.0`  | 2.4.11                | v2 config: `assist.actions.source.organizeImports`. Schema: `2.0.0` |
| Drizzle ORM            | `^0.45.0` | 0.45.2                | Zero deps, 7.4kb. v1 beta has RLS                                   |
| Drizzle Kit            | `^0.31.0` | 0.31.5                | Aligns with ORM 0.45                                                |
| Zod                    | `^4.0.0`  | 4.0.1                 | v4: `z.record(key, val)` requires 2 args                            |
| lint-staged            | `^16.0.0` | 16.4.0                | Requires Node 20.18+. Pinned deps                                   |
| Hono                   | `^4.7.0`  | 4.9.4                 | Test with `app.request()`                                           |
| @hono/node-server      | `^1.14.0` | 1.19.11               | Guard `serve()` for test imports                                    |
| postgres (postgres.js) | `^3.4.0`  | 3.4.9                 | Use `drizzle-orm/postgres-js` driver                                |
| React                  | `^19.0.0` | 19.2                  | JSX namespace removed. Use `jsx: react-jsx`                         |
| Husky                  | `^9.1.0`  | 9.1.7                 | Shell refactor in v9                                                |
| Node.js                | 22        | 22.x                  | Maintenance LTS                                                     |
| @hubspot/ui-extensions | `latest`  | —                     | SDK for CRM tab extensions                                          |

## pnpm 10 Breaking Changes

**Lifecycle scripts blocked by default.** Must add to `pnpm-workspace.yaml`:

```yaml
onlyBuiltDependencies:
  - "@biomejs/biome"
  - "esbuild"
```

Without this, Biome and esbuild native binaries will fail to install.

## Biome 2.x Config Format

v1 `organizeImports` is now `assist`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "assist": {
    "enabled": true,
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  }
}
```

Run `biome migrate --write` to auto-upgrade from v1 configs.

## Vitest 4 Changes

- `coverage.all` removed — use `coverage.include` instead
- Default excludes only `node_modules` and `.git` — must explicitly exclude `dist`, `build`, etc.
- Browser provider uses object factory, not string
- `workspace` renamed to `projects`

## Zod 4 Breaking Changes

- `z.record(valueSchema)` → `z.record(keySchema, valueSchema)` (2 args required)
- `ctx.path` removed in refinements
- `z.function()` no longer returns a Zod schema — acts as function factory
- `.nonempty()` infers `string[]` not `[string, ...string[]]`
- `._def` moved to `._zod.def`
- `.default()` expects output type, not input type

## Hono Testing Best Practices

```typescript
// Use app.request() — no HTTP server needed
const res = await app.request("/health");
expect(res.status).toBe(200);

// JSON POST — must set Content-Type header
const res = await app.request("/api", {
  method: "POST",
  body: JSON.stringify({ key: "value" }),
  headers: new Headers({ "Content-Type": "application/json" }),
});

// Typed client testing
import { testClient } from "hono/testing";
const client = testClient(app);
const res = await client.search.$get({ query: { q: "test" } });

// Mock env vars (e.g., for Cloudflare bindings)
const res = await app.request("/path", {}, { API_KEY: "test" });
```

Guard `serve()` so tests can import the module:

```typescript
if (process.env.NODE_ENV !== "test") {
  serve({ fetch: app.fetch, port: 3001 });
}
export default app;
```

## Drizzle ORM + postgres.js Setup

```typescript
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/schema",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});

// Connection
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle({ client });
```

Use `postgres.camel` transform for camelCase ↔ snake_case:

```typescript
const sql = postgres(url, { transform: postgres.camel });
```

## HubSpot UI Extension Patterns

Entry point (MUST use `hubspot.extend`, NOT React export):

```tsx
import { hubspot } from "@hubspot/ui-extensions";
import { Text } from "@hubspot/ui-extensions";

hubspot.extend<"crm.record.tab">(({ context, actions }) => (
  <Extension context={context} actions={actions} />
));
```

Key APIs:

- `context.crm.objectId` — current record ID
- `context.crm.objectType` — e.g., "COMPANY"
- `actions.fetchCrmObjectProperties(['name', 'domain'])` — fetch properties
- `actions.onCrmPropertiesUpdate(['prop'], callback)` — live updates
- `actions.addAlert({ type: 'success', message: '...' })` — show alerts

Testing:

```typescript
import { createRenderer } from "@hubspot/ui-extensions/testing";
const { render, find } = createRenderer("crm.record.tab");
```

## postgres.js Connection Patterns

```typescript
// Environment-based (reads PGHOST, PGDATABASE, etc.)
const sql = postgres();

// Connection string
const sql = postgres("postgres://user:pass@localhost:5432/db");

// Options object
const sql = postgres({
  host: "localhost",
  port: 5432,
  database: "mydb",
  max: 10,
  idle_timeout: 20,
  connect_timeout: 30,
  transform: postgres.camel,
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  await sql.end({ timeout: 5 });
});
```

## CI — GitHub Actions with pnpm 10

`pnpm/action-setup@v4` reads `packageManager` from package.json automatically:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: pnpm/action-setup@v4 # reads pnpm@10.33.0 from package.json
  - uses: actions/setup-node@v4
    with:
      node-version-file: ".nvmrc"
      cache: "pnpm"
  - run: pnpm install --frozen-lockfile
```
