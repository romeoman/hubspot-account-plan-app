# HubSpot AI Prototyping Spec — Locked Signal Wedge

## Overview

This AI prototyping spec validates a single high-impact product slice within the HubSpot company record view. It is separate from product briefs and AI coding rules.

---

## Locked Prototype Wedge

- Dominant Job: one credible, explainable reason to contact a specific HubSpot account company
- Primary Moment of Use: company record view (`crm.record.tab`) on desktop
- Primary Action Object: up to three surfaced people plus supporting evidence and reason to talk
- Transcript Work: deferred
- Prototype Implementation: new dedicated GitHub repo

---

## Focused Product Promise

When a user opens a HubSpot company record:
- they instantly see one credible reason to contact now
- they see up to three people linked to that reason
- each person/reason includes inspectable evidence
- users can always see whether data is stale, degraded, low-confidence, or unavailable

---

## Explicitly Removed Old Assumptions

- no broad multi-tab workspace or dashboard as the prototype goal
- no generic research-report behavior
- no transcript flows or transcript summaries
- no fake scoring, engagement rings, or ranking widgets
- no broad account-planning, analytics, or summary utilities

---

## Current Prototype Assumptions

- native HubSpot UI extension/app card host
- deploy at company record view using `crm.record.tab`
- built using React with hsmeta
- desktop-first, company-record-centric usage flow
- evidence, provenance, and freshness always visible

---

## Modular Prototyping Guidance

- provider/integration logic is abstracted at the provider layer
- no hardcoded provider names or forever assumptions
- confidence/freshness thresholds are configurable, not UI magic numbers
- future settings/install/config flows should remain possible later

---

## Prototype Requirements and States

Core UI:
- embedded app card in `crm.record.tab`
- one reason to contact now with clear evidence
- up to three people with role and reason-to-talk context
- snippet, source, timestamp, freshness/confidence labels
- evidence inspection on click/hover

Required states:
- eligible: strong evidence
- eligible: fewer than 3 usable contacts
- empty/no credible reason
- stale state
- degraded source state
- low-confidence state
- ineligible state

---

## What the Prototype Must Prove

- the company-record UI surface feels right
- one reason-to-contact now is understandable and actionable
- 3-people-plus-reason is better than a generic account summary
- evidence display builds trust
- the wedge does not feel like dashboard bloat

---

## What to Prototype Next Only If This Works

- richer evidence drill-in
- next-move suggestion layer
- context and hygiene layers only if they do not dilute the wedge
- transcript/call summary integration later, not now
