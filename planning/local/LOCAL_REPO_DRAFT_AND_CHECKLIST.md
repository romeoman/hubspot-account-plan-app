# Repo Draft and Execution Checklist — HubSpot Signal-First Account Workspace

## Purpose

This document is the repo draft for the new GitHub repository and the exact execution checklist for moving from planning into implementation without losing the modular, configuration-driven constraints.

It complements:
- ChatPRD Implementation Plan
- AI Coding Rules & Standards
- Product Brief for AI Development
- Engineering review test plan

## Locked Wedge

- Dominant job: give one credible reason to contact this account
- Moment of use: HubSpot company record view
- Primary action object: 3 people plus reason to talk
- Transcript work: deferred
- Repo strategy: new GitHub repo

## New Repo Draft

### Suggested repo purpose
A HubSpot-native company-record extension plus backend that produces one credible reason to contact now and 3 people plus reason to talk, with explicit evidence, freshness, and trust constraints.

### Suggested initial repo shape
```text
repo/
  docs/
    product/
    architecture/
    api/
    qa/
    security/
  apps/
    hubspot-extension/
  services/
    api/
    workers/
  packages/
    config/
    integrations/
    domain-signals/
    snapshot-assembly/
    shared-types/
  infra/
  tests/
    unit/
    integration/
    e2e/
```

### Required modular boundaries
- `packages/integrations/`
  - one adapter per provider
  - HubSpot adapter
  - Exa adapter
  - Harvest adapter
  - future providers added without rewriting domain logic
- `packages/domain-signals/`
  - canonical signal types
  - trust/freshness rules
  - suppression logic
- `packages/snapshot-assembly/`
  - builds company-record output
  - assembles reason-to-contact wedge
  - assembles 3 people plus reasons
- `packages/config/`
  - settings schema
  - provider enablement
  - per-portal installation config
  - no secrets in code
- `apps/hubspot-extension/`
  - `crm.record.tab` UI only for this wedge
- `services/api/`
  - snapshot endpoint
  - settings/install endpoints
  - health endpoints
- `services/workers/`
  - async refresh / enrichment jobs only if needed

## Exact Checklist

### A. Documentation and planning checklist
- [ ] Implementation Plan reflects the locked wedge
- [ ] AI Coding Rules & Standards updated for modular/config-driven implementation
- [ ] Product Brief for AI Development updated as separate AI-builder handoff
- [ ] Spec for AI Prototyping updated later, after repo plan stabilizes
- [ ] Transcript Review Queue explicitly marked deferred in all active docs
- [ ] Document precedence stated clearly in implementation-facing docs

### B. New repo setup checklist
- [ ] Create new GitHub repo
- [ ] Add top-level README with wedge summary
- [ ] Add docs folders for product, architecture, api, qa, security
- [ ] Copy or link authoritative planning artifacts into docs references
- [ ] Add initial package/workspace structure for extension, API, workers, integrations, config, domain logic, snapshot assembly
- [ ] Add CI skeleton
- [ ] Add environment example files with placeholders only
- [ ] Add no-hardcoding policy to repo docs

### C. HubSpot platform checklist
- [ ] Confirm `crm.record.tab` as main extension point
- [ ] Confirm company object scope requirements
- [ ] Create UI extension app card metadata (`hsmeta`)
- [ ] Create React entrypoint for company-record view
- [ ] Use SDK context for current record
- [ ] Use CRM property / association hooks where appropriate
- [ ] Define OAuth/private-app install model before implementation proceeds
- [ ] Define webhook strategy only if needed for non-transcript sources in V1

### D. Settings and install checklist
- [ ] Define install model: public app vs private/internal app
- [ ] Define per-portal configuration model
- [ ] Define provider enable/disable settings
- [ ] Define where API keys live
- [ ] Define validation for incomplete or conflicting provider setup
- [ ] Define conflict-driven settings flow
- [ ] Define provider registration schema for future APIs
- [ ] Ensure no provider-specific constants are embedded in domain logic

### E. Security and privacy gate checklist
- [ ] Define source-of-truth matrix
- [ ] Define what data is cached locally vs read live from HubSpot
- [ ] Define what evidence can be persisted
- [ ] Define audit logging requirements
- [ ] Define role/permission visibility rules
- [ ] Define redaction / sanitization rules for provider content
- [ ] Define secret storage and rotation approach
- [ ] Define minimum privacy guardrails before pilot

### F. Data and trust checklist
- [ ] Define canonical signal schema
- [ ] Define evidence object schema
- [ ] Define freshness fields and TTL rules
- [ ] Define trust threshold for surfacing one reason to contact now
- [ ] Define suppression rules for weak evidence
- [ ] Define low-confidence labeling rules
- [ ] Define how 3 people plus reason to talk is ranked
- [ ] Define stale / degraded / empty / ineligible state semantics

### G. Slice 1 implementation checklist
- [ ] Target-account gating
- [ ] Snapshot endpoint for company record
- [ ] Canonical signals and evidence ingestion path
- [ ] One credible reason to contact now
- [ ] 3 people plus reason to talk output
- [ ] Evidence drill-in behavior
- [ ] Known vs inferred labeling
- [ ] Explicit state handling for empty/stale/degraded/ineligible
- [ ] HubSpot desktop company-record UX only

### H. QA and testing checklist
Use the local engineering review test plan as the base artifact:
- `/Users/romeoman/.gstack/projects/hubspot-account-planning-ui-extension/romeoman-unknown-eng-review-test-plan-20260410-132900.md`

Required test layers:
- [ ] Unit tests for trust threshold logic
- [ ] Unit tests for freshness calculations
- [ ] Unit tests for provider adapter normalization
- [ ] Integration tests for snapshot assembly
- [ ] Integration tests for degraded source handling
- [ ] Integration tests for permission filtering
- [ ] E2E tests for eligible/ineligible company-record states
- [ ] E2E tests for stale / empty / degraded states
- [ ] E2E tests for evidence inspection
- [ ] E2E tests for “one reason now + 3 people” rendering
- [ ] Regression tests for no fake scores and no silent CRM writes

### I. API documentation checklist
- [ ] Document snapshot endpoint contract
- [ ] Document settings/install endpoints
- [ ] Document provider adapter interface
- [ ] Document config schema
- [ ] Document trust/freshness fields
- [ ] Document error states and response semantics

### J. Future deferred checklist
- [ ] Transcript ingestion architecture revisit
- [ ] Transcript review queue feature spec, only when transcript work moves into scope
- [ ] broader account context and hygiene expansions
- [ ] additional provider onboarding

## What should be added to ChatPRD

### Existing docs already updated
- AI Coding Rules & Standards
- Product Brief for AI Development
- Implementation Plan

### New/next docs to add or update
- Repo Draft & Execution Checklist
- Lightweight Security / Permission Gate
- API / Integration Architecture Note
- Updated Spec for AI Prototyping after repo plan stabilizes

## Rule for not losing anything
Every time a planning decision becomes binding, it should live in at least one of:
- Implementation Plan
- Repo Draft & Execution Checklist
- AI Coding Rules & Standards
- Product Brief for AI Development
- Engineering review test plan

If it affects implementation order, settings/config, API behavior, trust logic, or tests, it must be reflected in both ChatPRD and the repo draft.
