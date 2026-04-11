<!-- /autoplan restore point: /Users/romeoman/.gstack/projects/hubspot-account-planning-ui-extension/unknown-autoplan-restore-20260410-131453.md -->
# Implementation Plan: HubSpot Signal-First Account Workspace V1

Generated for /autoplan on 2026-04-10
Branch: unknown
Repo: planning-only, no active implementation repo selected yet
Status: DRAFT
Mode Candidate: SELECTIVE EXPANSION

## Objective

Turn the current document set into a buildable execution plan without creating three more overlapping specs.

This plan decides:
1. what documentation is already good enough,
2. what documentation is stale and must be edited,
3. whether Transcript Review Queue needs its own feature spec before repo planning,
4. what new files should exist before engineering starts,
5. the recommended sequence from planning into repo execution.

## Outcome We Actually Want

A seller opens a target HubSpot company record and gets a trustworthy, fast, evidence-backed workspace that helps them prep for an account in under 5 minutes by doing one thing exceptionally well:
- **give one credible reason to contact this account now**

The first supporting output around that reason is:
- **3 people plus reason to talk**

The planning system should optimize for the first shippable vertical slice, not for full future completeness.

## Locked Wedge Decisions

- **Dominant job:** give one credible reason to contact this account
- **Primary moment of use:** HubSpot company record view
- **Primary action object:** 3 people plus reason to talk
- **Transcript role in V1:** defer transcript work until later
- **Repo strategy:** new GitHub repo

## Current Document Inventory

### Authoritative and mostly current

1. **PRD**
   - Role: product truth for V1 scope and operating principles
   - Current value: high
   - Keep as top-level product source

2. **Technical Design Document**
   - Role: architecture, source-of-truth boundaries, ranking, transcript association policy
   - Current value: high
   - Keep as architecture source

3. **Database Schema Design**
   - Role: durable entities, snapshot boundaries, review queue tables, local-vs-HubSpot ownership
   - Current value: high
   - Keep as schema source

4. **Feature Implementation Spec: Workspace Snapshot, Summary, and Signals**
   - Role: first implementation-ready slice
   - Current value: very high
   - Keep as first build handoff doc

### Valuable but now stale against the newer docs

5. **Product Brief for AI Development**
   - Problem: still reflects an older framing with tab emphasis and broader UI assumptions that do not cleanly match the newer PRD + technical design
   - Action: edit, do not replace

6. **Spec for AI Prototyping**
   - Problem: still optimized around earlier prototype-era assumptions, including UI structure and behaviors that no longer cleanly match the current workspace model
   - Action: edit, do not replace

7. **AI Coding Rules & Standards**
   - Problem: contains older UX assumptions and overly broad prototype/design-system guidance that should be tightened to current V1 realities
   - Action: edit, do not replace

### Historical context only

8. **Office-hours design doc**
   - Role: origin story, wedge, early reasoning, first problem framing
   - Action: keep for lineage, not implementation authority

## Documentation Map: What Each Doc Should Own

- **PRD** owns product scope, user promise, V1 boundaries, source-of-truth rules, exclusions.
- **Technical Design** owns architecture, data flow, ingestion, matching, ranking, snapshot assembly, write boundaries.
- **Schema Design** owns durable entities, snapshot boundaries, queues, workflow state, auditability.
- **Feature Spec: Workspace Snapshot / Summary / Signals** owns the first shippable implementation slice.
- **Implementation Plan** owns sequencing, file creation order, doc edits, dependencies, and repo-entry strategy.
- **AI Coding Rules & Standards** should own implementation guardrails for coding agents only.
- **Spec for AI Prototyping** should own prototyping-only guidance only.
- **Product Brief for AI Development** should be a compact AI-builder handoff, not a second PRD.

## Core Decision: Does Transcript Review Queue Need Its Own Feature Spec Now?

### Short answer
Not yet.

### Decision
**Do not require a dedicated Transcript Review Queue feature spec before repo planning.**

### Why
The current docs already establish the important truth:
- transcript-derived signals are in scope,
- transcript association has confidence thresholds,
- low-confidence matches go to review,
- the schema already contains `transcript_records`, `transcript_associations`, and `review_queue_items`,
- the technical design already defines promotion/review behavior.

That is enough to enter repo planning.

### Trigger for creating that spec
Create a dedicated **Transcript Review Queue feature spec** only when one of these becomes true:
1. engineering review says the queue changes backend contracts for slice 1,
2. implementation starts on transcript review as a user-facing workflow,
3. the team cannot define queue ownership, states, or review actions from the existing docs.

### Working conclusion
- **Before repo planning:** no separate transcript queue spec required.
- **Before building transcript review UI/workflow:** yes, likely required.

## Canonical Execution Order

1. Lock wedge decisions
2. Rewrite implementation plan to reflect those decisions
3. Create the new GitHub repo and perform repo planning there
4. Edit AI Coding Rules & Standards to match the locked wedge
5. Edit Product Brief for AI Development to match the locked wedge
6. Edit Spec for AI Prototyping to match the locked wedge
7. Re-evaluate provisional slice order inside the new repo plan

## Recommended Documentation Changes Before Repo Planning

### Edit now

#### 1. AI Coding Rules & Standards
Purpose after edit:
- constrain coding agents to the current V1 reality
- prevent drift back into prototype-era UI ideas
- define what docs are authoritative when conflicts exist

Must be updated to reflect:
- native HubSpot UI + backend
- HubSpot as source of truth
- People as cards
- Signals as list/detail
- Plan as lightweight tactical brief, not full strategy canvas
- target-account gating via `hs_is_target_account`
- no fabricated signals, no silent CRM writes, no UI-side confidence logic
- first slice is workspace snapshot, summary, and signals

#### 2. Spec for AI Prototyping
Purpose after edit:
- become a faithful prototype brief for the current product, not an older concept

Must be updated to reflect:
- current tab/surface structure
- current hierarchy of summary → signals → people/reasons → plan/data hygiene
- current trust/provenance requirements
- current exclusions, especially no generic dashboards, no synthetic scoring, no overbuilt planning UI

#### 3. Product Brief for AI Development
Purpose after edit:
- become the short AI-builder handoff for the current product state

Must be updated to reflect:
- current V1 wedge
- current source-of-truth boundaries
- current first slice
- current document precedence

### Do not create as separate new docs yet

- App Architecture Plan, redundant with the Technical Design Document unless engineering review identifies a missing deployment/system-design gap
- Product Security Assessment, too early before repo and actual implementation surface
- Usability Test Plan / User Testing Plan, useful later, not blocking repo planning
- Release Plan / Release Notes / Launch docs, premature
- Bug Investigation & Fix Plan, no implementation bug exists yet

## New Files To Create Before Engineering Starts

### Required new file

#### A. Implementation Plan
This file.

Reason:
The current document set describes the product well, but not the execution order. We need one document that tells engineering what to do first, what to ignore, and what docs to trust.

### Likely required during repo planning

#### B. Repo-facing execution plan
This can be the same implementation plan, expanded with repo-specific sections once a codebase is chosen:
- target repo/path
- folder structure
- API contract locations
- migration ownership
- test ownership
- rollout mechanics

### Conditionally required later

#### C. Transcript Review Queue Feature Spec
Only if transcript review becomes an immediate implementation track.

## Recommended Execution Sequence

### Phase 1. Keep core references fixed
1. Keep PRD, Technical Design, Schema Design, and Workspace Snapshot feature spec as core references.
2. Treat Product Brief, Spec for AI Prototyping, and AI Coding Rules as derived artifacts to be edited after repo planning starts.

### Phase 2. New repo planning
Create a new GitHub repo and produce a repo-facing plan that answers:
- what the first vertical slice is,
- what files/modules likely exist,
- what backend contracts are needed first,
- which schema tables are needed in slice 1 versus later,
- what is explicitly deferred,
- how HubSpot company-record embedding is structured in the new codebase.

### Phase 3. Build order locking
Current **provisional** slice order, to be re-tested inside the repo plan:

#### Slice 1: Reason-to-contact wedge on company record
- target-account gating
- snapshot endpoint
- canonical signals + evidence
- one credible reason to contact this account now
- 3 people plus reason to talk
- stale / degraded / empty / ineligible states

#### Slice 2: Supporting workspace structure
- summary framing around the reason-to-contact wedge
- evidence drill-in
- known vs inferred labeling
- lightweight plan / next move support only if it sharpens action

#### Slice 3: Data hygiene and deeper supporting context
- hygiene findings
- missing-data callouts that materially improve action quality
- broader account context only if it supports the wedge

#### Slice 4: Transcript ingestion and review workflow
- explicitly deferred until later
- transcript ingestion
- association logic
- unresolved review queue
- promotion rules
- optional transcript review UI

## Repo Planning Questions That Must Be Resolved

1. What repo and path own this work?
2. Is this a new app, a HubSpot extension inside an existing app, or a backend+extension split?
3. What runtime stack is chosen for the backend?
4. What database implementation is chosen for the schema already designed?
5. What is the exact boundary between live HubSpot reads and local cached snapshots?
6. What deployment path exists for internal V1?
7. What authentication/portal-install model applies?

## What Already Exists

### Existing planning assets we should reuse, not rewrite
- PRD for product truth
- Technical Design for architecture truth
- Schema Design for durable entity truth
- Workspace Snapshot feature spec for first implementation slice
- Office-hours design doc for original wedge and rationale

### Existing decisions already made
- native HubSpot UI with backend
- HubSpot as source of truth
- Exa primary enrichment, Harvest supplemental
- target-account gating using `hs_is_target_account`
- no silent CRM writes
- no fake scores
- no dashboard bloat
- evidence-led output only

## Not in Scope Right Now

- full transcript review workflow spec before repo planning
- full people + reasons-to-talk feature spec before repo planning
- release planning artifacts
- user testing templates
- launch documentation
- security assessment as a separate major doc
- creating duplicate architecture docs that restate the Technical Design Document

## Implementation Alternatives

### Approach A: Keep writing feature specs before repo planning
- Effort: M
- Risk: High
- Pros:
  - more detail before engineering starts
  - transcript queue and people workflow become explicit earlier
- Cons:
  - high duplication risk
  - likely re-documents what PRD/TDD/schema already cover
  - delays repo-entry decisions
- Reuses:
  - current docs only as references, not as authoritative build sequence

### Approach B: Edit stale AI-facing docs, then move straight to repo planning
- Effort: M
- Risk: Low
- Pros:
  - best balance of clarity and speed
  - reduces contradictions across docs
  - sets up engineering with one source hierarchy and one execution order
- Cons:
  - transcript queue remains intentionally less specified for now
- Reuses:
  - all current core docs directly

### Approach C: Collapse everything into one mega doc
- Effort: L
- Risk: High
- Pros:
  - one place to read
- Cons:
  - destroys document boundaries
  - makes maintenance worse
  - encourages drift and conflicting edits
- Reuses:
  - everything, but poorly

## Recommendation

Choose **Approach B**.

Edit the stale AI-facing docs so they match the newer core docs, then move into repo planning. Do not write Transcript Review Queue as a separate feature spec yet. Use repo planning to determine whether that workflow is actually on the critical path.

## Files Likely Needed In The Future Repo

This is planning-only for now, but the likely implementation shape is:

- `docs/` or equivalent doc references for imported planning artifacts
- HubSpot extension frontend workspace module
- backend workspace snapshot endpoint
- signal ingestion / normalization module
- evidence model / provenance helpers
- snapshot assembly service
- transcript ingestion pipeline
- transcript association / review services
- review queue handlers
- schema / migration files
- tests for snapshot, states, and evidence behavior

## Risks If We Skip This Cleanup

1. AI coding agents will read stale prototype assumptions and build the wrong UI.
2. Repo planning will inherit conflicting source-of-truth rules.
3. Engineering may overbuild transcript review too early.
4. The first slice may get polluted by older concept-doc language.

## Success Criteria For This Planning Step

- We have a clear authoritative document hierarchy.
- We know exactly which existing docs get edited versus kept.
- We know that Transcript Review Queue is deferred as its own feature spec until implementation pressure proves it necessary.
- We have a repo-planning-ready sequence instead of another abstract planning loop.

## Open Decisions

1. Should the AI Coding Rules doc explicitly state document precedence?
2. Should the Product Brief for AI Development remain a separate artifact, or become a very thin wrapper around PRD + TDD + first feature spec?
3. How exactly should the “3 people plus reason to talk” object be ranked: by urgency, evidence strength, relationship strength, or a blend?
4. What trust threshold is high enough to show a reason-to-contact recommendation instead of suppressing it?
5. What minimum privacy / permission gate applies before the new repo starts implementation?

## CEO Review — Phase 1

### 0A. Premise Challenge

#### Current premise set under review
1. The next bottleneck is document cleanup and repo planning.
2. The right V1 container is still a persistent HubSpot workspace.
3. Transcript Review Queue does not need its own feature spec before repo planning.
4. Editing AI-facing docs before repo planning will reduce execution risk materially.
5. Slice 1 can prove value with snapshot, summary, and signals before people/reasons or transcript review workflows.

#### Evaluation
- **Premise 1 is challenged.** Both outside voices argue the real bottleneck is not document coherence, it is proving one repeat-use seller behavior and the trust threshold required to change that behavior.
- **Premise 2 is challenged.** The workspace may be right, but the current plan has not yet proved that record-view is the highest-value moment of use versus alerting, daily brief, pre-call prep, or manager review.
- **Premise 3 is conditionally acceptable.** Deferring Transcript Review Queue is reasonable only if transcript-derived signals are not part of the smallest trust-winning wedge.
- **Premise 4 is challenged.** Editing AI-facing docs first looks more like internal hygiene than customer-risk reduction.
- **Premise 5 is plausible but incomplete.** Slice 1 can work only if it proves one narrow job, one repeat-use moment, and one clear trust bar.

#### Revised premise proposal
1. Before repo planning locks architecture, we must define the **single dominant job** this product wins first.
2. Before broad workspace planning, we must define the **primary moment of use**: record view, daily triage, pre-call prep, outbound prep, or manager review.
3. Before doc cleanup becomes a major workstream, we must define the **trust threshold** for evidence quality, freshness, and matching.
4. Transcript Review Queue should stay deferred **unless** transcript-derived signals are part of the smallest differentiated wedge.
5. AI-facing docs should be edited **after** the dominant job, moment of use, and authoritative doc precedence are locked.

### 0B. Existing Code / Asset Leverage Map

There is no implementation repo selected yet, so the main leverage is **document leverage**, not code leverage.

| Sub-problem | What already exists | Reuse decision |
|---|---|---|
| Product scope | PRD | Reuse directly |
| Architecture / source-of-truth rules | Technical Design Document | Reuse directly |
| Durable entities / queue tables | Database Schema Design | Reuse directly |
| First shippable UI slice | Feature Spec: Workspace Snapshot, Summary, and Signals | Reuse directly |
| Original wedge / user problem | Office-hours design doc | Reuse as historical context only |
| AI builder handoff | Product Brief / AI Coding Rules / Spec for AI Prototyping | Reuse only after edits |

### 0C. Dream State Mapping

```text
CURRENT STATE                  THIS PLAN (ORIGINAL)                 12-MONTH IDEAL
fragmented docs +              doc cleanup + repo planning          trusted account-action system
manual account research   ->   + staged slice sequencing       ->   with repeat usage, differentiated
without one proven wedge        but no dominant job locked           signal quality, and clear moat
```

#### Dream state delta
The original plan improves execution order, but it does not yet guarantee the product is aimed at the smallest winning behavior. The 12-month ideal is not just a cleaner workspace. It is a trusted account-action system that sellers revisit because it changes behavior at the right moment.

### 0C-bis. Implementation Alternatives

#### APPROACH A: Doc-First Cleanup Then Repo Planning
- Summary: Edit stale AI-facing docs first, then enter repo planning with a cleaner document stack.
- Effort: M
- Risk: High
- Pros:
  - reduces contradiction between docs
  - produces cleaner handoff materials
- Cons:
  - does not reduce core product risk
  - may optimize internal coherence over market proof
- Reuses: all current docs

#### APPROACH B: Behavior-First Wedge Lock, Then Repo Planning, Then Doc Cleanup
- Summary: First define dominant job, moment of use, trust threshold, and transcript role. Then do repo planning. Then edit AI-facing docs to match the final wedge.
- Effort: M
- Risk: Low
- Pros:
  - addresses actual product risk first
  - keeps docs from being edited twice
  - creates stronger repo-planning inputs
- Cons:
  - delays AI-doc cleanup slightly
- Reuses: PRD, Technical Design, Schema, first feature spec, office-hours design

#### APPROACH C: Workspace-First Broad Build Sequence
- Summary: Keep the current slice order and broad workspace framing, then resolve trust and usage details during implementation.
- Effort: L
- Risk: High
- Pros:
  - fastest route to a visible demo
  - preserves current planning momentum
- Cons:
  - highest risk of building a summary pane nobody revisits
  - highest risk of stale or weakly trusted output
- Reuses: all current docs, but without deeper wedge selection

**RECOMMENDATION:** Choose **Approach B** because it reduces existential product risk before spending more effort on AI-facing documentation or repo structure.

### 0D. Mode-Specific Analysis — SELECTIVE EXPANSION

#### Complexity check
The plan is modest in document scope, but strategically under-specified. The problem is not too many files. The problem is too many unresolved product truths being hidden under clean sequencing.

#### Minimum set of changes to achieve the actual goal
To make this plan genuinely repo-planning-ready, the minimum additions are:
1. dominant job definition,
2. moment-of-use decision,
3. trust threshold definition,
4. transcript role decision,
5. document precedence matrix.

#### Expansion scan
Potential expansions surfaced by review:
- Add a **dominant job** section
- Add a **moment of use** section
- Add a **trust validation** section
- Add a **competitive thesis / moat** section
- Add a **pilot proof / 5-account study** section
- Add a lightweight **security/privacy gate**

#### Auto-decided scope additions under SELECTIVE EXPANSION
Accepted into plan review recommendations:
- dominant job definition
- moment-of-use decision
- trust validation track
- document precedence matrix
- pilot proof requirement
- lightweight security/privacy gate

Deferred to later planning:
- full Product Security Assessment template
- dedicated Transcript Review Queue feature spec
- full user testing / usability plan templates
- release and launch artifacts

### 0E. Temporal Interrogation

```text
HOUR 1 (foundations):
- Which repo owns this?
- What is the dominant user job?
- What is the moment of use?

HOUR 2-3 (core logic):
- How is trust scored without fake scoring?
- What evidence is strong enough to surface?
- Are transcript-derived signals part of slice 1 or not?

HOUR 4-5 (integration):
- What is live from HubSpot vs cached locally?
- What breaks if target-account tagging is poor?
- What happens when enrichment fails or returns weak evidence?

HOUR 6+ (polish/tests):
- What metrics prove repeat usage?
- What failure modes become silent trust killers?
- Which stale AI-facing docs would mislead coding agents if not updated?
```

### 0F. Mode Selection Confirmation

Selected mode for this review: **SELECTIVE EXPANSION**.

Why:
- the plan is directionally good,
- the current scope does not need a total reset,
- but it needs a few strategic additions before repo planning,
- and those additions should be judged, not silently assumed.

### CEO Dual Voices

#### CLAUDE SUBAGENT (CEO — strategic independence)
- Critical: plan prioritizes doc hygiene over product proof
- High: wedge is still too broad
- High: readiness for repo planning is asserted, not proven
- Critical: risk of building a summary pane no one reopens
- Critical: competitive thesis is missing
- High: security/privacy gate is being deferred too casually

#### CODEX SAYS (CEO — strategy challenge)
- The plan optimizes document coherence, not market-risk reduction
- The wedge is too broad and should collapse to one dominant job
- Trust validation should come before doc cleanup
- Workspace may not be the right first surface
- Native HubSpot UI is not a moat by itself
- Transcript ambiguity is strategic, not just planning detail
- People and Reasons to Talk may be the actual product, not a later slice

#### CEO DUAL VOICES — CONSENSUS TABLE

| Dimension | Claude | Codex | Consensus |
|---|---|---|---|
| Premises valid? | challenged | challenged | DISAGREE WITH PLAN |
| Right problem to solve? | partially | partially | DISAGREE WITH PLAN |
| Scope calibration correct? | too broad | too broad | CONFIRMED |
| Alternatives sufficiently explored? | no | no | CONFIRMED |
| Competitive / market risks covered? | weak | weak | CONFIRMED |
| 6-month trajectory sound? | risky | risky | CONFIRMED |

### Section 1. Architecture Review

The architecture documents are stronger than the execution plan. The problem is not missing technical vocabulary. It is that the execution plan still assumes a workspace-first surface and repo-planning-first sequence without first deciding the dominant job and moment of use.

Key issue:
- architecture readiness is downstream of product-surface choice. If the winning first surface is daily triage or alerting instead of record-view, the repo plan changes materially.

### Section 2. Error & Rescue Map

The largest silent-failure risk is not exception handling in code yet. It is planning silence around weak evidence, stale snapshots, incorrect account matching, and poor target-account hygiene.

#### Error & Rescue Registry

| Method / Codepath | What can go wrong | Rescue action | User sees |
|---|---|---|---|
| Dominant job selection | job stays broad and vague | force single-job decision before repo planning | clearer wedge, or explicit deferral |
| Moment-of-use selection | wrong primary surface chosen | compare record-view vs alert/briefing vs prep workflows | intentional surface choice |
| Trust validation | noisy signals are still surfaced | define minimum evidence/freshness/matching bar | fewer but more credible outputs |
| Transcript deferral decision | differentiated source gets deferred incorrectly | explicitly rate transcript value to wedge | transcript in or out, intentionally |
| AI-doc cleanup ordering | stale docs edited before truths are locked | move edits after wedge + repo decisions | docs updated once, correctly |

### Section 3. Security & Threat Model

A full security template is still premature. But the plan must add a **lightweight privacy and permission gate now** because transcripts, CRM data, and external enrichment can reshape the product architecture.

Required early security questions:
- what transcript retention is allowed,
- who can see enriched or inferred content,
- whether all users share the same account visibility,
- whether external data can be stored or only referenced,
- what audit trail is required for surfaced claims.

### Section 4. Data Flow & Interaction Edge Cases

The plan still under-specifies the real user interaction edge cases:
- no useful signals,
- weak signals,
- stale signals,
- target account flag missing or wrong,
- user opens workspace at the wrong moment for the product,
- the product surfaces missing-data warnings instead of helping action.

This section confirms that the first wedge must be judged by action quality, not only by UI completeness.

### Section 5. Code Quality Review

There is no implementation code yet. The code-quality equivalent here is **document duplication risk**.

Main issue:
- too many AI-facing docs are stale because they were allowed to become alternate truths.
- the fix is not “more docs.” The fix is a document precedence rule and a smaller number of edited downstream docs.

### Section 6. Test Review

Before implementation tests, the plan needs a **product-proof test plan**.

#### Test diagram mapping codepaths to coverage

```text
NEW UX FLOWS
- seller opens target account record
- seller reads summary + signals
- seller identifies one action worth taking
- seller returns later because something changed materially

NEW DATA FLOWS
- HubSpot source data -> canonical signals
- enrichment/transcript data -> evidence-linked signals
- signals -> snapshot assembly -> UI state

NEW CODEPATHS / DECISION PATHS
- eligible vs ineligible account
- fresh vs stale snapshot
- strong evidence vs weak evidence
- transcript in wedge vs transcript deferred

NEW ERROR / FAILURE PATHS
- enrichment unavailable
- target account tagging poor
- evidence too weak to show
- transcript association low confidence
```

#### Required non-code validation tests now
- 5-account workflow study
- trust review on top surfaced signals
- repeat-use trigger validation
- comparison of record-view vs pre-call-prep vs daily-briefing moment of use

### Section 7. Performance Review

The highest performance risk is not raw latency yet. It is freshness strategy.

If the value proposition is “why now,” then stale-but-polished snapshots can destroy trust faster than slow-but-current output. Repo planning must define the freshness model before snapshot architecture is treated as fixed.

### Section 8. Observability & Debuggability Review

The plan needs pilot metrics before engineering starts:
- repeat usage rate,
- action taken after viewing,
- signal usefulness rating,
- trust score on surfaced evidence,
- evidence freshness failure rate,
- weak-signal suppression rate.

Without these, the team can ship a beautiful pane and still not know whether it works.

### Section 9. Deployment & Rollout Review

The plan is missing a concrete pilot environment decision:
- internal-only first,
- which HubSpot portal(s),
- which user cohort,
- what feature flag or gating mechanism,
- what rollback means for a planning-only internal tool.

### Section 10. Long-Term Trajectory Review

The biggest long-term risk is path dependency toward a noun-shaped “workspace” instead of a verb-shaped action product. If the product wins because it tells sellers when and why to act, then the long-term trajectory should preserve that, not bury it under account-workspace completeness.

### Section 11. Design & UX Review

UI scope exists and the high-level hierarchy is good. But design intent is still missing one critical piece: **what the user should do first when they arrive, and why they would come back.**

This confirms a later deep design pass is justified, but only after the dominant job and moment of use are confirmed.

## What Already Exists — CEO Review View

- Strong product truth in the PRD
- Strong architecture truth in the Technical Design Document
- Strong durable-state boundaries in the Schema Design
- Strong first implementation slice in the Workspace Snapshot feature spec
- Strong original wedge reasoning in the office-hours design doc

## NOT in scope — CEO Review View

- full transcript review feature spec before repo planning
- full people-and-reasons feature spec before repo planning
- launch planning and release docs
- full security assessment template
- broad user testing documentation suite
- any new architecture doc that duplicates the Technical Design Document

## Failure Modes Registry

| Codepath | Failure mode | Rescued? | Test? | User sees? | Logged? |
|---|---|---|---|---|---|
| Product wedge selection | broad workspace with weak utility | N | N | low adoption | N |
| Moment-of-use choice | wrong surface chosen | N | N | feature ignored | N |
| Trust threshold | weak signals shown as useful | N | N | trust erosion | N |
| Transcript deferral | moat delayed or omitted incorrectly | N | N | weaker differentiation | N |
| AI doc ordering | stale docs mislead coding agents | Y | N | wrong implementation direction | N |

Any row above can become a critical gap if it remains unresolved before repo planning.

## Cross-Phase Theme Candidates

- **Theme: wrong first wedge** — surfaced independently by both outside voices
- **Theme: trust validation before build sequencing** — surfaced independently by both outside voices
- **Theme: document cleanup is not the real first bottleneck** — surfaced independently by both outside voices

## Completion Summary

```text
+====================================================================+
|            MEGA PLAN REVIEW — CEO PHASE SUMMARY                    |
+====================================================================+
| Mode selected        | SELECTIVE EXPANSION                         |
| System Audit         | strong core docs, weak wedge-locking       |
| Step 0               | dominant job, moment of use, trust missing |
| Section 1  (Arch)    | 1 major issue                              |
| Section 2  (Errors)  | 5 planning-level failure paths mapped      |
| Section 3  (Security)| 1 major early-gate issue                   |
| Section 4  (Data/UX) | 5 edge cases under-specified               |
| Section 5  (Quality) | 1 major doc-duplication issue              |
| Section 6  (Tests)   | product-proof tests required               |
| Section 7  (Perf)    | freshness strategy unresolved              |
| Section 8  (Observ)  | pilot metrics unresolved                   |
| Section 9  (Deploy)  | pilot environment unresolved               |
| Section 10 (Future)  | workspace trap risk high                   |
| Section 11 (Design)  | deep pass warranted after premise lock     |
+--------------------------------------------------------------------+
| NOT in scope         | written                                     |
| What already exists  | written                                     |
| Dream state delta    | written                                     |
| Error/rescue registry| written                                     |
| Failure modes        | written                                     |
| Scope proposals      | 6 surfaced, 6 accepted as recommendations  |
| CEO plan             | embedded in this plan review                |
| Outside voices       | ran (codex + subagent)                     |
+====================================================================+
```

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 1 | CEO | Treat this as SELECTIVE EXPANSION, not HOLD SCOPE | Mechanical | P1 + P2 | The plan is directionally good but missing product-risk reducers. | HOLD SCOPE |
| 2 | CEO | Defer Transcript Review Queue feature spec before repo planning | Mechanical | P3 + P4 | Existing docs are sufficient unless transcripts become part of the smallest winning wedge. | Spec now |
| 3 | CEO | Challenge doc-cleanup-first sequencing | User Challenge candidate | P1 | Both outside voices say this optimizes internal coherence over market proof. | Keep current ordering |
| 4 | CEO | Add dominant job, moment-of-use, and trust threshold as required planning inputs | Mechanical | P1 + P5 | These reduce existential risk more than more templates do. | Leave implicit |
| 5 | CEO | Treat AI Coding Rules, Product Brief, and Spec for AI Prototyping as edit targets, not net-new docs | Mechanical | P4 + P5 | They should inherit from current truths, not become parallel truths. | Create replacements |
| 6 | CEO | Add lightweight privacy/security gate before repo planning | Mechanical | P1 | Transcript + CRM + enrichment handling can change architecture early. | Defer all security planning |

## Premise Gate Status

Approved by user: **B — lock the wedge first, then repo plan, then edit AI-facing docs.**

This means the remainder of the review treats the following as confirmed:
- define the single dominant job first,
- define the primary moment of use first,
- define the trust threshold first,
- then do repo planning,
- then update AI-facing docs to match the locked wedge.

**Phase 1 complete.** Codex: 15 concerns. Claude subagent: 12 issues. Consensus: 4/6 confirmed, 2 dimensions challenged against the original plan. Passing to Phase 2.

## Design Review — Phase 2

### Step 0. Design Scope Assessment

#### Initial design rating
**4/10** on design completeness.

Why:
- the plan now has stronger strategic self-awareness,
- but the actual seller-facing interaction contract is still vague,
- state behavior is mostly named, not designed,
- responsiveness and accessibility are effectively absent,
- and the first-screen action is unresolved because the dominant job is unresolved.

#### What a 10/10 looks like for this plan
A 10/10 version would specify:
- the single dominant seller job,
- the primary moment of use,
- the first useful action on arrival,
- explicit state behavior for empty / stale / degraded / low-confidence / restricted cases,
- trust display rules for freshness, confidence, and provenance,
- responsive posture for HubSpot desktop first,
- accessibility basics as non-negotiable UX contract.

#### DESIGN.md status
No DESIGN.md found in the planning directory.

Decision:
- Proceed with universal design principles.
- Do not block planning on design-system creation yet.

#### Existing design leverage
Use these existing design truths, not generic B2B defaults:
- signal-first hierarchy from the PRD,
- evidence-led output only,
- no fake scores,
- no dashboard bloat,
- People as cards,
- Signals as list/detail,
- Plan as lightweight tactical brief.

### Design Outside Voices

#### CLAUDE SUBAGENT (design — independent review)
- Critical: information hierarchy still centers planning mechanics, not seller experience
- High: first action on arrival is undefined
- Critical: state behavior is named, not designed
- High: emotional arc and trust recovery are under-specified
- High: people/reasons may be actual core value but are still treated as later module
- High: freshness is backend logic without visible UX contract

#### CODEX SAYS (design — UX challenge)
- hierarchy is developer-first
- state design is still implicit
- responsive strategy is absent
- accessibility is omitted
- UI nouns are present but concrete design decisions are missing
- workspace-first framing remains unstable until wedge and moment of use are locked

#### DESIGN OUTSIDE VOICES — LITMUS SCORECARD

| Check | Claude | Codex | Consensus |
|---|---|---|---|
| Brand / product unmistakable in first screen? | NOT SPEC'D | NO | FAIL |
| One strong visual anchor? | NOT SPEC'D | NO | FAIL |
| Scannable by headlines only? | PARTIAL | PARTIAL | PARTIAL |
| Each section has one job? | PARTIAL | PARTIAL | PARTIAL |
| Cards actually necessary? | PARTIAL | PARTIAL | PARTIAL |
| Motion improves hierarchy? | NOT SPEC'D | NOT SPEC'D | NOT SPEC'D |
| Premium without decorative shadows? | NOT SPEC'D | NOT SPEC'D | NOT SPEC'D |
| Hard rejections triggered | generic pane risk | generic pane risk | CONFIRMED |

### Pass 1. Information Architecture
**4/10 → 7/10 after review additions**

What was missing:
- the plan named sections, but not the seller's first decision,
- the hierarchy still privileged planning over action.

Fix required:
The plan must explicitly define the first-screen decision model:
1. one dominant reason this account deserves attention now,
2. one recommended action,
3. supporting evidence,
4. only then secondary context.

### Pass 2. Interaction State Coverage
**3/10 → 7/10 after review additions**

What was missing:
- no state matrix,
- no distinction between weak evidence, stale evidence, missing evidence, and source outage,
- no clear user recovery path.

Required additions:
Every core surface needs explicit behavior for:
- no useful signals,
- stale snapshot,
- degraded source,
- low-confidence evidence,
- target-account flag missing or wrong,
- permissions-restricted evidence,
- transcript-derived evidence withheld.

### Pass 3. User Journey & Emotional Arc
**4/10 → 7/10 after review additions**

What was missing:
- arrival emotion,
- first confidence moment,
- trust repair behavior when the system is weak.

Required storyboard:
- arrive skeptical,
- see one credible reason to care,
- inspect evidence,
- feel safe acting,
- know why to return later.

### Pass 4. AI Slop Risk
**5/10 → 8/10 after review additions**

What was good:
- the plan already rejects fake scores, dashboard bloat, and generic architecture duplication.

What still risks slop:
- the UI is still described through generic nouns: summary card, ranked feed, contact cards, plan object.
- without sharper behavior rules, implementation can still drift into a generic AI summary pane.

Fix:
Define the winning behavior before adding more UI nouns.

### Pass 5. Design System Alignment
**5/10 → 6/10 after review additions**

No local DESIGN.md exists, so strict design-token alignment is impossible.

Practical fix:
Treat PRD + technical design + first feature spec as the temporary design contract until a proper design-system artifact exists.

### Pass 6. Responsive & Accessibility
**2/10 → 5/10 after review additions**

Biggest gaps:
- no explicit desktop-first statement in the implementation plan itself,
- no keyboard behavior,
- no focus order,
- no screen-reader expectations,
- no contrast/touch target rules.

Required minimum contract:
- optimize for HubSpot desktop record view first,
- define keyboard navigation across top sections,
- ensure evidence and warning states are announced textually, not by color alone,
- require semantic labeling for cards, lists, and status indicators.

### Pass 7. Unresolved Design Decisions

#### Decisions that will haunt implementation if left ambiguous
1. What exact seller action should happen first on page arrival?
2. Is the primary object an **account signal** or a **person to contact**?
3. What does low-confidence output look like in the UI?
4. What does a degraded-but-usable workspace look like?
5. Is the plan object read-only recommendation, tactical brief, or persistent workflow artifact?
6. Does the product optimize for record-view, pre-call prep, daily triage, or manager review first?

### Approved Mockups
No mockups generated in this phase.

Reason:
There is no active implementation repo or design binary flow in this planning workspace, and the wedge is still being locked. Generating visuals before the dominant job and moment of use are fixed would create false certainty.

### Design Completion Summary

```text
+====================================================================+
|         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
+====================================================================+
| System Audit         | no DESIGN.md, UI scope present              |
| Step 0               | 4/10 initial rating                         |
| Pass 1  (Info Arch)  | 4/10 -> 7/10                               |
| Pass 2  (States)     | 3/10 -> 7/10                               |
| Pass 3  (Journey)    | 4/10 -> 7/10                               |
| Pass 4  (AI Slop)    | 5/10 -> 8/10                               |
| Pass 5  (Design Sys) | 5/10 -> 6/10                               |
| Pass 6  (Responsive) | 2/10 -> 5/10                               |
| Pass 7  (Decisions)  | 6 unresolved design decisions              |
+--------------------------------------------------------------------+
| NOT in scope         | written                                     |
| What already exists  | written                                     |
| Approved Mockups     | 0 generated                                 |
| Overall design score | 4/10 -> 6/10                               |
+====================================================================+
```

### Design Review Verdict
The plan is **not design-complete yet**.

It is stronger than before, but it still needs the wedge lock to translate into a real UX contract. The biggest remaining design gaps are:
- first-screen action,
- state behavior,
- responsive posture,
- accessibility contract,
- and whether people/reasons are actually core to V1.

**Phase 2 complete.** Codex: 6 major UX concerns. Claude subagent: 10 design issues. Consensus: 3/7 partially aligned failures, 2/7 clear failures, 2/7 not spec'd. Passing to Phase 3.

## Engineering Review — Phase 3

### Step 0. Scope Challenge

The plan is **not yet architecture-ready for repo planning**.

Why:
- the repo and auth/install model are unresolved,
- the dominant job and moment of use are unresolved,
- the trust/freshness/privacy gates are identified but not promoted into required outputs,
- the current authoritative sections still point to a now-challenged execution order.

#### Main engineering conclusion
The current risk is not under-documentation. It is **premature architecture lock-in** around a workspace-first slice order before product and trust gates are locked.

### Existing implementation leverage
Because there is no selected repo, engineering leverage is still doc-level leverage:
- PRD for scope and source-of-truth principles
- Technical Design for architecture boundaries
- Schema Design for durable entities and queue tables
- Workspace Snapshot feature spec for first buildable slice
- Office-hours design doc for rationale and wedge origin

### Engineering Dual Voices

#### CLAUDE SUBAGENT (eng — independent review)
- Critical: repo planning is still premature
- High: workspace-first is still being treated as architecture, not product assumption
- Critical: data-boundary decision is missing
- High: error paths are named, not operationalized
- Critical: auth/install model unresolved
- Critical: security/privacy gate too casually deferred
- High: test inventory missing where trust can fail

#### CODEX SAYS (eng — architecture challenge)
- the plan contains two incompatible execution orders
- slice order is hard-committed before the dominant job is resolved
- transcript scope is both deferred and required
- trust / freshness / privacy gates are still comments, not actual gates
- appended review findings have not yet rewritten the authoritative top sections

#### ENG DUAL VOICES — CONSENSUS TABLE

| Dimension | Claude | Codex | Consensus |
|---|---|---|---|
| Architecture sound? | no | no | FAIL |
| Test coverage sufficient? | no | no | FAIL |
| Performance risks addressed? | partial | partial | PARTIAL |
| Security threats covered? | no | no | FAIL |
| Error paths handled? | no | no | FAIL |
| Deployment risk manageable? | no | no | FAIL |

### Section 1. Architecture Review

#### Architecture ASCII diagram

```text
CURRENT PLANNED SHAPE

HubSpot Company Record
        |
        v
Workspace UI Surface
        |
        v
Snapshot Endpoint
        |
        +----------------------+
        |                      |
        v                      v
Canonical Signals        Local Snapshot Store
        |                      |
        +----------+-----------+
                   |
                   v
Evidence / Enrichment / Transcript Sources
                   |
                   v
HubSpot + Exa + Harvest + Transcript Inputs
```

#### Architectural problem
This looks plausible, but it assumes the record-view workspace is the correct primary surface. If that assumption changes, the interface contracts, freshness rules, and caching strategy all change.

#### Required architectural gate outputs
Before repo planning, the plan must produce:
1. dominant user job,
2. primary moment of use,
3. transcript role in V1,
4. source-of-truth matrix,
5. auth/install model,
6. trust/freshness threshold.

### Section 2. Code Quality Review

There is no repo yet, so classic code-quality review is replaced by **plan-quality review**.

Main quality issue:
- the plan currently has two conflicting canonical orders,
- and the corrected review findings are appended instead of being merged into the authoritative top sections.

That means an implementation agent can still read the wrong order and act on it.

### Section 3. Test Review

#### Test diagram mapping codepaths to coverage

```text
NEW UX FLOWS
- seller opens target account workspace
- seller reads why-now output
- seller inspects evidence
- seller identifies action or person to contact
- seller returns because something changed materially

NEW DATA FLOWS
- HubSpot company/account data -> canonical workspace inputs
- enrichment/transcript inputs -> evidence-linked signals
- signals -> snapshot assembly -> UI states

NEW CODEPATHS
- eligible vs ineligible account
- no useful evidence vs credible evidence
- fresh vs stale snapshot
- degraded source vs healthy source
- transcript-associated vs transcript-suppressed
- person-first vs signal-first action model

NEW BACKGROUND / ASYNC WORK
- snapshot refresh
- evidence refresh
- transcript ingestion / association
- degraded source recovery

NEW ERROR / RESCUE PATHS
- enrichment unavailable
- stale snapshot shown
- target-account gating wrong
- low-confidence transcript match
- permissions-restricted evidence
- live HubSpot state disagrees with snapshot
```

#### Test coverage verdict
Current planning is missing explicit tests for:
- trust threshold enforcement,
- evidence suppression,
- freshness behavior,
- transcript low-confidence handling,
- permissions restrictions,
- target-account gating failures,
- degraded but usable UI states.

#### Test plan artifact
Written to:
`/Users/romeoman/.gstack/projects/hubspot-account-planning-ui-extension/romeoman-unknown-eng-review-test-plan-20260410-132900.md`

### Section 4. Performance Review

The highest performance risk is freshness, not pure latency.

Key issue:
- a polished but stale workspace is worse than a sparse but current one for a “why now” product.

The plan must define:
- freshness SLAs by source,
- invalidation triggers,
- snapshot TTL,
- stale suppression rules,
- visible recency contract in the UI.

### Section 5. Security / Threat Review

A separate full security template is still unnecessary right now, but a **lightweight security gate is mandatory before repo planning**.

That gate must define:
- transcript retention rules,
- role/portal visibility rules,
- external enrichment storage rules,
- provenance/audit requirements,
- secret handling,
- redaction / sanitization policy for external or inferred text.

### Section 6. Failure Modes Review

#### Failure Modes Registry

| Codepath | Failure mode | Rescued? | Test? | User sees? | Logged? |
|---|---|---|---|---|---|
| Workspace entry surface | wrong moment of use chosen | N | N | low adoption | N |
| Snapshot assembly | stale-but-polished result | N | N | misleading confidence | N |
| Enrichment path | source outage with partial data | N | N | confusing output | N |
| Transcript path | low-confidence association promoted | N | N | false claim | N |
| Permissions path | restricted evidence shown or hidden incorrectly | N | N | trust or privacy failure | N |
| Target gating | account incorrectly included/excluded | N | N | broken workflow | N |

Any unresolved row above is a **critical gap** before repo planning.

### Section 7. Observability & Debuggability Review

The plan needs pilot metrics before build:
- repeat usage rate,
- action taken after view,
- signal usefulness rating,
- evidence freshness failure rate,
- weak-signal suppression rate,
- permission-denied / restricted-evidence frequency,
- transcript association review rate.

### Section 8. Deployment & Rollout Review

The rollout path is still under-specified.

Required outputs before repo planning:
- which HubSpot portal(s) host the pilot,
- which users are in the pilot,
- whether install/auth is internal-only,
- what feature-flag or access-gating model exists,
- what rollback means if trust is low.

### Section 9. Long-Term Trajectory Review

The long-term engineering trap is clear:
- if the wrong first surface gets locked,
- all later systems will optimize around a workspace that may not be the actual winning product shape.

### Section 10. Worktree / Parallelization Strategy

**Sequential implementation, no parallelization opportunity yet.**

Reason:
There is no chosen repo and too many top-level architectural gates are unresolved. Parallelization now would amplify churn.

### Engineering Completion Summary

```text
+====================================================================+
|         ENG PLAN REVIEW — COMPLETION SUMMARY                       |
+====================================================================+
| Scope challenge      | repo planning still premature               |
| Architecture         | needs gate outputs before repo selection    |
| Code quality         | canonical plan order currently conflicts    |
| Tests                | trust/state/freshness tests missing         |
| Performance          | freshness model unresolved                  |
| Security             | lightweight gate required now               |
| Failure modes        | multiple critical silent-failure risks      |
| Deployment           | pilot environment unresolved                |
| Long-term trajectory | workspace-first lock-in still risky         |
+--------------------------------------------------------------------+
| NOT in scope         | written                                     |
| What already exists  | written                                     |
| Architecture diagram | written                                     |
| Test diagram         | written                                     |
| Test plan artifact   | written                                     |
| Failure modes        | written                                     |
| Dual voices          | ran (codex + subagent)                     |
+====================================================================+
```

### Cross-Phase Themes

- **Theme: wedge not locked** — flagged by CEO, design, and engineering
- **Theme: document cleanup is not the first bottleneck** — flagged by CEO and engineering
- **Theme: workspace-first may be the wrong primary surface** — flagged by CEO, design, and engineering
- **Theme: trust/freshness needs to become a gate, not a comment** — flagged by CEO, design, and engineering

**Phase 3 complete.** Codex: 4 major architecture concerns. Claude subagent: 14 engineering issues. Consensus: 1/6 partial, 5/6 failures.
