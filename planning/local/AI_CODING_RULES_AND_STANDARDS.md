# AI Coding Rules & Standards — Locked Wedge for HubSpot Signal-First Account Workspace

## Document Precedence

If any requirements or rules conflict, resolve with the following order of operations (highest authority first):

1. Product Requirements Document (PRD)
2. Technical Design Document
3. Database Schema Design
4. Feature Implementation Spec: Workspace Snapshot, Summary, and Signals
5. Implementation Plan
6. AI Coding Rules & Standards (this doc)
7. Product Brief for AI Development
8. Spec for AI Prototyping

---

## Required Project File References

When planning or coding against this project, the following exact files should be treated as the active local planning set:
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/CLAUDE.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/.taskmaster/docs/prd.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/chatprd/AI_CODING_RULES_AND_STANDARDS.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/chatprd/IMPLEMENTATION_PLAN.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/chatprd/SECURITY_PERMISSION_GATE.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/chatprd/PRODUCT_BRIEF_FOR_AI_DEVELOPMENT.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/chatprd/SPEC_FOR_AI_PROTOTYPING.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/chatprd/REPO_DRAFT_AND_EXECUTION_CHECKLIST.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/local/QA_AND_VERIFICATION_PLAN.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/local/ENGINEERING_REVIEW_TEST_PLAN.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/local/DOC_STACK_REVIEW_NOTES.md`

These references should be used directly by local agents and should not be assumed from memory alone.

---

## Locked Wedge & Core Architecture Assumptions

- **Dominant Job:** For every eligible company record, present *one* credible, actionable reason to contact this account.
- **Primary Moment of Use:** HubSpot company record view (`crm.record.tab`).
- **Primary Output:** 3 surfaced people, each accompanied by reason to talk.
- **Transcript Work:** Deferred.
- **Integration:** Native HubSpot UI extension (React app card) with backend support.
- **Source of Truth:** HubSpot is the canonical system of record.
- **CRM Writes:** No silent writes or background updates to CRM.

---

## Strict Modularity & Configuration Rules

- Every integration must be implemented as a modular adapter.
- No hardcoded provider endpoints, thresholds, API keys, or per-portal values.
- Settings and install flow must be explicit, visible, and configuration-driven.
- External providers must be registered and toggled in settings, not embedded in code.
- Future providers must be addable without rearchitecting adapters or pipelines.
- Organize code by module / feature boundaries rather than a large shared workspace layer.
- Config-driven behavior is required for provider enablement, thresholds, environment differences, and install-time settings.

---

## Preferred Stack & Implementation Standards

- Frontend: React + TypeScript, organized using Bulletproof React-inspired project structure principles.
- Backend: Hono + TypeScript for a modular API surface.
- Data access: Drizzle ORM.
- Database: Postgres, with Supabase allowed as the managed Postgres host / app service layer.
- Local/dev infrastructure: Docker / Docker Compose if local service dependencies are required.

### Required reference standards

The following references should be treated as implementation standards and explicitly consulted during planning and coding:
- Bulletproof React project structure: https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md
- Google TypeScript style guide: https://google.github.io/styleguide/tsguide.html
- Drizzle schema organization: https://orm.drizzle.team/docs/sql-schema-declaration
- Google filename conventions: https://developers.google.com/style/filenames

### Coding expectations derived from these references

- Frontend and backend code should follow module-oriented structure.
- Configuration should drive provider behavior and environment behavior.
- Drizzle schemas should be organized deliberately, not as one giant schema file.
- TypeScript style and naming should stay consistent across the repo.
- Filenames should stay predictable and convention-driven across modules.
- For every major library or platform dependency, implementation tasks should include a current-docs verification step using Context7 or equivalent up-to-date documentation workflow where available.

---

## HubSpot Platform Constraints

- Use `crm.record.tab` as the main extension point.
- Require company record read permissions (`crm.objects.companies.read` at minimum).
- Register the workspace via `hsmeta` with a React entrypoint.
- Use UI extension context/SDK hooks for current CRM record context.
- Use HubSpot UI components and CRM data/action components where appropriate.
- Fetch current company/contact context via SDK/context hooks, not custom record fetches in the client.
- If ingesting events later, design for proper scope management and public/private app model constraints.

---

## Backend and Data Constraints

- Do not mirror full CRM records outside HubSpot.
- Local stores may persist only evidence objects, snapshots, audit logs, review state, and settings/configuration state.
- Suppress weak recommendations rather than showing guessed reasons.
- Freshness, trust, and provenance are first-class constraints.

---

## UI Rules & Signal Presentation

- Optimize for HubSpot desktop company-record use.
- The first view must present one compelling reason to contact now.
- 3 key people for outreach, each with visible reason to talk, is core and always present.
- Stale, degraded, empty, and ineligible states must be explicit.
- Low-confidence evidence must be visually and semantically distinct.
- No dashboard bloat, fake scores, opaque summaries, or decorative abstractions.

---

## HubSpot API / SDK Facts to Honor

- App card config uses `hsmeta` and a React entrypoint.
- `crm.record.tab` is the middle-column company-record extension point.
- The SDK provides current CRM record context, actions, and association hooks.
- HubSpot provides testing utilities specific to `crm.record.tab`.
- CRM Object APIs and Associations APIs must be used with proper scopes.
- Webhooks require correct scope alignment and app-model awareness.
