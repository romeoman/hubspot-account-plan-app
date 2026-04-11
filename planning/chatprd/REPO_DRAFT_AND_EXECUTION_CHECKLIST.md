# HubSpot Signal-First Account Workspace — Repo Draft & Execution Checklist

## Purpose

This is the repo draft and exact execution checklist for the new GitHub repository.

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

## Exact Checklist

### Documentation and planning
- [ ] Implementation Plan reflects the locked wedge
- [ ] AI Coding Rules & Standards updated for modular/config-driven implementation
- [ ] Product Brief for AI Development updated as separate AI-builder handoff
- [ ] Spec for AI Prototyping updated later, after repo plan stabilizes
- [ ] Transcript Review Queue explicitly marked deferred in all active docs
- [ ] Document precedence stated clearly in implementation-facing docs

### New repo setup
- [ ] Create new GitHub repo
- [ ] Add top-level README with wedge summary
- [ ] Add docs folders for product, architecture, api, qa, security
- [ ] Copy or link authoritative planning artifacts into docs references
- [ ] Add initial package/workspace structure
- [ ] Add CI skeleton
- [ ] Add environment example files with placeholders only
- [ ] Add no-hardcoding policy to repo docs

### HubSpot platform
- [ ] Confirm `crm.record.tab` as main extension point
- [ ] Confirm company object scope requirements
- [ ] Create UI extension app card metadata (`hsmeta`)
- [ ] Create React entrypoint for company-record view
- [ ] Use SDK context for current record
- [ ] Use CRM property / association hooks where appropriate
- [ ] Define OAuth/private-app install model before implementation proceeds

### Settings and install
- [ ] Define install model: public app vs private/internal app
- [ ] Define per-portal configuration model
- [ ] Define provider enable/disable settings
- [ ] Define where API keys live
- [ ] Define validation for incomplete or conflicting provider setup
- [ ] Define conflict-driven settings flow
- [ ] Define provider registration schema for future APIs

### Security and privacy gate
- [ ] Define source-of-truth matrix
- [ ] Define what data is cached locally vs read live from HubSpot
- [ ] Define what evidence can be persisted
- [ ] Define audit logging requirements
- [ ] Define role/permission visibility rules
- [ ] Define redaction / sanitization rules for provider content
- [ ] Define secret storage and rotation approach
- [ ] Define minimum privacy guardrails before pilot

### Data and trust
- [ ] Define canonical signal schema
- [ ] Define evidence object schema
- [ ] Define freshness fields and TTL rules
- [ ] Define trust threshold for surfacing one reason to contact now
- [ ] Define suppression rules for weak evidence
- [ ] Define low-confidence labeling rules
- [ ] Define how 3 people plus reason to talk is ranked
- [ ] Define stale / degraded / empty / ineligible state semantics

### Slice 1 implementation
- [ ] Target-account gating
- [ ] Snapshot endpoint for company record
- [ ] Canonical signals and evidence ingestion path
- [ ] One credible reason to contact now
- [ ] 3 people plus reason to talk output
- [ ] Evidence drill-in behavior
- [ ] Known vs inferred labeling
- [ ] Explicit state handling for empty/stale/degraded/ineligible

### QA and testing
- [ ] Unit tests for trust threshold logic
- [ ] Unit tests for freshness calculations
- [ ] Unit tests for provider adapter normalization
- [ ] Integration tests for snapshot assembly
- [ ] Integration tests for degraded source handling
- [ ] Integration tests for permission filtering
- [ ] E2E tests for eligible/ineligible company-record states
- [ ] E2E tests for stale/empty/degraded states
- [ ] E2E tests for evidence inspection
- [ ] E2E tests for one reason now + 3 people rendering

### API documentation
- [ ] Document snapshot endpoint contract
- [ ] Document settings/install endpoints
- [ ] Document provider adapter interface
- [ ] Document config schema
- [ ] Document trust/freshness fields
- [ ] Document error states and response semantics
