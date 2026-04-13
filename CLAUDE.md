# CLAUDE.md

## Project

This repo implements the **HubSpot Signal-First Account Workspace V1**.

The locked wedge is narrow:

- one credible reason to contact this account now
- primary surface is HubSpot **`crm.record.tab`** on the company record
- up to **3 people** plus reason-to-talk
- transcript-related work is **out of scope for V1**

Do not expand this into a broad dashboard, generic research report, or full account-planning suite unless an upstream planning document is updated.

## Read these first

Before planning or coding, read these exact files:

- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/.taskmaster/docs/prd.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/chatprd/AI_CODING_RULES_AND_STANDARDS.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/chatprd/SECURITY_PERMISSION_GATE.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/local/QA_AND_VERIFICATION_PLAN.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/chatprd/IMPLEMENTATION_PLAN.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/chatprd/PRODUCT_BRIEF_FOR_AI_DEVELOPMENT.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/chatprd/SPEC_FOR_AI_PROTOTYPING.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/chatprd/REPO_DRAFT_AND_EXECUTION_CHECKLIST.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/local/ENGINEERING_REVIEW_TEST_PLAN.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/local/DOC_STACK_REVIEW_NOTES.md`

If these documents conflict, follow the precedence defined in `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/chatprd/AI_CODING_RULES_AND_STANDARDS.md`.

## Stack

Default implementation stack for this repo:

- **Frontend:** React + TypeScript
- **Frontend organization:** Bulletproof React-inspired module / feature structure
- **Backend:** Hono + TypeScript
- **ORM:** Drizzle
- **Database:** Postgres
- **Managed app/data layer:** Supabase is allowed if it is used as managed Postgres / service layer
- **Dev infrastructure:** Docker / Docker Compose if local service dependencies are required
- **Deployment tooling:** Vercel CLI for deployment/preview workflow only, not as the primary data store
- **HubSpot tooling:** HubSpot CLI for app/project creation, local development, test accounts, and install/test flows

## Architecture rules

- Organize code by **module / feature boundaries**, not a giant shared workspace layer.
- Keep integrations behind **modular adapters**.
- Keep behavior **config-driven**.
- No hardcoded provider logic, secrets, thresholds, environment behavior, or install-time assumptions.
- Trust thresholds and suppression rules must live in **configuration / domain logic**, not UI guesswork.
- UI must consume backend/domain outputs rather than inventing its own trust semantics.
- HubSpot is the source of truth for CRM entities and associations.
- No silent CRM writes.

## Product and security rules

- The extension must work in **`crm.record.tab`**.
- Use HubSpot UI extension context/hooks for current company record context.
- Do not assume app scopes equal installer day-to-day visibility.
- Enforce permissions in backend and UI behavior.
- Restricted evidence must never be shown or summarized.
- If evidence is weak, prefer **explicit empty / suppressed state** over bluffing.
- Support **0 to 3** usable contacts. Never fabricate filler contacts.
- Explicitly render these states where relevant:
  - eligible with strong evidence
  - eligible with fewer than 3 usable contacts
  - empty / no credible reason
  - stale
  - degraded source
  - low-confidence
  - ineligible

## Tenant ownership and provider rules

- The product must be **tenant-isolated by default**. One customer must never be able to see another customer's data, evidence, API keys, prompts, model settings, or database records.
- LLM usage must be **config-driven and tenant-specific**.
- Supported provider categories should include:
  - Anthropic
  - OpenAI
  - Gemini
  - OpenRouter
  - custom OpenAI-compatible endpoints
- Customers should be able to use **their own API keys** and choose their own model/provider settings.
- Do not hardcode a single shared LLM provider for all customers.
- Database and provider credentials must be stored and resolved per tenant/workspace.
- Supabase may be offered as a managed default, but tenant data ownership and isolation remain mandatory.

## TDD rule

**TDD is mandatory.**

### Iron law

**No production code without a failing test first.**

Required cycle:

1. write a failing test
2. run it and confirm it fails for the expected reason
3. write the minimum code to pass
4. run the test and confirm it passes
5. run broader verification
6. refactor only while keeping tests green

Do not implement features first and “add tests later”.

For bug fixes:

- first write a test that reproduces the bug
- watch it fail
- then fix it

If there is a real reason to deviate from TDD, ask first.

## Verification rule

Do not claim work is done, fixed, or passing without fresh verification evidence.

Before saying something works:

1. identify the command that proves it
2. run it
3. read the result
4. only then make the claim

Evidence before assertions.

## Test environment rule

- Use a separate HubSpot developer or configurable test account for the first real validation.
- Populate it with mock CRM company/contact data before claiming the extension works end-to-end.
- Include at least one target account using `hs_is_target_account` and records that exercise strong-evidence, fewer-than-3-contacts, empty, stale, degraded, and ineligible states.

## Implementation workflow

- Use **Taskmaster** as the execution layer for tasks, subtasks, and dependencies.
- Treat `.taskmaster/docs/prd.md` as the execution-facing source for task generation.
- Prefer **mock / fixture-backed Slice 1 work first** so state semantics stabilize before live provider integrations.
- Add implementation notes back into Taskmaster tasks/subtasks as work progresses.
- Keep changes small, dependency-aware, and easy to verify.

## Documentation-check rule

For every major library, framework, or platform dependency introduced or used materially, verify current docs before implementation.

Use **Context7 or equivalent up-to-date documentation workflow** where available.

This is especially important for:

- HubSpot UI extensions / `crm.record.tab`
- Hono
- Drizzle
- Supabase / Postgres tooling
- React / TypeScript stack choices
- Docker / Compose setup
- auth / install-related libraries

## Required implementation references

Consult these references during planning and coding:

- Bulletproof React project structure: https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md
- Google TypeScript style guide: https://google.github.io/styleguide/tsguide.html
- Drizzle schema organization: https://orm.drizzle.team/docs/sql-schema-declaration
- Google filename conventions: https://developers.google.com/style/filenames

Apply them concretely:

- keep frontend/backend module-oriented
- keep config-driven behavior explicit
- organize Drizzle schema intentionally by domain/module
- keep TypeScript naming/style consistent
- keep filenames predictable and convention-driven

## Coding boundaries for V1

Do not introduce V1 scope creep into:

- transcript ingestion or transcript-derived logic
- dashboard-heavy analytics views
- fake scoring widgets
- generic research-report generation
- broad account-planning features outside the locked wedge

## Verified stack versions (audited 2026-04-12)

Use these exact ranges. Do not downgrade or guess. Verified via npm registry, Context7, Perplexity, and Exa.

| Package                | Range                      | Critical notes                                                                                   |
| ---------------------- | -------------------------- | ------------------------------------------------------------------------------------------------ |
| pnpm                   | `10.33.0` (packageManager) | v10 blocks lifecycle scripts by default. `onlyBuiltDependencies` required in pnpm-workspace.yaml |
| TypeScript             | `^5.8.0`                   | 6.0 exists but bleeding edge. 5.8 supports Node 22 `nodenext`                                    |
| Vitest                 | `^4.0.0`                   | `coverage.all` removed. Must add explicit `exclude` patterns for dist/build/etc                  |
| Biome                  | `^2.4.0`                   | v2 moved `organizeImports` to `assist.actions.source`. Schema URL: `2.0.0/schema.json`           |
| Drizzle ORM            | `^0.45.0`                  | v1 beta available with `pgTable.withRLS()` — not used in V1 bootstrap                            |
| Drizzle Kit            | `^0.31.0`                  | Aligns with ORM 0.45                                                                             |
| Zod                    | `^4.0.0`                   | v4: `z.record()` needs 2 args, `ctx.path` removed, `ZodType` generics simplified                 |
| lint-staged            | `^16.0.0`                  | Requires Node 20.18+. Pinned deps for security (chalk/debug removed)                             |
| Hono                   | `^4.7.0`                   | Current 4.9.4. Use `app.request()` for testing (not HTTP server)                                 |
| @hono/node-server      | `^1.14.0`                  | Current 1.19.11. Guard `serve()` with `NODE_ENV !== "test"` for TDD                              |
| postgres (postgres.js) | `^3.4.0`                   | Use with `drizzle-orm/postgres-js` driver                                                        |
| React                  | `^19.0.0`                  | Global JSX namespace removed. Requires `"jsx": "react-jsx"` in tsconfig                          |
| Node.js                | 22                         | Maintenance LTS                                                                                  |

## HubSpot UI Extensions patterns

- Entry point MUST use `hubspot.extend<'crm.record.tab'>()`, NOT `export default`
- Import UI from `@hubspot/ui-extensions` (standard) and `@hubspot/ui-extensions/crm` (CRM data)
- Test with `createRenderer('crm.record.tab')` from `@hubspot/ui-extensions/testing` + Vitest
- Context provides `context.crm.objectId`, `context.crm.objectType`, `context.user`
- Actions include `fetchCrmObjectProperties()`, `onCrmPropertiesUpdate()`, `addAlert()`

## Hono testing patterns

- Use `app.request('/path')` — no HTTP server needed
- Use `testClient(app)` from `hono/testing` for typed client testing
- Set `Content-Type: application/json` header for JSON POST tests
- Pass mock env vars via third arg: `app.request('/path', {}, MOCK_ENV)`
- Structure routes with `app.route('/prefix', subApp)` for modularity

## When unsure

Prefer:

- narrower scope
- more explicit state handling
- stronger suppression
- clearer evidence provenance
- smaller tasks
- more tests
- less magic
