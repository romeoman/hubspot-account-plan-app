# Taskmaster Execution PRD — HubSpot Signal-First Account Workspace V1

## Purpose

This document is the execution-facing PRD for Taskmaster.

It is intentionally thinner than the full ChatPRD stack.
Its job is to turn the locked wedge into implementation-ready tasks, subtasks, dependencies, and acceptance criteria for Claude Code in VS Code.

This file should be used as the source for:
- `task-master parse-prd`
- initial task generation
- later task expansion and dependency planning

It is **not** the full product discovery record.
The authoritative upstream docs remain the ChatPRD stack and mirrored local planning bundle.

---

## Product Wedge

### Dominant job
Give the user **one credible, actionable reason to contact this account now**.

### Primary moment of use
Inside the **HubSpot company record view**.

### Primary action object
Show **up to 3 people**, each paired with a **reason to talk**, supported by inspectable evidence.

### V1 hard boundaries
- transcript work is deferred
- no broad account-planning workspace
- no dashboard-heavy analytics surface
- no fake scoring widgets
- no generic research-report experience
- no silent CRM writes

---

## Core Product Promise

When a user opens a HubSpot company record, the system should:
1. determine whether there is a credible reason to contact the account now
2. surface that reason clearly
3. show up to 3 usable people connected to that reason
4. show supporting evidence with source, freshness, and confidence treatment
5. clearly communicate when data is stale, degraded, low-confidence, unavailable, or ineligible

If the system does not have enough trustworthy evidence, it must prefer **explicit suppression / empty state** over bluffing.

---

## Primary User

### Primary user
Account manager / AE / revenue-side user working inside HubSpot.

### User goal
Know whether there is a compelling reason to reach out now, and who to reach out to, without digging through multiple systems.

---

## In Scope for V1

### User-visible scope
- company-record surface in HubSpot
- one reason-to-contact-now object
- up to 3 people plus reason-to-talk
- evidence inspection
- explicit state handling:
  - eligible with strong evidence
  - eligible with fewer than 3 usable contacts
  - empty / no credible reason
  - stale
  - degraded source
  - low-confidence
  - ineligible

### System scope
- target-account gating
- snapshot assembly for company-record view
- provider normalization / signal ingestion for the narrow wedge
- evidence object model
- trust / freshness / suppression logic
- permission-aware rendering and API behavior
- no-hardcoding configuration patterns for providers and thresholds

### Default gating assumption
- default target-account gating should use the HubSpot property `hs_is_target_account`
- this must remain configurable later
- if the property is missing or unusable, the system should fail safely with an explicit ineligible or unconfigured state

---

## Out of Scope for V1

- transcript ingestion
- transcript review queue
- transcript-derived prompts
- transcript-derived caching
- transcript-derived telemetry
- broad account planning suite behavior
- generic account dashboards
- fake account scoring / health widgets
- broad research report generation
- full writeback workflows to CRM
- shared workspace / cross-portal analytics

---

## Platform Constraints

### HubSpot assumptions
- the product is a **native HubSpot UI extension**
- intended surface is **`crm.record.tab`**
- desktop-first usage
- React-based extension with `hsmeta`
- current company record context should come from HubSpot extension context

### Initial install and auth assumption
- V1 assumes an **internal/private app** model first, unless explicitly changed later
- the HubSpot UI extension authenticates to the backend using the approved HubSpot app model and current record context
- public marketplace-grade installation is not required for the first implementation slice
- install/auth work still needs a concrete security artifact, but Taskmaster should plan around an internal/private-app-first setup

### Initial technical shape
- one repo
- React / TypeScript HubSpot extension frontend
- Bulletproof React-inspired frontend structure for feature/module organization
- Hono + TypeScript backend for modular API surface
- Drizzle ORM for schema and data access
- Postgres as the primary relational store, with Supabase allowed as the managed Postgres host and app service layer
- background jobs are optional and should only be introduced if snapshot freshness or provider ingestion requires them
- local development should assume Docker / Docker Compose support if the stack introduces local service dependencies

### Deployment and hosting assumption
- Vercel CLI may be used for deployment, preview environments, local environment replication, and project/environment management
- Vercel is not the primary application data store in this plan
- the actual application data layer should remain Postgres/Supabase unless an upstream decision changes it

### Required development tooling
- HubSpot CLI is required for project creation, local extension development, test-account workflows, and app install/test operations
- Vercel CLI is required if Vercel is used for deployment and preview workflow

### Source of truth
HubSpot is the canonical source of truth for CRM entities and associations.

### CRM write policy
No silent writes or background updates to CRM.
Only explicit user actions may write to CRM, if any write actions are added later.

---

## Data and Integration Constraints

### Modularity
- integrations must be modular adapters
- provider assumptions must remain configurable
- no hardcoded provider forever assumptions
- no hardcoded confidence thresholds in the UI
- no hardcoded secrets in code
- application logic should be organized by module / feature boundaries rather than by one large shared workspace layer
- config-driven behavior is required for provider enablement, thresholds, environment differences, and install-time settings

### Current provider assumptions
- Exa is allowed as current V1 enrichment source
- Harvest may be integrated later / selectively
- future providers must be addable without re-architecting the wedge

### Provider data minimization
- send only minimum required fields to external providers
- do not send raw contact/company payloads by default
- do not send emails / phone numbers unless explicitly required and approved

### LLM provider model
- LLM access must be configuration-driven and tenant-specific
- supported provider categories should include Anthropic, OpenAI, Gemini, OpenRouter, and custom OpenAI-compatible endpoints
- each tenant should use its own API keys, model selections, and provider settings
- the app must not require all tenants to share one platform-owned LLM account for normal operation
- model/provider choice should be changeable in settings without code changes

### Database and tenant data model
- tenant data ownership is mandatory: each customer should use its own data and must not be visible to other customers
- the default database strategy should support customer-owned data boundaries and strong tenant isolation
- Supabase may be offered as a managed default for teams that do not want to host their own Postgres
- the system should also allow externally hosted Postgres-compatible databases where feasible through configuration
- provider keys, database credentials, thresholds, and tenant settings must all be stored and resolved per tenant/workspace

---

## Security and Permission Requirements

### Required principles
- app scopes do not automatically equal installer visibility
- object-level access must be enforced in backend and UI behavior
- restricted evidence must never be surfaced or summarized
- provider credentials must be encrypted and never exposed client-side
- retention/storage behavior must be explicitly defined, not hand-waved as “ephemeral”

### Security and tenant isolation requirement
- one customer must never be able to see another customer's CRM data, evidence, API keys, prompts, model settings, or database records
- tenant isolation must apply to application data, logs, caches, config, provider credentials, and model/provider settings
- the system must be designed so each installed account can use its own API keys and its own data boundaries by default
- stack-hosting decisions must preserve tenant isolation and make data ownership obvious

### Security artifact dependency
Before implementation proceeds beyond bootstrap, the team must define:
- scope matrix
- permission model
- retention/storage design
- redaction policy
- install/auth model
- V1 exclusions

### Trust-threshold ownership
- trust threshold and suppression rules must be defined in configuration and domain logic before UI finalization
- the UI must consume trust outputs from backend/domain logic and must not invent its own thresholds

---

## Trust and Evidence Rules

Every surfaced recommendation must be grounded in evidence.

### Evidence requirements
Each reason / person object must support:
- source / provenance
- freshness / timestamp
- confidence treatment where applicable
- suppression if evidence is too weak

### Evidence-state semantics
- **Restricted**: never shown, never summarized
- **Stale**: may be shown only with visible age and caution
- **Low-confidence**: shown only with explicit confidence/provenance treatment
- **Degraded source**: shown as a system/source issue, not disguised as low confidence

### Product rule
If evidence is weak, the system should prefer **silence over bluffing**.

---

## Contact Selection Rules

The product must not assume 3 valid contacts always exist.

### Required behavior
- support 0 to 3 usable contacts
- degrade gracefully when fewer than 3 are available
- never fabricate filler contacts
- company-level reason can still exist even when fewer than 3 contacts are available

---

## Functional Requirements

### FR1. Company record entry
When a user opens a company record, the system can resolve the current company context and determine whether the company is eligible for the wedge.

### FR2. Eligibility and target-account gating
The system determines whether the account qualifies for evaluation, including target-account gating behavior.

### FR3. Snapshot generation
The system assembles a company-level snapshot from HubSpot context plus permitted signal/evidence sources.

#### Minimum snapshot output
The snapshot contract should be able to return, at minimum:
- eligibility state
- one dominant reason-to-contact-now object or an explicit empty state
- up to 3 people with reason-to-talk
- evidence references with source and timestamp
- trust / freshness markers
- system state flags for stale, degraded, low-confidence, ineligible, and restricted-suppressed behavior

### FR4. Reason-to-contact generation
The system produces at most one dominant reason to contact now for the account.

### FR5. People plus reason-to-talk object
The system produces up to 3 usable people, each with a reason-to-talk connected to the dominant reason or supporting evidence.

### FR6. Evidence inspection
The UI exposes supporting evidence with source and freshness information.

### FR7. Trust-aware state rendering
The UI renders stale, degraded, low-confidence, empty, and ineligible states explicitly.

### FR8. Permission-aware suppression
Restricted or non-permitted data is not rendered, summarized, or leaked through partial UI states.

### FR9. Configuration-driven provider behavior
Provider enablement, thresholds, secrets, and related settings are configuration-driven, not hardcoded.

---

## Test-account and mock-data requirement

Before meaningful end-to-end validation, the team must create a separate HubSpot developer or configurable test account and populate it with mock CRM data.

This test setup must support at minimum:
- a target account using `hs_is_target_account`
- associated contacts for 0 to 3+ contact scenarios
- fixture records supporting strong-evidence, fewer-than-3-contacts, empty, stale, degraded, and ineligible states
- app installation and local development preview in the isolated test account

## QA-Critical States

The following states must exist in generated tasks and acceptance criteria:

1. **Eligible, strong evidence**
2. **Eligible, fewer than 3 usable contacts**
3. **Empty / no credible reason**
4. **Stale**
5. **Degraded source**
6. **Low-confidence**
7. **Ineligible**
8. **Restricted evidence never shown**

---

## Acceptance Criteria for the Wedge

The wedge is successful only if all of the following are true:

1. The company-record surface feels like the right home for the experience.
2. The user can understand the one reason-to-contact-now without reading a long summary.
3. Up to 3 people plus reason-to-talk is more actionable than a generic account summary.
4. Evidence display builds trust instead of adding clutter.
5. Empty / stale / degraded / low-confidence / ineligible states are explicit and understandable.
6. No restricted evidence is shown or summarized.
7. The product does not drift into dashboard bloat.

### Slice 1 done means
- the extension renders in `crm.record.tab`
- company context resolves correctly
- target-account gating works using the default assumption or explicit fallback behavior
- a snapshot contract exists and can drive the UI
- the system can surface one dominant reason-to-contact-now or an explicit empty state
- the system can surface 0 to 3 usable contacts with reason-to-talk
- stale, degraded, low-confidence, empty, and ineligible states render explicitly
- restricted evidence is suppressed and not summarized
- no transcript-dependent code path is required for Slice 1

---

## Implementation Priorities

### Slice 1
- repo bootstrap
- HubSpot extension scaffold
- company-record context plumbing
- target-account gating
- snapshot contract
- evidence object model
- dominant reason-to-contact-now generation
- up to 3 people plus reason-to-talk output
- explicit empty/stale/degraded/low-confidence/ineligible handling
- permission-aware suppression
- fixture-backed or mock-backed snapshot responses for validating UI and state handling before live provider integration

### Slice 2, only if Slice 1 works
- richer evidence drill-in
- lightweight next-move support
- additional context / hygiene layers that sharpen the wedge
- live provider integrations once contract and state semantics are stable

### Later, not now
- transcript work
- broader planning workspace behavior
- broad analytics surfaces

---

## Suggested Taskmaster Planning Hints

When Taskmaster generates tasks from this PRD, prioritize the following decomposition:

1. **Project bootstrap and repo structure**
2. **Stack and dependency setup**
3. **HubSpot extension foundation**
4. **Domain model and snapshot contract**
5. **Eligibility, trust, and suppression logic**
6. **Reason-to-contact generation**
7. **People selection and reason-to-talk mapping**
8. **UI states and evidence rendering**
9. **Configuration and provider adapter layer**
10. **Security / permission enforcement**
11. **QA / verification coverage**
12. **Documentation verification for chosen libraries and stack**

Task generation should prefer smaller, dependency-aware tasks rather than broad “build workspace” tickets.

### Documentation and library verification rule
For every core library or platform dependency introduced in the stack, planning and implementation tasks should explicitly include a documentation-check step using up-to-date sources before final implementation.

At minimum, tasks should account for checking current docs for:
- HubSpot UI extensions / `crm.record.tab`
- React / TypeScript stack choices
- Bulletproof React project structure guidance
- Hono framework usage and routing patterns
- Drizzle ORM schema organization and migration patterns
- Postgres / Supabase tooling
- auth / install-related libraries
- Docker setup if Docker is part of the local or deployment workflow
- Context7 or equivalent up-to-date documentation workflow where available

This should be reflected either as:
- a dedicated dependency-validation task early in the plan, or
- a documentation verification subtask attached to each major implementation task.

### Reference standards for planning and implementation
The following references should be treated as implementation standards and should be explicitly consulted during task planning and coding:
- Bulletproof React project structure: https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md
- Google TypeScript style guide: https://google.github.io/styleguide/tsguide.html
- Drizzle schema organization: https://orm.drizzle.team/docs/sql-schema-declaration
- Google filename conventions: https://developers.google.com/style/filenames

Taskmaster-generated tasks should preserve these expectations by including, where relevant:
- module-oriented frontend and backend structure
- config-driven implementation decisions
- schema organization discipline for Drizzle
- TypeScript style and naming consistency
- filename conventions that stay predictable across modules

---

## Source Documents

This execution PRD is derived from the following upstream artifacts and should be read together with these exact files:
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/chatprd/IMPLEMENTATION_PLAN.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/chatprd/SECURITY_PERMISSION_GATE.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/local/QA_AND_VERIFICATION_PLAN.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/chatprd/AI_CODING_RULES_AND_STANDARDS.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/chatprd/PRODUCT_BRIEF_FOR_AI_DEVELOPMENT.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/chatprd/SPEC_FOR_AI_PROTOTYPING.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/chatprd/REPO_DRAFT_AND_EXECUTION_CHECKLIST.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/local/ENGINEERING_REVIEW_TEST_PLAN.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/planning/local/DOC_STACK_REVIEW_NOTES.md`
- `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/CLAUDE.md`

If any conflict appears, the upstream doc precedence rules still apply.
