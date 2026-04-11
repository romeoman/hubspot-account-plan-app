# HubSpot Signal-First Account Workspace — Security & Permission Gate (V1)

## TL;DR

This document defines the absolute minimum security, privacy, permission, and installation constraints for the HubSpot Signal-First Account Workspace V1. It is strictly practical and scoped for first-version launch. All requirements are binding and must be satisfied before implementation work proceeds.

---

## V1 Scope Strategy and App Scopes

Before any code or HubSpot app registration, the team must produce a concrete scope matrix enumerating all OAuth/app scopes. Each scope must be tagged as:
- Required
- Conditionally Required
- Optional

Minimum expectation:
- contacts and company read scopes are required
- any extra scopes must be justified by a named feature
- no scope may be added “just in case”

---

## Explicit Permission Warning

OAuth/app scopes do not mirror the installer’s day-to-day object visibility.

The product must not assume that “the installer can only see owned records, therefore the app can too.”

If record-level visibility matters, the app must either:
- enforce object-level permissions at both API and UI layers, or
- deliberately restrict the product experience to records universally visible

---

## Data Retention Design Requirements

The security artifact must define:
- exact retention duration
- storage location
- encryption expectation
- logging policy
- deletion/expiry behavior
- whether prompts/responses containing customer data are stored at all

---

## Handling of Readable Contacts (“3-person Rule”)

Do not assume 3+ contacts exist or are available at all times.

Workspace V1 logic must degrade gracefully if fewer than 3 readable/usable contacts exist.

---

## Evidence-State Handling

- Restricted: never surfaced, never summarized, never transmitted
- Stale: may be displayed only with explicit stale label and visible age
- Low-Confidence: can be surfaced only with visible confidence/provenance indicator
- Degraded Source: clearly state the system-level issue, never disguise as low confidence

---

## Transcript Boundary (V1 Hard Limit)

- no transcript ingestion
- no transcript-derived prompts
- no transcript-derived caching
- no transcript-derived telemetry

---

## Provider Call Data Minimization

- only minimum required fields are sent to providers
- no raw contact/company objects by default
- emails or phone numbers are not sent unless explicitly required and approved
- no developer may use copy-raw-payload patterns

---

## Required Security Artifact (Pre-Implementation)

A one-page security artifact must include:
- exact OAuth/app scopes requested
- permission model mappings
- storage and retention design
- redaction policy
- V1 non-goals and exclusions
- install/authentication flow explanation

---

## HubSpot-Specific Security Realities

- OAuth app scopes are broader than UI visibility
- UI extensions/app cards must only operate within approved scopes
- sensitive data scopes have extra restrictions and should be avoided in V1 unless absolutely necessary
- webhook/event design must map to available scopes

---

## Required Security Measures

- enforce real-time HubSpot object permissions at every API and UI layer
- all provider credentials stored encrypted, never surfaced or logged
- no evidence or account data shown unless the signed-in user passes object-level checks
- no transcript integration of any kind in V1
- all relevant access and denial events are logged with minimal redacted detail

---

## Open Decisions

- define and lock session cache duration and cleanup on logout/revocation/uninstall
- settle least-privilege intersection vs most-permissive union for multi-role users
- confirm handling of ambiguous/unscored evidence
- document a V1 lock preventing scope creep into permission-raising features
