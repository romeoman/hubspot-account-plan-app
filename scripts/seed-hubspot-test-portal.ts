#!/usr/bin/env node

/**
 * HubSpot test-portal seed script (Slice 3 refactor).
 *
 * Seeds ONE company + 0-3 associated contacts per QA state (eight states
 * total) in the configured HubSpot test portal so the QA walkthrough can
 * exercise every rendered state against real CRM records.
 *
 * Idempotent: every seeded company carries a known marker property. On
 * rerun the script searches for the marker and UPDATEs existing rows.
 *
 * Usage:
 *   pnpm tsx scripts/seed-hubspot-test-portal.ts --dry-run
 *   pnpm tsx scripts/seed-hubspot-test-portal.ts --portal 147062576
 *
 * Auth (Slice 3): reads the per-tenant OAuth token from `tenant_hubspot_oauth`
 * in the local Postgres. The portal must have installed the app first (the
 * OAuth callback creates the tenant + stores encrypted tokens). The old
 * single-portal env-token path was removed in Slice 3.
 *
 * NEVER run without `--dry-run` in CI.
 */

import { HubSpotClient } from "../apps/api/src/lib/hubspot-client";
import { createDatabase, eq, tenants } from "../packages/db/src";

/**
 * Marker scheme used to find previously-seeded rows for idempotency.
 *
 * Originally used a custom `hap_seed_marker` property — that required the
 * portal admin to pre-create the property definition (or grant
 * `crm.schemas.companies.write`). To keep the seed self-contained and
 * minimize scope on the dev-bridge token, we now search by the standard
 * `name` property with `CONTAINS_TOKEN` on the common `Slice2-*` prefix —
 * every seeded company's name already starts with `Slice2-`.
 */
export const SEED_MARKER_PROPERTY = "name";
export const SEED_MARKER_VALUE = "Slice2*";
export const SEED_MARKER_OPERATOR = "CONTAINS_TOKEN" as const;

/**
 * Minimal interface the seed driver needs from the HubSpot client. Accepts
 * the real `HubSpotClient` at runtime and a mocked implementation in tests.
 */
export interface SeedHubSpotClient {
  searchCompaniesByMarker(
    markerProperty: string,
    markerValue: string,
    operator?: "EQ" | "CONTAINS_TOKEN",
  ): Promise<Array<{ id: string; properties: Record<string, string> }>>;
  createCompany(
    properties: Record<string, string | boolean | number>,
  ): Promise<{ id: string; properties: Record<string, string> }>;
  updateCompany(
    companyId: string,
    properties: Record<string, string | boolean | number>,
  ): Promise<{ id: string; properties: Record<string, string> }>;
  createContact(
    properties: Record<string, string>,
  ): Promise<{ id: string; properties: Record<string, string> }>;
  findContactByEmail(
    email: string,
  ): Promise<{ id: string; properties: Record<string, string> } | null>;
  associateContactWithCompany(companyId: string, contactId: string): Promise<void>;
}

/** QA state tag — aligned with `fixtureEligibleStrong` et al. in `@hap/config`. */
export type QaStateTag =
  | "eligible-strong"
  | "fewer-contacts"
  | "empty"
  | "stale"
  | "degraded"
  | "low-confidence"
  | "ineligible"
  | "restricted";

/** One seed target = one company + 0-3 contacts. */
export interface SeedTarget {
  state: QaStateTag;
  companyName: string;
  companyProperties: Record<string, string | boolean | number>;
  contacts: Array<Record<string, string>>;
}

export interface SeedPlanRow {
  action: "create" | "update";
  state: QaStateTag;
  companyName: string;
  properties: Record<string, string | boolean | number>;
  contacts: Array<Record<string, string>>;
  /** Present only when action is `update` (existing company id from marker search). */
  existingCompanyId?: string;
}

/**
 * The eight seed targets. Property shapes intentionally map to the QA
 * fixtures in `packages/config/src/factories.ts` so the live-rendered
 * state-semantics match the fixture semantics 1:1.
 *
 * Idempotency: every company's `name` starts with `Slice2-`. On rerun the
 * seed searches `name CONTAINS_TOKEN "Slice2*"` to find previously-seeded
 * rows and UPDATEs them rather than duplicating. We intentionally DO NOT
 * stamp a custom property (like `hap_seed_marker` or `hap_state_tag`) —
 * those would require the portal admin to pre-create property definitions
 * or grant `crm.schemas.companies.write`, which we're keeping out of the
 * dev-bridge token scope.
 */
export function buildSeedTargets(): SeedTarget[] {
  const mark = (extra: Record<string, string | boolean | number>) => ({
    [SEED_MARKER_PROPERTY]: SEED_MARKER_VALUE,
    ...extra,
  });

  return [
    {
      state: "eligible-strong",
      companyName: "Slice2-EligibleStrong-AcmeCorp",
      companyProperties: mark({
        name: "Slice2-EligibleStrong-AcmeCorp",
        domain: "slice2-acme.example.com",
        hs_is_target_account: true,
      }),
      contacts: [
        {
          firstname: "Alex",
          lastname: "Champion",
          email: "alex.champion@slice2-acme.example.com",
          jobtitle: "VP Engineering",
        },
        {
          firstname: "Jordan",
          lastname: "Decider",
          email: "jordan.decider@slice2-acme.example.com",
          jobtitle: "CTO",
        },
        {
          firstname: "Sam",
          lastname: "Influencer",
          email: "sam.influencer@slice2-acme.example.com",
          jobtitle: "Head of Platform",
        },
      ],
    },
    {
      state: "fewer-contacts",
      companyName: "Slice2-FewerContacts-BetaInc",
      companyProperties: mark({
        name: "Slice2-FewerContacts-BetaInc",
        domain: "slice2-beta.example.com",
        hs_is_target_account: true,
      }),
      contacts: [
        {
          firstname: "Riley",
          lastname: "Only",
          email: "riley.only@slice2-beta.example.com",
          jobtitle: "CEO",
        },
      ],
    },
    {
      state: "empty",
      companyName: "Slice2-Empty-GammaCo",
      companyProperties: mark({
        name: "Slice2-Empty-GammaCo",
        domain: "slice2-gamma.example.com",
        hs_is_target_account: true,
      }),
      contacts: [],
    },
    {
      state: "stale",
      companyName: "Slice2-Stale-DeltaLLC",
      companyProperties: mark({
        name: "Slice2-Stale-DeltaLLC",
        domain: "slice2-delta.example.com",
        hs_is_target_account: true,
      }),
      contacts: [
        {
          firstname: "Taylor",
          lastname: "Past",
          email: "taylor.past@slice2-delta.example.com",
          jobtitle: "Director",
        },
      ],
    },
    {
      state: "degraded",
      companyName: "Slice2-Degraded-EpsilonGmbH",
      companyProperties: mark({
        name: "Slice2-Degraded-EpsilonGmbH",
        domain: "slice2-epsilon.example.com",
        hs_is_target_account: true,
      }),
      contacts: [
        {
          firstname: "Morgan",
          lastname: "Partial",
          email: "morgan.partial@slice2-epsilon.example.com",
          jobtitle: "Manager",
        },
      ],
    },
    {
      state: "low-confidence",
      companyName: "Slice2-LowConfidence-ZetaSA",
      companyProperties: mark({
        name: "Slice2-LowConfidence-ZetaSA",
        domain: "slice2-zeta.example.com",
        hs_is_target_account: true,
      }),
      contacts: [
        {
          firstname: "Jamie",
          lastname: "Maybe",
          email: "jamie.maybe@slice2-zeta.example.com",
          jobtitle: "VP Unknown",
        },
      ],
    },
    {
      state: "ineligible",
      companyName: "Slice2-Ineligible-EtaPLC",
      companyProperties: mark({
        name: "Slice2-Ineligible-EtaPLC",
        domain: "slice2-eta.example.com",
        // Explicitly NOT a target account — the eligibility evaluator must
        // suppress this card entirely.
        hs_is_target_account: false,
      }),
      contacts: [
        {
          firstname: "Dana",
          lastname: "Disqualified",
          email: "dana.disqualified@slice2-eta.example.com",
          jobtitle: "Operations Lead",
        },
      ],
    },
    {
      state: "restricted",
      companyName: "Slice2-Restricted-ThetaInc",
      companyProperties: mark({
        name: "Slice2-Restricted-ThetaInc",
        domain: "slice2-theta.example.com",
        hs_is_target_account: true,
        // Marker consumed by the trust evaluator to treat all associated
        // evidence as restricted. The UI MUST render empty-with-zero-leakage.
      }),
      contacts: [
        {
          firstname: "Sky",
          lastname: "Sealed",
          email: "sky.sealed@slice2-theta.example.com",
          jobtitle: "Chief Privacy Officer",
        },
      ],
    },
  ];
}

/**
 * Pure plan builder. Given the set of already-seeded companies (from the
 * marker search) produces one `SeedPlanRow` per target, marking each as
 * `create` or `update` based on whether a matching row exists.
 *
 * Existing-row matching is by company name: the seed names are unique
 * within the marker set, so name is a safe secondary key under the
 * marker.
 */
export function buildSeedPlan(
  targets: SeedTarget[],
  existing: Array<{ id: string; properties: Record<string, string> }>,
): SeedPlanRow[] {
  const byName = new Map<string, string>();
  for (const row of existing) {
    const name = row.properties?.name;
    if (typeof name === "string" && name.length > 0) {
      byName.set(name, row.id);
    }
  }

  return targets.map((t) => {
    const existingId = byName.get(t.companyName);
    return {
      action: existingId ? "update" : "create",
      state: t.state,
      companyName: t.companyName,
      properties: t.companyProperties,
      contacts: t.contacts,
      existingCompanyId: existingId,
    };
  });
}

/**
 * Execute the plan against a live HubSpot client. Returns the record ids
 * captured per state so the caller can print a walkthrough-friendly table.
 */
export async function executeSeedPlan(
  client: SeedHubSpotClient,
  plan: SeedPlanRow[],
): Promise<
  Array<{
    state: QaStateTag;
    companyName: string;
    companyId: string;
    contactIds: string[];
  }>
> {
  const results: Array<{
    state: QaStateTag;
    companyName: string;
    companyId: string;
    contactIds: string[];
  }> = [];

  for (const row of plan) {
    let companyId: string;
    try {
      if (row.action === "update" && row.existingCompanyId) {
        const updated = await client.updateCompany(row.existingCompanyId, row.properties);
        companyId = updated.id;
      } else {
        const created = await client.createCompany(row.properties);
        companyId = created.id;
      }
    } catch (err) {
      throw new Error(
        `seed failed at ${row.action} ${row.state} (${row.companyName}): ${(err as Error).message}`,
      );
    }

    const contactIds: string[] = [];
    for (const contactProps of row.contacts) {
      try {
        // Idempotency: HubSpot rejects duplicate emails with 409. Search
        // first; create only when absent. Association is applied either way.
        const existing = await client.findContactByEmail(String(contactProps.email));
        const contact = existing ?? (await client.createContact(contactProps));
        await client.associateContactWithCompany(companyId, contact.id);
        contactIds.push(contact.id);
      } catch (err) {
        throw new Error(
          `seed failed at contact ${String(contactProps.email)} for ${row.companyName}: ${(err as Error).message}`,
        );
      }
    }

    results.push({
      state: row.state,
      companyName: row.companyName,
      companyId,
      contactIds,
    });
  }

  return results;
}

export interface SeedCliOptions {
  dryRun: boolean;
  portal?: string;
}

export function parseArgs(argv: readonly string[]): SeedCliOptions {
  const opts: SeedCliOptions = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--portal") {
      opts.portal = argv[i + 1];
      i++;
    }
  }
  return opts;
}

/**
 * Entry point. Exported for the test harness so we can stub the client.
 * Throws when the required tenant OAuth install cannot be resolved and
 * `--dry-run` is NOT set; dry-run mode does not require a live token.
 */
export async function runSeed(
  argv: readonly string[],
  deps: {
    clientFactory?: () => SeedHubSpotClient;
    env?: NodeJS.ProcessEnv;
    log?: (line: string) => void;
  } = {},
): Promise<{
  plan: SeedPlanRow[];
  results?: ReturnType<typeof executeSeedPlan> extends Promise<infer R> ? R : never;
}> {
  const opts = parseArgs(argv);
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((s: string) => console.log(s));

  const targets = buildSeedTargets();

  if (opts.dryRun) {
    // Dry-run: no token required, no client constructed, no HubSpot calls.
    const plan = buildSeedPlan(targets, []);
    log("[seed] dry-run: planned operations");
    for (const row of plan) {
      log(
        `[seed] ${row.action.padEnd(6)} ${row.state.padEnd(16)} ${row.companyName} contacts=${row.contacts.length}`,
      );
    }
    return { plan };
  }

  // Slice 3: resolve per-tenant OAuth token from DB instead of env var.
  // Requires --portal <id> so we know which tenant's token to use.
  const portalId = opts.portal ?? env.HUBSPOT_TEST_PORTAL_ID;
  if (!portalId) {
    throw new Error(
      "seed-hubspot-test-portal: --portal <id> is required for live seeding (or set HUBSPOT_TEST_PORTAL_ID in .env.test). Rerun with --dry-run to preview without credentials.",
    );
  }

  let client: SeedHubSpotClient;
  if (deps.clientFactory) {
    client = deps.clientFactory();
  } else {
    const databaseUrl = env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("seed-hubspot-test-portal: DATABASE_URL is required for live seeding.");
    }
    const db = createDatabase(databaseUrl);
    const rows = await db.select().from(tenants).where(eq(tenants.hubspotPortalId, portalId));
    const tenant = rows[0];
    if (!tenant) {
      throw new Error(
        `seed-hubspot-test-portal: no tenant found for portal ${portalId}. Install the app on this portal first (GET /oauth/install).`,
      );
    }
    client = new HubSpotClient({
      tenantId: tenant.id,
      db,
    }) as SeedHubSpotClient;
  }
  const existing = await client.searchCompaniesByMarker(
    SEED_MARKER_PROPERTY,
    SEED_MARKER_VALUE,
    SEED_MARKER_OPERATOR,
  );
  const plan = buildSeedPlan(targets, existing);

  log(
    `[seed] live run: ${plan.filter((p) => p.action === "create").length} create, ${plan.filter((p) => p.action === "update").length} update`,
  );

  const results = await executeSeedPlan(client, plan);
  log("");
  log("[seed] results (paste into docs/qa/slice-2-walkthrough.md):");
  log("| QA State | Company Name | Company ID | Contact IDs |");
  log("|---|---|---|---|");
  for (const r of results) {
    log(
      `| ${r.state} | ${r.companyName} | ${r.companyId} | ${r.contactIds.join(", ") || "(none)"} |`,
    );
  }

  return { plan, results };
}

/**
 * Only auto-run when this file is executed directly (not imported by tests).
 * Node's ESM `import.meta.url` equals the process's main script URL in that
 * case.
 */
// eslint-disable-next-line @typescript-eslint/no-floating-promises
const isDirectInvocation = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return import.meta.url === new URL(`file://${argv1}`).href;
  } catch {
    return false;
  }
})();

if (isDirectInvocation) {
  runSeed(process.argv.slice(2)).catch((err: unknown) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}
