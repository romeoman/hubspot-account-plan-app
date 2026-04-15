# Slice 2 — HubSpot Test Portal Walkthrough

Manual QA checklist for the Slice 2 live-integration vertical against the
HubSpot test portal (`147062576`). Run this after the test-portal seed has
been applied; it exercises all eight QA states against real CRM records so we
can verify that state rendering, evidence drill-in, freshness, trust, and
restricted-evidence suppression all behave correctly end-to-end.

## Prerequisites

1. `HUBSPOT_PRIVATE_APP_TOKEN` is set in the **main repo root** `.env`
   (worktrees inherit it via `vitest.setup.ts`'s dotenv resolver).
   - Required scopes: `crm.objects.companies.read`,
     `crm.objects.companies.write`, `crm.objects.contacts.read`,
     `crm.objects.contacts.write`, `crm.schemas.companies.write` (the seed
     script writes the `hap_seed_marker` custom property for idempotency).
2. The HubSpot CLI is authenticated against the test portal:
   ```bash
   hs accounts list
   ```
   Expect to see `147062576` in the output. If not, run `hs auth`.
3. `pnpm install` has been run in the repo root (for `tsx`).

## Run the seed

### 1. Dry run first

The dry run requires no token and makes zero HubSpot calls. It prints the
planned create/update operations for all eight states so you can sanity-check
names, properties, and contact counts before touching the portal.

```bash
pnpm tsx scripts/seed-hubspot-test-portal.ts --dry-run
```

Expected output: eight `[seed] create ...` lines, one per state tag, contact
counts 3/1/0/1/1/1/1/1.

### 2. Real run

When you're ready to seed the test portal (idempotent — safe to rerun):

```bash
pnpm tsx scripts/seed-hubspot-test-portal.ts
```

The script:

1. Searches for existing rows stamped with
   `hap_seed_marker = "slice2-walkthrough-v1"` via
   `POST /crm/v3/objects/companies/search`.
2. For each of the 8 targets, either UPDATEs the existing company (matched by
   name within the marker set) or CREATEs a new one.
3. CREATEs each associated contact and associates it via
   `PUT /crm/v3/objects/companies/{id}/associations/default/contacts/{id}`.
4. Prints a pipe-delimited results table that can be pasted directly into the
   per-state checklist below.

### 3. Re-run is idempotent

Rerunning with the same marker-value lookup flips every row from `create` to
`update`. Contacts are always created — **on rerun, HubSpot will deduplicate
contacts by email** (the emails are stable per target) so the associate step
becomes a no-op update rather than creating duplicates. If you want a clean
reset, archive the eight seed companies in HubSpot first; the next run will
recreate them.

## Per-state checklist

Fill in the `Company ID` / `Contact IDs` columns after the first real run by
pasting the results-table rows printed by the seed script. The
`Expected Card Render` column is the acceptance criterion you verify by
opening the company record in HubSpot and looking at the Account Signal
`crm.record.tab`.

| QA State        | Company Name                   | Company ID | Contact IDs | Expected Card Render                                                                                                                               |
| --------------- | ------------------------------ | ---------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| eligible-strong | Slice2-EligibleStrong-AcmeCorp | TBD        | TBD         | reason-to-contact string + 3 people cards; evidence drill-in shows source, freshness, trust breakdown for each evidence row                        |
| fewer-contacts  | Slice2-FewerContacts-BetaInc   | TBD        | TBD         | reason-to-contact + 1 person card + an explicit "fewer usable contacts" note (never fabricated filler people)                                      |
| empty           | Slice2-Empty-GammaCo           | TBD        | (none)      | "no credible reason to contact this account now" empty state; zero people, zero evidence                                                           |
| stale           | Slice2-Stale-DeltaLLC          | TBD        | TBD         | warning alert "signals are stale (N days ago)"; reason-to-contact still rendered but annotated                                                     |
| degraded        | Slice2-Degraded-EpsilonGmbH    | TBD        | TBD         | warning alert "source degraded" / "partial data"; reason rendered with degraded-source badge                                                       |
| low-confidence  | Slice2-LowConfidence-ZetaSA    | TBD        | TBD         | caution alert + confidence score surfaced in trust breakdown                                                                                       |
| ineligible      | Slice2-Ineligible-EtaPLC       | TBD        | TBD         | "not a target account" suppression message; reason-to-contact NOT rendered; zero people                                                            |
| restricted      | Slice2-Restricted-ThetaInc     | TBD        | TBD         | empty-with-zero-leakage render: NO evidence content, NO reason-to-contact text, NO people listed — the security-gate rule must suppress everything |

## Manual walkthrough procedure

For each row above:

1. Open the HubSpot test portal (`147062576`) in a browser.
2. Navigate to Contacts → Companies.
3. Search for the company name (e.g. `Slice2-EligibleStrong-AcmeCorp`).
4. Click into the company record.
5. Confirm the Account Signal card renders in the record tab strip.
6. Verify the expected state per the table above.
7. Take a screenshot (attach to the linked Linear/Taskmaster task).
8. Capture the `X-Request-Id` response header (Step 7's observability) from
   the browser DevTools Network tab for the `/snapshot` call — paste into
   the per-state row for trace-to-log linkage.

## Success criteria

- All 8 states render per the `Expected Card Render` column.
- The **restricted** state leaks zero evidence content in the DOM — inspect
  the rendered HTML and confirm no `ev-*` content strings, no reason-to-talk
  strings, no contact-level evidence refs appear anywhere in the subtree.
- All 8 `X-Request-Id` values appear in the backend observability store.
- Rerunning the seed produces no duplicate companies in the test portal.

## Known limitations

- Seed contacts are keyed by email, so rerunning with a new seed version
  (different `SEED_MARKER_VALUE`) and the same contact emails will produce a
  single contact associated to both generations of companies. This is
  acceptable for the V1 walkthrough; a future iteration can scope contact
  emails with the marker value.
- The script does not write signal or evidence records directly — that is
  the job of the adapters wired in Steps 9–13. The seed only ensures the CRM
  source-of-truth rows exist so the adapters have something to enrich.
