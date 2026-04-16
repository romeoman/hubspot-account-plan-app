# Slice 4 Preflight Notes

Date: 2026-04-16

Purpose: lock the HubSpot settings-extension implementation contract before any
Slice 4 code begins.

## Official docs verified

Primary sources:

- HubSpot: Create a settings page
  - https://developers.hubspot.com/docs/apps/developer-platform/add-features/ui-extensions/extension-points/create-a-settings-page
- HubSpot: App configuration
  - https://developers.hubspot.com/docs/apps/developer-platform/build-apps/app-configuration
- HubSpot: UI extensions overview
  - https://developers.hubspot.com/docs/apps/developer-platform/add-features/ui-extensions/overview
- HubSpot: Manage apps in HubSpot
  - https://developers.hubspot.com/docs/apps/developer-platform/build-apps/manage-apps-in-hubspot

## Verified facts

1. HubSpot supports a React-based settings page on the latest developer
   platform versions (`2025.2` and `2026.03`).
2. A settings feature lives under `src/app/settings/`.
3. The settings feature uses a `*-hsmeta.json` file with `type: "settings"` and
   an `entrypoint` path under `/app/settings/...`.
4. HubSpot’s guide expects a React component registered via `hubspot.extend()`.
5. The docs explicitly say settings pages use the same UI extensions SDK and
   limitations as other UI extensions.
6. For local development, `hs project dev` only picks up changes to the React
   file; changes to `*-hsmeta.json` or `package.json` require stop/upload/restart.
7. If Tabs are used in settings, HubSpot recommends the `default` tab variant,
   because the settings page is already wrapped in an enclosed tab context.
8. App features must live under `src/app/`, and `settings/` is a first-class
   feature directory in the app configuration reference.

## Slice 4 implementation decisions

### 1. Settings feature location

We will add a real HubSpot settings feature under:

- `apps/hubspot-project/src/app/settings/`

Planned shape:

- `apps/hubspot-project/src/app/settings/settings-hsmeta.json`
- `apps/hubspot-project/src/app/settings/Settings.tsx`
- `apps/hubspot-project/src/app/settings/package.json`

### 2. Code ownership model

We will NOT build the main settings React UI directly inside
`apps/hubspot-project`.

Reason:

- the project already keeps real extension UI code in
  `apps/hubspot-extension/`
- the HubSpot project is a packaging/upload shell
- we already solved this packaging boundary for the record-tab card in Slice 3

Decision:

- build the real settings UI in `apps/hubspot-extension/src/settings/`
- bundle/copy the output into `apps/hubspot-project/src/app/settings/dist/`
- keep a thin HubSpot-project shim entrypoint that re-exports the bundled file

This mirrors the proven Slice 3 card bundling strategy and minimizes duplicate
UI logic across the two app surfaces.

### 3. Bundling strategy

We will assume the settings surface needs the same explicit bundling approach as
the card surface unless implementation proves otherwise.

Decision:

- add a dedicated settings entry under `apps/hubspot-extension/src/settings/`
- produce a bundle copied into `apps/hubspot-project/src/app/settings/dist/`
- keep the HubSpot project entrypoint as a thin re-export shim

This is the safest path because:

- `apps/hubspot-project` remains excluded from the pnpm workspace
- the current repo architecture intentionally centralizes real React code in
  `apps/hubspot-extension`
- the record-tab surface already required a bundling bridge for this reason

### 4. Runtime/backend integration

For saving and reading settings, the settings extension will use the same
backend-first architecture as the current product:

- UI calls the backend
- backend owns validation, encryption, and persistence
- secrets remain write-only from the UI’s perspective

We will not add direct client-side secret storage or any bypass around the API.

### 5. Scope lock

Initial Slice 4 settings scope is intentionally narrow:

- signal provider enablement
- provider API key input where required
- default LLM provider + model
- LLM API key input
- optional endpoint URL for `custom`
- thresholds:
  - `freshnessMaxDays`
  - `minConfidence`
- eligibility property override:
  - default remains `hs_is_target_account`

Deferred:

- audit history UI
- team/user/admin management
- secret reveal/download UX
- broad dashboard/admin console features
- any multi-workspace control plane

### 6. Secret handling contract

Locked behavior for Slice 4:

- reads never return plaintext secrets
- reads expose only presence state, e.g. `hasApiKey`
- blank secret fields preserve existing encrypted values
- new plaintext secret values replace existing encrypted values
- if deletion is supported, it must be explicit and separate from blank input
- no reveal-current-secret UI is in scope

### 7. UX constraints

- prefer grouped sections/panels over dense admin layouts
- if tabs are needed, use the HubSpot-recommended `default` variant only
- do not create nested enclosed tabs
- keep the settings UX focused on getting a tenant from unconfigured to working

## Resulting contract for Task 3+

Backend and frontend can proceed with the following assumptions:

- settings feature exists under `apps/hubspot-project/src/app/settings/`
- primary React implementation lives in `apps/hubspot-extension/src/settings/`
- backend remains the single source of truth for all settings writes
- secrets are write-only and replace-only
- Slice 4 is a configuration surface, not an admin suite
