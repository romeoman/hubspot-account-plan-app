# Repo Bootstrap & Best Practices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the HubSpot Signal-First Account Workspace repo with production-grade project structure, tooling, and configuration so any engineer on any machine can clone and start building Slice 1 immediately.

**Architecture:** Monorepo with pnpm workspaces. Two apps (`hubspot-extension` for the React UI extension, `api` for the Hono backend). Shared packages for DB schemas, config types, and validators. Docker Compose for local Postgres. TDD-first with Vitest.

**Tech Stack:** React 19.x, TypeScript 5.8+, Hono 4.x, Drizzle ORM 0.45+, Postgres 16, Supabase (managed host), Docker Compose, pnpm 10.x, Vitest 4.x, Biome 2.4+ (lint/format), HubSpot CLI + @hubspot/ui-extensions SDK

> **Version audit (2026-04-12, updated 2026-04-13):** All dependency versions verified against npm registry, Context7 docs, Perplexity, and Exa research. See version notes inline for breaking changes from prior versions.
>
> **Residual risks — all resolved:**
>
> 1. Biome schema URL: confirmed `2.0.0/schema.json` is the only deployed version (GitHub biomejs/biome#6445). Correct.
> 2. `@hubspot/ui-extensions` uses `latest` — correct per HubSpot docs; SDK has no stable semver pinning convention.
> 3. TypeScript `^5.8.0` — confirmed safe. No deps in this stack require TS 6.0 features.
> 4. Vitest 4 + Hono `app.request()` — confirmed working. Vitest auto-sets `NODE_ENV=test`. Hono `app.request()` is the documented test pattern (Context7 verified).

---

## File Structure

This plan creates or modifies the following files:

```
.
├── .editorconfig                    # Cross-editor formatting consistency
├── .env.example                     # Environment variable template
├── .gitignore                       # Comprehensive ignore rules (MODIFY)
├── .nvmrc                           # Node.js version pin
├── .npmrc                           # pnpm config
├── biome.json                       # Linter + formatter config
├── .dockerignore                    # Docker build context exclusions
├── .github/
│   └── workflows/
│       └── ci.yml                   # CI pipeline (lint, typecheck, test)
├── .husky/
│   └── pre-commit                   # lint-staged pre-commit hook
├── docker-compose.yml               # Local Postgres
├── package.json                     # Root workspace (pnpm 10, biome 2.4, vitest 4, husky, lint-staged 16)
├── pnpm-workspace.yaml              # Workspace definition + onlyBuiltDependencies (pnpm 10)
├── tsconfig.json                    # Base TypeScript config
├── README.md                        # Project onboarding doc
├── apps/
│   ├── api/
│   │   ├── package.json             # Hono API package
│   │   ├── tsconfig.json            # API-specific TS config
│   │   └── src/
│   │       ├── index.ts             # Hono entrypoint
│   │       └── index.test.ts        # TDD bootstrap test
│   └── hubspot-extension/
│       ├── package.json             # React extension package
│       ├── tsconfig.json            # Extension-specific TS config
│       └── src/
│           └── index.tsx            # React entrypoint stub
├── packages/
│   ├── db/
│   │   ├── package.json             # Drizzle schemas package
│   │   ├── tsconfig.json            # DB package TS config
│   │   ├── drizzle.config.ts        # Drizzle Kit config
│   │   └── src/
│   │       ├── index.ts             # DB exports
│   │       └── schema/
│   │           ├── index.ts         # Schema barrel export
│   │           └── tenants.ts       # First schema: tenant isolation
│   ├── config/
│   │   ├── package.json             # Shared config types
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts             # Config type exports
│   └── validators/
│       ├── package.json             # Shared Zod schemas
│       ├── tsconfig.json
│       └── src/
│           └── index.ts             # Validator exports
├── docs/
│   ├── architecture/
│   │   └── .gitkeep
│   ├── api/
│   │   └── .gitkeep
│   ├── product/
│   │   └── .gitkeep
│   ├── qa/
│   │   └── .gitkeep
│   └── security/
│       └── .gitkeep
└── vitest.config.ts                 # Root test config
```

---

## Task 1: Expand .gitignore to Production Grade

**Files:**

- Modify: `.gitignore`

- [ ] **Step 1: Read current .gitignore**

Current content is only 5 lines. Verify before overwriting.

Run: `cat .gitignore`
Expected: Shows `.DS_Store`, `node_modules/`, `.env`, `.env.*`, `!.env.example`

- [ ] **Step 2: Replace with comprehensive .gitignore**

```gitignore
# Dependencies
node_modules/
.pnpm-store/

# Build output
dist/
build/
.next/
out/
*.tsbuildinfo

# Environment variables
.env
.env.*
!.env.example

# IDE
.vscode/
.idea/
*.code-workspace

# OS
.DS_Store
Thumbs.db
ehthumbs.db
*.swp
*.swo
*~

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
pnpm-debug.log*

# Test coverage
coverage/
.nyc_output/
*.lcov

# Runtime
pids/
*.pid
*.seed
*.pid.lock

# Package output
*.tgz

# Cache
.cache/
.turbo/
.parcel-cache/

# Docker
docker-data/

# Supabase
supabase/.branches
supabase/.temp

# HubSpot
.hubspot/

# Claude Code
.claude/*
!.claude/settings.json
!.claude/scripts/
!.claude/skills/

# Taskmaster local state (keep config and docs)
.taskmaster/tasks/

# Temporary
*.tmp
*.temp
```

- [ ] **Step 3: Verify the file**

Run: `wc -l .gitignore`
Expected: ~75 lines

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: expand .gitignore to cover full TypeScript/Docker/Supabase stack"
```

---

## Task 2: Add Node Version Pin and Editor Config

**Files:**

- Create: `.nvmrc`
- Create: `.editorconfig`
- Create: `.npmrc`

- [ ] **Step 1: Create .nvmrc**

```
22
```

- [ ] **Step 2: Create .editorconfig**

```editorconfig
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 3: Create .npmrc**

```ini
auto-install-peers=true
strict-peer-dependencies=false
```

- [ ] **Step 4: Verify files exist**

Run: `cat .nvmrc && cat .editorconfig && cat .npmrc`
Expected: All three files print their contents.

- [ ] **Step 5: Commit**

```bash
git add .nvmrc .editorconfig .npmrc
git commit -m "chore: add node version pin, editor config, and pnpm config"
```

---

## Task 3: Create Root package.json and pnpm Workspace

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`

- [ ] **Step 1: Create pnpm-workspace.yaml**

```yaml
packages:
  - "apps/*"
  - "packages/*"

# pnpm 10 blocks lifecycle scripts by default for security.
# Explicitly allow packages that need postinstall/build scripts.
onlyBuiltDependencies:
  - "@biomejs/biome"
  - "esbuild"
```

> **pnpm 10 breaking change:** Lifecycle scripts (postinstall, etc.) are blocked by default. Without `onlyBuiltDependencies`, Biome and esbuild will fail to install their native binaries. See https://github.com/orgs/pnpm/discussions/8945

- [ ] **Step 2: Create root package.json**

```json
{
  "name": "hubspot-account-plan-app",
  "private": true,
  "packageManager": "pnpm@10.33.0",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "dev": "pnpm --filter ./apps/* run dev",
    "dev:api": "pnpm --filter @hap/api run dev",
    "dev:extension": "pnpm --filter @hap/hubspot-extension run dev",
    "build": "pnpm --filter ./apps/* run build",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write .",
    "db:generate": "pnpm --filter @hap/db run generate",
    "db:migrate": "pnpm --filter @hap/db run migrate",
    "db:studio": "pnpm --filter @hap/db run studio",
    "typecheck": "tsc --build",
    "prepare": "husky"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.0",
    "husky": "^9.1.0",
    "lint-staged": "^16.0.0",
    "typescript": "^5.8.0",
    "vitest": "^4.0.0"
  },
  "lint-staged": {
    "*.{ts,tsx,js,jsx,json,css,md}": ["biome check --write"]
  }
}
```

- [ ] **Step 3: Verify workspace config**

Run: `cat pnpm-workspace.yaml && cat package.json | head -5`
Expected: Shows workspace definition and package name.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-workspace.yaml
git commit -m "chore: add root package.json with pnpm workspace config"
```

---

## Task 4: Create Base TypeScript Config

**Files:**

- Create: `tsconfig.json`

- [ ] **Step 1: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "paths": {
      "@hap/db": ["./packages/db/src"],
      "@hap/config": ["./packages/config/src"],
      "@hap/validators": ["./packages/validators/src"]
    }
  },
  "references": [
    { "path": "./apps/api" },
    { "path": "./apps/hubspot-extension" },
    { "path": "./packages/db" },
    { "path": "./packages/config" },
    { "path": "./packages/validators" }
  ],
  "exclude": ["node_modules", "dist", "build", "coverage"]
}
```

- [ ] **Step 2: Verify**

Run: `cat tsconfig.json | grep strict`
Expected: `"strict": true,`

- [ ] **Step 3: Commit**

```bash
git add tsconfig.json
git commit -m "chore: add base tsconfig with strict mode and workspace paths"
```

---

## Task 5: Create Shared Packages (db, config, validators)

**Files:**

- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/schema/tenants.ts`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/config/package.json`
- Create: `packages/config/tsconfig.json`
- Create: `packages/config/src/index.ts`
- Create: `packages/validators/package.json`
- Create: `packages/validators/tsconfig.json`
- Create: `packages/validators/src/index.ts`

- [ ] **Step 1: Create packages/db/package.json**

```json
{
  "name": "@hap/db",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./schema": "./src/schema/index.ts"
  },
  "scripts": {
    "generate": "drizzle-kit generate",
    "migrate": "drizzle-kit migrate",
    "studio": "drizzle-kit studio"
  },
  "dependencies": {
    "drizzle-orm": "^0.45.0",
    "postgres": "^3.4.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.31.0",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create packages/db/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create packages/db/drizzle.config.ts**

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 4: Create packages/db/src/schema/tenants.ts**

This is the foundational schema — tenant isolation is a hard requirement from the PRD.

```typescript
import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  hubspotPortalId: text("hubspot_portal_id").notNull().unique(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

- [ ] **Step 5: Create packages/db/src/schema/index.ts**

Barrel export for the schema directory. The `package.json` exports `"./schema"` pointing here.

```typescript
export * from "./tenants";
```

- [ ] **Step 6: Create packages/db/src/index.ts**

```typescript
export * from "./schema";
```

- [ ] **Step 7: Create packages/config/package.json**

```json
{
  "name": "@hap/config",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "devDependencies": {
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 8: Create packages/config/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 9: Create packages/config/src/index.ts**

```typescript
/**
 * Shared configuration types for the HubSpot Account Plan App.
 * Provider settings, thresholds, and tenant config types live here.
 */
export type TenantConfig = {
  tenantId: string;
  hubspotPortalId: string;
};
```

- [ ] **Step 10: Create packages/validators/package.json**

```json
{
  "name": "@hap/validators",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 11: Create packages/validators/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 12: Create packages/validators/src/index.ts**

```typescript
/**
 * Shared Zod validation schemas.
 * Used by both API and extension for consistent validation.
 */
export {};
```

- [ ] **Step 13: Verify all package files exist**

Run: `find packages -name "package.json" -o -name "index.ts" | sort`
Expected:

```
packages/config/package.json
packages/config/src/index.ts
packages/db/package.json
packages/db/src/index.ts
packages/db/src/schema/index.ts
packages/db/src/schema/tenants.ts
packages/validators/package.json
packages/validators/src/index.ts
```

- [ ] **Step 14: Commit**

```bash
git add packages/
git commit -m "chore: scaffold shared packages (db, config, validators)"
```

---

## Task 6: Create Hono API App Scaffold

**Files:**

- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/index.ts`

- [ ] **Step 1: Create apps/api/package.json**

```json
{
  "name": "@hap/api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@hap/db": "workspace:*",
    "@hap/config": "workspace:*",
    "@hap/validators": "workspace:*",
    "hono": "^4.7.0",
    "@hono/node-server": "^1.14.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create apps/api/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create apps/api/src/index.ts**

```typescript
import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Only start server when run directly (not when imported by tests)
if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT) || 3001;
  console.log(`API server starting on port ${port}`);
  serve({ fetch: app.fetch, port });
}

export default app;
```

> **TDD note:** The `NODE_ENV !== "test"` guard prevents the server from auto-starting when Vitest imports this module. Hono's `app.request()` method enables testing without a running server.

- [ ] **Step 4: Verify**

Run: `cat apps/api/src/index.ts | grep Hono`
Expected: `import { Hono } from 'hono';`

- [ ] **Step 5: Commit**

```bash
git add apps/api/
git commit -m "chore: scaffold Hono API app with health endpoint"
```

---

## Task 7: Create HubSpot Extension App Scaffold

**Files:**

- Create: `apps/hubspot-extension/package.json`
- Create: `apps/hubspot-extension/tsconfig.json`
- Create: `apps/hubspot-extension/src/index.tsx`

- [ ] **Step 1: Create apps/hubspot-extension/package.json**

```json
{
  "name": "@hap/hubspot-extension",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "echo 'Use hs project dev for local HubSpot extension development'",
    "build": "tsc"
  },
  "dependencies": {
    "@hap/config": "workspace:*",
    "@hap/validators": "workspace:*",
    "@hubspot/ui-extensions": "latest",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create apps/hubspot-extension/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create apps/hubspot-extension/src/index.tsx**

```tsx
import { Text } from "@hubspot/ui-extensions";
import { hubspot } from "@hubspot/ui-extensions";

/**
 * HubSpot CRM Record Tab Extension
 * Renders in crm.record.tab on company records.
 *
 * Uses hubspot.extend() as required by HubSpot UI Extensions SDK.
 * The real implementation will use context hooks for company record data.
 */
hubspot.extend<"crm.record.tab">(({ context }) => (
  <Extension context={context} />
));

const Extension = ({ context }: { context: any }) => {
  return <Text>Signal-First Account Workspace — Loading</Text>;
};
```

> **HubSpot UI extension requirement:** Extensions MUST use `hubspot.extend()` entry point, NOT React `export default`. Components import from `@hubspot/ui-extensions` (standard) and `@hubspot/ui-extensions/crm` (CRM data). HubSpot provides `createRenderer('crm.record.tab')` in `@hubspot/ui-extensions/testing` for Vitest-based testing.

- [ ] **Step 4: Verify**

Run: `cat apps/hubspot-extension/src/index.tsx | grep hubspot.extend`
Expected: Line containing `hubspot.extend`

- [ ] **Step 5: Commit**

```bash
git add apps/hubspot-extension/
git commit -m "chore: scaffold HubSpot extension app with React entrypoint"
```

---

## Task 8: Add Docker Compose for Local Postgres

**Files:**

- Create: `docker-compose.yml`

- [ ] **Step 1: Create docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: hap-postgres
    restart: unless-stopped
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-hap}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-hap_local_dev}
      POSTGRES_DB: ${POSTGRES_DB:-hap_dev}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-hap}"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres-data:
```

- [ ] **Step 2: Verify**

Run: `cat docker-compose.yml | grep postgres`
Expected: Shows postgres service definition.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add Docker Compose for local Postgres development"
```

---

## Task 9: Add Environment Variable Template

**Files:**

- Create: `.env.example`

- [ ] **Step 1: Create .env.example**

```bash
# ===========================================
# HubSpot Signal-First Account Workspace
# Copy to .env and fill in values
# ===========================================

# --- Database ---
DATABASE_URL=postgresql://hap:hap_local_dev@localhost:5432/hap_dev
POSTGRES_USER=hap
POSTGRES_PASSWORD=hap_local_dev
POSTGRES_DB=hap_dev

# --- HubSpot ---
HUBSPOT_CLIENT_ID=
HUBSPOT_CLIENT_SECRET=
HUBSPOT_APP_ID=
HUBSPOT_DEVELOPER_API_KEY=

# --- API Server ---
PORT=3001
NODE_ENV=development

# --- LLM Provider (tenant-level in production, app-level for dev) ---
# Supported: anthropic, openai, gemini, openrouter, custom
LLM_PROVIDER=
LLM_API_KEY=
LLM_MODEL=

# --- Enrichment Provider ---
EXA_API_KEY=

# --- Supabase (if using managed Postgres) ---
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 2: Verify no real secrets are in the file**

Run: `grep -c '=' .env.example`
Expected: A count of lines with `=` (all placeholder or empty values).

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "chore: add .env.example with all required environment variables"
```

---

## Task 10: Add Biome Linter/Formatter and Vitest Config

**Files:**

- Create: `biome.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create biome.json**

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
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedVariables": "error",
        "noUnusedImports": "error"
      },
      "style": {
        "noNonNullAssertion": "warn"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "files": {
    "ignore": ["node_modules", "dist", "build", "coverage", ".next", "drizzle"]
  }
}
```

> **Biome 2.x migration note:** `organizeImports` moved from top-level to `assist.actions.source.organizeImports`. The `$schema` URL uses `2.0.0` for the v2 config format. Run `biome migrate --write` to auto-upgrade from v1 configs.

- [ ] **Step 2: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.{idea,git,cache,output,temp}/**",
      "docs/**",
      "planning/**",
      ".taskmaster/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["apps/*/src/**", "packages/*/src/**"],
      exclude: ["node_modules", "dist", "docs", "planning", ".taskmaster"],
    },
  },
});
```

- [ ] **Step 3: Verify**

Run: `cat biome.json | grep recommended && cat vitest.config.ts | grep globals`
Expected: Both configs verified.

- [ ] **Step 4: Commit**

```bash
git add biome.json vitest.config.ts
git commit -m "chore: add Biome linter/formatter and Vitest test config"
```

---

## Task 11: Add TDD Bootstrap Test (Mandatory per CLAUDE.md)

**Files:**

- Create: `apps/api/src/index.test.ts`

> **Why:** CLAUDE.md mandates "No production code without a failing test first." The vitest config exists but zero test files means the TDD pipeline is unverified. This task adds a minimal test to prove `pnpm test` works end-to-end.

- [ ] **Step 1: Create apps/api/src/index.test.ts**

```typescript
import { describe, expect, it } from "vitest";

describe("API health endpoint", () => {
  it("should be importable", async () => {
    // Verify the Hono app module can be imported without errors
    const mod = await import("./index");
    expect(mod.default).toBeDefined();
  });

  it("should respond to /health", async () => {
    const { default: app } = await import("./index");
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeDefined();
  });
});
```

> **Note:** Hono supports `app.request()` for testing without starting a server. This is the idiomatic Hono test pattern.

- [ ] **Step 2: Verify test file exists**

Run: `cat apps/api/src/index.test.ts | grep health`
Expected: Line containing `health`

- [ ] **Step 3: Commit (test verifies the TDD pipeline works end-to-end with the app code from Task 6)**

```bash
git add apps/api/src/index.test.ts
git commit -m "test: add TDD bootstrap test for API health endpoint"
```

---

## Task 12: Create Docs Directory Structure

**Files:**

- Create: `docs/architecture/.gitkeep`
- Create: `docs/api/.gitkeep`
- Create: `docs/product/.gitkeep`
- Create: `docs/qa/.gitkeep`
- Create: `docs/security/.gitkeep`

- [ ] **Step 1: Create all doc directories with .gitkeep files**

```bash
mkdir -p docs/architecture docs/api docs/product docs/qa docs/security
touch docs/architecture/.gitkeep docs/api/.gitkeep docs/product/.gitkeep docs/qa/.gitkeep docs/security/.gitkeep
```

- [ ] **Step 2: Verify**

Run: `find docs -name ".gitkeep" | sort`
Expected:

```
docs/api/.gitkeep
docs/architecture/.gitkeep
docs/product/.gitkeep
docs/qa/.gitkeep
docs/security/.gitkeep
```

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "chore: add docs directory structure for architecture, api, qa, security"
```

---

## Task 13: Create README.md

**Files:**

- Create: `README.md`

- [ ] **Step 1: Create README.md**

````markdown
# HubSpot Signal-First Account Workspace

A HubSpot-native company-record extension that surfaces **one credible reason to contact an account now** with **up to 3 people and reason-to-talk**, backed by inspectable evidence with trust, freshness, and confidence constraints.

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm 9+
- Docker (for local Postgres)
- HubSpot CLI (`hs`)

### Setup

```bash
# Install dependencies
pnpm install

# Start local Postgres
docker compose up -d

# Copy environment variables
cp .env.example .env
# Edit .env with your values

# Run database migrations
pnpm db:migrate

# Start API server
pnpm dev:api

# Start HubSpot extension (in separate terminal)
pnpm dev:extension
```
````

### Commands

| Command              | Description                 |
| -------------------- | --------------------------- |
| `pnpm dev`           | Start all apps              |
| `pnpm dev:api`       | Start Hono API server       |
| `pnpm dev:extension` | Start HubSpot extension     |
| `pnpm build`         | Build all apps              |
| `pnpm test`          | Run tests                   |
| `pnpm test:watch`    | Run tests in watch mode     |
| `pnpm lint`          | Lint with Biome             |
| `pnpm lint:fix`      | Auto-fix lint issues        |
| `pnpm format`        | Format with Biome           |
| `pnpm typecheck`     | TypeScript type check       |
| `pnpm db:generate`   | Generate Drizzle migrations |
| `pnpm db:migrate`    | Apply migrations            |
| `pnpm db:studio`     | Open Drizzle Studio         |

## Architecture

```
apps/
  api/                  # Hono + TypeScript backend
  hubspot-extension/    # React UI extension (crm.record.tab)
packages/
  db/                   # Drizzle ORM schemas and migrations
  config/               # Shared configuration types
  validators/           # Shared Zod validation schemas
```

## V1 Scope

- Target-account gating via `hs_is_target_account`
- One dominant reason-to-contact-now per company
- Up to 3 people with reason-to-talk
- Evidence with source, freshness, and confidence
- Explicit empty/stale/degraded/low-confidence/ineligible states
- Tenant-isolated, config-driven, no silent CRM writes

See `planning/` for full product requirements and implementation plans.

````

- [ ] **Step 2: Verify**

Run: `head -5 README.md`
Expected: Shows project title.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "chore: add README with quick start, commands, and architecture overview"
````

---

## Task 14: Add .dockerignore

**Files:**

- Create: `.dockerignore`

- [ ] **Step 1: Create .dockerignore**

Prevents sending the entire repo (node_modules, .git, planning docs, secrets) as Docker build context.

```dockerignore
.git
.github
.claude
.taskmaster
.vscode
.idea

node_modules
dist
build
coverage

docs
planning

*.md
!README.md

.env
.env.*
!.env.example

*.log
*.tsbuildinfo
.DS_Store
```

- [ ] **Step 2: Verify**

Run: `wc -l .dockerignore`
Expected: ~22 lines

- [ ] **Step 3: Commit**

```bash
git add .dockerignore
git commit -m "chore: add .dockerignore to exclude build context bloat"
```

---

## Task 15: Add GitHub Actions CI Skeleton

**Files:**

- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create .github/workflows directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Create .github/workflows/ci.yml**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: ".nvmrc"
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint

  typecheck:
    name: Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: ".nvmrc"
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  test:
    name: Test
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: hap
          POSTGRES_PASSWORD: hap_ci
          POSTGRES_DB: hap_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U hap"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgresql://hap:hap_ci@localhost:5432/hap_test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: ".nvmrc"
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
```

- [ ] **Step 3: Verify**

Run: `cat .github/workflows/ci.yml | grep "name: CI"`
Expected: `name: CI`

- [ ] **Step 4: Commit**

```bash
git add .github/
git commit -m "chore: add GitHub Actions CI pipeline (lint, typecheck, test)"
```

---

## Task 16: Add Husky Pre-commit Hooks with lint-staged

**Files:**

- Create: `.husky/pre-commit`

Note: The `husky` and `lint-staged` packages were already added as devDependencies in the root `package.json` (Task 3), and `lint-staged` config was defined there too.

- [ ] **Step 1: Initialize Husky**

Run: `cd /Users/romeoman/Documents/Dev/HubSpot/Account\ Plan\ App && npx husky init`
Expected: Creates `.husky/` directory with a sample pre-commit hook.

- [ ] **Step 2: Replace .husky/pre-commit with lint-staged**

```bash
#!/bin/sh
npx lint-staged
```

- [ ] **Step 3: Verify hook is executable**

Run: `ls -la .husky/pre-commit`
Expected: File has execute permission (`-rwxr-xr-x` or similar).

- [ ] **Step 4: Make executable if needed**

Run: `chmod +x .husky/pre-commit`

- [ ] **Step 5: Commit**

```bash
git add .husky/
git commit -m "chore: add Husky pre-commit hook with lint-staged"
```

---

## Task 17: Install Dependencies and Verify Workspace

**Files:**

- None created (validation task)

- [ ] **Step 1: Install pnpm if not present**

Run: `which pnpm || npm install -g pnpm`
Expected: Path to pnpm binary.

- [ ] **Step 2: Install all dependencies**

Run: `cd /Users/romeoman/Documents/Dev/HubSpot/Account\ Plan\ App && pnpm install`
Expected: Successful install with workspace packages linked.

- [ ] **Step 3: Verify workspace packages are linked**

Run: `pnpm list --filter @hap/api --depth 0`
Expected: Shows @hap/db, @hap/config, @hap/validators as dependencies.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: No TypeScript errors (or expected errors from stub files only).

- [ ] **Step 5: Commit lockfile**

```bash
git add pnpm-lock.yaml
git commit -m "chore: add pnpm lockfile after initial dependency install"
```

---

## Task 18: Verify Full Bootstrap with Smoke Test

**Files:**

- None created (validation task)

- [ ] **Step 1: Start Docker Postgres**

Run: `docker compose up -d`
Expected: `hap-postgres` container running.

- [ ] **Step 2: Verify Postgres is reachable**

Run: `docker compose exec postgres pg_isready`
Expected: `accepting connections`

- [ ] **Step 3: Start API server**

Run: `pnpm dev:api &`
Expected: `API server starting on port 3001`

- [ ] **Step 4: Hit health endpoint**

Run: `curl http://localhost:3001/health`
Expected: `{"status":"ok","timestamp":"..."}`

- [ ] **Step 5: Stop API server and Docker**

Run: `kill %1 && docker compose down`
Expected: Clean shutdown.

- [ ] **Step 6: Final commit with any adjustments**

If any files needed tweaking during smoke test, commit them now.

```bash
git add -A
git commit -m "chore: finalize repo bootstrap after smoke test verification"
```

- [ ] **Step 7: Push to GitHub**

```bash
git push origin main
```

Expected: All bootstrap work synced to GitHub.
