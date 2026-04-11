# HubSpot Account Contact Wedge — Product Brief for AI Development

## Purpose

This is a concise, execution-focused summary for AI builders. It is separate from AI Coding Rules and exists to clarify the immediate product wedge: rapidly surfacing one credible reason to contact an account, and the three best people to reach out to, directly in the HubSpot company record view.

Use the PRD, Technical Design, Database Schema Design, Feature Implementation Spec, and Implementation Plan as upstream truth.

---

## Locked Wedge for MVP

- **Dominant job:** Give one credible, current reason to contact this specific account.
- **Primary moment of use:** Company record in HubSpot.
- **Primary action object:** 3 associated people plus the system's reason to talk.
- **Transcript work:** Deferred.
- **Implementation:** New GitHub repo.

---

## Product Promise

When a user opens a HubSpot company record:
- they get one credible and current reason to contact the account now,
- they see three people at the account plus the specific reason to begin a conversation,
- they can inspect supporting evidence,
- they can act quickly.

---

## Design and Modularity Principles

- Integrations to external data or signal providers must be modular and configuration-driven.
- No assumption that any third-party provider is permanent.
- Trust, provenance, and freshness are core product requirements.
- Settings and mappings should be governed via config or admin UI, not static wiring.

---

## HubSpot Platform Assumptions

- Native HubSpot UI extension/app card on company records using `crm.record.tab`.
- React-based UI extension, registered via `hsmeta`.
- Current company record context and associations come from HubSpot SDK hooks.
- CRM object APIs, association APIs, and permission scopes matter for implementation.
- Webhooks/event ingestion may be required later, but transcript-specific work is deferred in this wedge.

---

## Out of Scope for This Wedge

- Transcript review queue
- Full account planning suite
- Fake scoring systems
- Dashboard-heavy analytics surfaces
- Broad generic research reports

---

## What the AI Builder Should Do Next

1. Create the new GitHub repo.
2. Plan slice 1 around one high-confidence reason-to-contact plus the top 3 people.
3. Map settings, install, and config needs early.
4. Use upstream docs for all detailed decisions.
5. Only update downstream AI-facing docs after the repo-level plan is stable.
