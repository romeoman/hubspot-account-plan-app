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

### HubSpot profiles

HubSpot app uploads now require an explicit config profile. Start from the
committed templates in `apps/hubspot-project/`:

- `hsprofile.local.example.json`
- `hsprofile.staging.example.json`
- `hsprofile.production.example.json`

Then copy one to a real `hsprofile.<env>.json` file and upload with:

```bash
pnpm tsx scripts/hs-project-upload.ts --profile local
```

For local extension development, also copy
`apps/hubspot-project/local.json.example` to `apps/hubspot-project/local.json`.
HubSpot requires `hubspot.fetch()` URLs to stay HTTPS, so the local proxy
remaps the local profile's `API_ORIGIN` back to `http://localhost:3001` while
running `hs project dev`.

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
