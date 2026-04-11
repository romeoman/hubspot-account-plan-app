# Planning Document Index — HubSpot Account Plan App

Local destination: `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App`

## Current status
This index is the top-level map for the planning bundle.

Use it to find:
- the ChatPRD-aligned local copies
- the local-only review and planning artifacts
- the Taskmaster execution inputs
- the most important ChatPRD source links

Transcript work remains deferred.

---

## 1. Core ChatPRD-aligned local copies

- `planning/chatprd/AI_CODING_RULES_AND_STANDARDS.md`
- `planning/chatprd/PRODUCT_BRIEF_FOR_AI_DEVELOPMENT.md`
- `planning/chatprd/IMPLEMENTATION_PLAN.md`
- `planning/chatprd/REPO_DRAFT_AND_EXECUTION_CHECKLIST.md`
- `planning/chatprd/SECURITY_PERMISSION_GATE.md`
- `planning/chatprd/SPEC_FOR_AI_PROTOTYPING.md`

## 2. Local planning and review artifacts

- `planning/local/ENGINEERING_REVIEW_TEST_PLAN.md`
- `planning/local/LOCAL_REPO_DRAFT_AND_CHECKLIST.md`
- `planning/local/LOCAL_IMPLEMENTATION_PLAN_WITH_AUTOPLAN_REVIEW.md`
- `planning/local/OFFICE_HOURS_DESIGN_DOC.md`
- `planning/local/SECURITY_PERMISSION_GATE.md`
- `planning/local/SPEC_FOR_AI_PROTOTYPING.md`
- `planning/local/QA_AND_VERIFICATION_PLAN.md`
- `planning/local/TASKMASTER_EXECUTION_PRD.md`
- `planning/local/AI_CODING_RULES_AND_STANDARDS.md`
- `planning/local/DOC_STACK_REVIEW_NOTES.md`
- `planning/local/STACK_HOSTING_AND_TEST_ENV_NOTES.md`

## 3. Taskmaster execution inputs

- `.taskmaster/docs/prd.md`
- `planning/local/TASKMASTER_EXECUTION_PRD.md`

Purpose:
- `.taskmaster/docs/prd.md` is the execution-facing PRD for `task-master parse-prd`
- the local copy exists so the execution PRD remains visible in the planning bundle even before repo bootstrap is complete

## 4. Repo-level Claude Code contract

- `CLAUDE.md`

Purpose:
- this is the concise repo-level operating contract for Claude Code
- it references the planning files instead of duplicating the full planning stack
- it enforces stack rules, modular/config-driven architecture, current-doc checks, verification discipline, and the TDD rule

---

## 5. Recommended reading order

If someone is joining the project or starting repo bootstrap, read in this order:

1. `planning/chatprd/IMPLEMENTATION_PLAN.md`
2. `planning/chatprd/SECURITY_PERMISSION_GATE.md`
3. `planning/local/QA_AND_VERIFICATION_PLAN.md`
4. `planning/chatprd/AI_CODING_RULES_AND_STANDARDS.md`
5. `CLAUDE.md`
6. `.taskmaster/docs/prd.md`
7. `planning/chatprd/REPO_DRAFT_AND_EXECUTION_CHECKLIST.md`

---

## 5. Best current source documents in ChatPRD

### Implementation Plan
https://app.chatprd.ai/chat/9a823a82-230a-4d69-99f2-8f8ab0ad85bf?doc=7321e14b-ada3-4265-a4e9-d1cda84dfe55&vers=e4f12945-0e88-4975-bd8f-faa2edc0ce54

### AI Coding Rules & Standards
https://app.chatprd.ai/chat/8f94764f-40d2-4ec7-af32-6acddc224c80?doc=7d454b45-7ac2-4c28-83d6-76570c9b245e

### Product Brief for AI Development
https://app.chatprd.ai/chat/a6cc6c7f-f81a-44cd-a58f-d0a103a62ae8?doc=b39ce5e7-480e-44f1-9fe8-88bc591308f4

### Repo Draft & Execution Checklist
https://app.chatprd.ai/chat/b3484579-353d-439d-9126-da35d7955fde?doc=d1591ae5-b3cd-4595-8238-a6005502d785&vers=464aa340-0564-4bf8-a397-7ac60b838948

### Security / Permission Gate
https://app.chatprd.ai/chat/fec5394b-cfd7-48ba-96e9-2356656ef0d0?doc=ed0efb92-7e4e-4716-8674-f9013e8f01e8&vers=327f5454-212c-46c7-8c05-d27dc2100ab7

### Spec for AI Prototyping
https://app.chatprd.ai/chat/2cdfb7f1-cd53-4fc1-8b99-383cbd2a06c4?doc=deacf6b3-ef2f-4930-a4fa-0d48019cb2d4&vers=0fef3cf0-b259-4d87-a733-5bbacfc1e1cb

### QA & Verification Plan
https://app.chatprd.ai/chat/1ebac952-f6d6-461b-8c4b-982e49146e8b?doc=7aed1d8b-2b0d-4b37-bb52-9bfdedec013a&vers=ef0be73a-faa2-44bb-a8f9-235af86a894b

---

## 6. Important notes

- The engineering review test plan remains the best implementation-facing test artifact.
- The QA & Verification Plan is the cross-functional trust and release gate.
- The Security / Permission Gate should be treated as binding for install, retention, permission, and suppression decisions.
- The Taskmaster execution PRD is intentionally thinner than the full doc stack and should not replace upstream planning documents.
- If any conflict appears between local mirrors and ChatPRD, use the document precedence rules from the AI Coding Rules & Standards.

---

## 7. Current honest assessment

The planning stack is strong, but not perfectly polished.

Strongest documents:
- AI Coding Rules & Standards
- Security / Permission Gate
- Product Brief for AI Development
- Spec for AI Prototyping
- CLAUDE.md as the repo-level Claude Code contract

Still worth tightening over time:
- QA & Verification Plan
- Repo Draft & Execution Checklist

Important:
- the index is now clear and usable, but it should still be updated any time a new binding planning file is added
- CLAUDE.md and `.taskmaster/docs/prd.md` now both include explicit full-path references to the active planning files so local agents do not miss them

See:
- `planning/local/DOC_STACK_REVIEW_NOTES.md`
