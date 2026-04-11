# HubSpot Signal-First Account Workspace — QA & Verification Plan

## Recommendation
Yes, we should have a QA plan.

The current **engineering review test plan** is a strong base artifact, but it is not enough by itself.

Why:
- it captures engineering test coverage,
- but we also need a product-facing QA and verification layer,
- especially because this wedge is trust-sensitive,
- and because stale / degraded / low-confidence / permission-restricted states are part of the product, not just edge cases.

So the right setup is:
1. **Engineering Review Test Plan** = implementation-facing test artifact
2. **QA & Verification Plan** = cross-functional pass/fail checklist for product, design, engineering, and security

---

## Scope

This QA plan covers only the locked wedge:
- one credible reason to contact this account now
- up to 3 people plus reason to talk
- HubSpot company record view (`crm.record.tab`)
- transcript work deferred

It does not cover:
- transcript review queue
- full account planning suite
- broad analytics/dashboard workflows
- multi-surface experiences beyond the company record view

---

## Why QA is needed in addition to engineering tests

This product can fail in ways that unit/integration tests alone will not catch:
- the recommendation is technically valid but commercially weak
- the UI implies confidence where evidence is weak
- stale data looks current
- restricted data leaks through summaries
- the “3 people” object feels worse than a simpler company-level reason
- degraded provider output is shown in a misleading way

That means QA here is not just bug-finding.
It is **trust verification**.

---

## Quality Risks

Highest-risk failure modes:
1. A weak reason-to-contact is surfaced as credible
2. Low-confidence evidence is not visually obvious
3. Stale evidence is shown without enough warning
4. Restricted evidence is shown or indirectly summarized
5. Fewer than 3 usable contacts breaks the UI or creates filler output
6. The wedge feels like dashboard bloat instead of one clear action
7. The company-record surface turns out to be the wrong moment of use, but the team does not notice early

---

## Test Layers

### 1. Unit tests
Validate:
- trust threshold logic
- freshness calculations
- provider normalization
- evidence suppression rules
- ranking logic for people + reasons

### 2. Integration tests
Validate:
- snapshot assembly
- provider degradation handling
- permission filtering
- empty / stale / low-confidence response contracts
- fewer-than-3-contacts behavior

### 3. HubSpot UI extension tests
Validate:
- `crm.record.tab` rendering
- current record context usage
- association-based contact retrieval behavior
- state rendering inside the company-record extension environment

### 4. E2E tests
Validate:
- eligible company with strong evidence
- eligible company with fewer than 3 usable contacts
- empty/no credible reason state
- stale state
- degraded source state
- low-confidence state
- ineligible state
- evidence inspection flow

### 5. Manual QA
Validate:
- does the recommendation feel useful?
- does the UI feel trustworthy?
- does the first screen push one clear action?
- does the output feel like a focused wedge instead of a bloated workspace?

---

## Core Scenarios That Must Pass

### Scenario A: Eligible company, strong evidence
Pass if:
- one clear reason-to-contact appears
- 3 people or fewer if fewer are truly usable
- evidence is inspectable
- freshness is visible
- no fake scoring appears

### Scenario B: Eligible company, fewer than 3 usable contacts
Pass if:
- UI degrades gracefully
- no filler contacts are invented
- company-level reason still works

### Scenario C: No credible reason available
Pass if:
- explicit empty state is shown
- system does not fabricate a recommendation
- user understands why no recommendation exists

### Scenario D: Stale state
Pass if:
- stale label is obvious
- age is visible
- recommendation is treated cautiously

### Scenario E: Degraded source state
Pass if:
- system-level degradation is visible
- degraded source is not disguised as low confidence
- healthy evidence can still appear if valid

### Scenario F: Low-confidence state
Pass if:
- confidence/provenance is visible
- UI semantics clearly distinguish low-confidence output
- weak content does not dominate the screen

### Scenario G: Ineligible state
Pass if:
- the user gets a clear ineligible state
- no misleading partial recommendation appears

---

## State Matrix

| State | Must QA Verify |
|---|---|
| Eligible + strong evidence | recommendation clarity, trust, freshness, evidence drill-in |
| Eligible + <3 contacts | graceful degradation, no fabricated contacts |
| Empty / no credible reason | explicit empty state, no fabricated recommendation |
| Stale | visible age + caution treatment |
| Degraded | visible source/system issue, not disguised |
| Low-confidence | visible confidence + provenance treatment |
| Ineligible | explicit gating state |
| Restricted evidence | never surfaced, never summarized |

---

## Security & Permission Checks

QA must explicitly verify:
- object-level permission enforcement
- restricted evidence is never shown or summarized
- provider secrets never appear in client-side output
- no transcript-derived data appears anywhere in V1
- role/permission mismatches fail closed, not open

This QA plan depends on the Security / Permission Gate.

---

## Evidence & Trust Checks

QA must verify that every surfaced recommendation has:
- visible source
- visible freshness/timestamp
- visible confidence/provenance treatment when needed
- suppression when evidence is too weak
- no fake scores or synthetic trust gestures

If evidence is weak, the system should prefer **silence over bluffing**.

---

## Acceptance Checklist

Before implementation starts in earnest:
- [ ] Engineering Review Test Plan linked into repo planning
- [ ] QA & Verification Plan accepted as companion artifact
- [ ] Security / Permission Gate accepted
- [ ] trust threshold defined
- [ ] fewer-than-3-contacts behavior defined
- [ ] stale / degraded / low-confidence / ineligible states defined
- [ ] no transcript boundary confirmed

Before V1 release:
- [ ] all core scenarios pass
- [ ] no restricted evidence leakage
- [ ] no fabricated reasons or contacts
- [ ] stale and degraded states are understandable to users
- [ ] evidence drill-in works
- [ ] product still feels like one clear wedge, not dashboard bloat

---

## Relationship to existing artifacts

This plan should be used together with:
- `ENGINEERING_REVIEW_TEST_PLAN.md`
- `SECURITY_PERMISSION_GATE.md`
- `IMPLEMENTATION_PLAN.md`
- `REPO_DRAFT_AND_EXECUTION_CHECKLIST.md`

---

## Recommendation for next step

Add this as a ChatPRD doc too, if possible.

If ChatPRD MCP is slow or timing out, keep this local copy as the working source and retry the MCP write later.
