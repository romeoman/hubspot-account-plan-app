# HubSpot Signal-First Account Workspace — Concise Implementation Plan

## Locked Decisions

- Dominant job: provide one credible, actionable reason to contact this account.
- Primary moment of use: HubSpot company record view.
- Primary action object: list of 3 people plus the reason to talk.
- Transcript role in V1: defer all transcript and transcript review queue work until later.
- Repo strategy: create a new GitHub repository for this workspace.

---

## Document Status

### Authoritative & Current
- PRD
- Technical Design Document
- Database Schema Design
- Feature Implementation Spec: Workspace Snapshot, Summary, and Signals

### Stale but Worth Editing
- AI Coding Rules & Standards
- Product Brief for AI Development
- Spec for AI Prototyping

### Historical Context
- office-hours design doc

---

## Transcript Review Queue

Transcript Review Queue does not require its own feature spec before repo planning. Defer all transcript work until after initial wedge-focused delivery.

---

## Canonical Execution Order

1. Lock wedge decisions.
2. Rewrite implementation plan accordingly.
3. Create the new GitHub repo and do repo planning there.
4. Edit AI Coding Rules & Standards in repo context.
5. Edit Product Brief for AI Development.
6. Edit Spec for AI Prototyping when AI-triggering features advance.
7. Re-evaluate and finalize provisional slice order inside the repo plan.

---

## Provisional Slice Order

### Slice 1: Reason-to-Contact Wedge on Company Record
- target-account gating
- snapshot API endpoint for reason-to-contact and signals
- canonical signals plus evidence
- one credible, actionable reason to contact now
- 3 people plus reason-to-talk object
- empty/stale/degraded/ineligible state handling

### Slice 2: Workspace Structure (Only If It Sharpens the Wedge)
- evidence drill-in
- summary framing and signal classification
- known vs inferred labeling
- basic next-move support only if it increases wedge clarity

### Slice 3: Data Hygiene & Deeper Context
- freshness and cleanup signals
- additional account context only if it improves actionability

### Slice 4: Transcript Ingestion & Review Workflow
- explicitly deferred

---

## Required Gates Before Repo Planning

- Dominant job locked
- Moment of use locked
- Trust threshold defined
- Transcript role decided
- Auth/install model defined
- Source-of-truth matrix defined
- Lightweight privacy/permission gate defined
- Pilot environment defined
