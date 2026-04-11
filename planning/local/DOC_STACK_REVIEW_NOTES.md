# HubSpot Signal-First Account Workspace — Doc Stack Review Notes

## Verdict

The stack is **good, but not ideal yet**.

It is strong enough to use, but two documents still need tightening before the overall planning bundle should be considered fully polished:

- `QA_AND_VERIFICATION_PLAN.md`
- `LOCAL_REPO_DRAFT_AND_CHECKLIST.md` / ChatPRD repo draft equivalent

---

## Strong Documents

### AI Coding Rules & Standards
Why it is strong:
- wedge-locked
- modular and config-driven
- clear no-hardcoding rules
- aligned to HubSpot UI extension realities
- document precedence is explicit

### Security / Permission Gate
Why it is strong:
- explicit scope matrix requirement
- explicit warning that app scopes do not equal installer visibility
- real retention requirements
- hard transcript boundary
- clearer evidence-state categories
- concrete pre-implementation artifact requirement

### Product Brief for AI Development
Why it is strong:
- clearly separate from coding rules
- focused on the locked wedge
- useful AI-builder handoff
- not trying to duplicate the PRD

### Spec for AI Prototyping
Why it is strong enough:
- old broad workspace assumptions removed
- prototype states are explicit
- locked wedge is clear
- transcript is deferred

---

## Good, But Not Ideal

### Implementation Plan
Useful, but slightly too optimistic at the end.

Why:
- it says the plan is now actionable for repo planning
- that is mostly true
- but a few repo-init decisions still need to become concrete bootstrap tasks rather than just open decisions

This is acceptable, just not perfect.

---

## Needs Tightening

### QA & Verification Plan
Main issues:
- still contains template-style PM language
- some success metrics feel invented or overly polished
- some sections feel like general product documentation rather than a hard QA artifact
- should become more like a pass/fail verification contract

Recommended direction:
- remove inflated metrics
- reduce narrative and generic goal language
- make scenario ownership and pass/fail checks more explicit
- tie directly to engineering review test plan and security gate

### Repo Draft & Execution Checklist
Main issues:
- still reads too much like a generalized generated document
- repo shape and setup guidance should be sharper
- some milestones and goals feel generic instead of repo-bootstrap-specific
- needs more execution detail and less program-management language

Recommended direction:
- define exact repo folders
- define exact docs to import into the repo
- define exact first issues / milestones
- define exact bootstrap checklist
- reduce fluff

---

## Recommendation

Before calling the stack ideal:
1. tighten the QA & Verification Plan
2. tighten the Repo Draft & Execution Checklist
3. then proceed to repo creation from the cleaned stack

## Working rating

- Core stack: good
- Security gate: good
- AI handoff docs: good
- QA doc: needs tightening
- Repo draft: needs tightening

Overall: **close, but not ideal yet**.
