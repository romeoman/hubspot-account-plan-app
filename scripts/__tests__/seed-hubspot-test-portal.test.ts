/**
 * Tests for `scripts/seed-hubspot-test-portal.ts`.
 *
 * All tests mock the `HubSpotClient` — we never hit the live HubSpot API
 * from CI. The real run is executed by a human operator per
 * `docs/qa/slice-2-walkthrough.md`.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildSeedPlan,
  buildSeedTargets,
  executeSeedPlan,
  parseArgs,
  runSeed,
  SEED_MARKER_OPERATOR,
  SEED_MARKER_PROPERTY,
  SEED_MARKER_VALUE,
  type SeedHubSpotClient,
} from "../seed-hubspot-test-portal";

function stubClient(overrides: Partial<SeedHubSpotClient> = {}): SeedHubSpotClient {
  return {
    searchCompaniesByMarker: vi.fn(async () => []),
    createCompany: vi.fn(async (props) => ({
      id: "new-co",
      properties: props as Record<string, string>,
    })),
    updateCompany: vi.fn(async (id, props) => ({
      id,
      properties: props as Record<string, string>,
    })),
    createContact: vi.fn(async (props) => ({
      id: `ct-${Math.random()}`,
      properties: props,
    })),
    findContactByEmail: vi.fn(async () => null),
    associateContactWithCompany: vi.fn(async () => {
      /* noop */
    }),
    ...overrides,
  };
}

describe("seed-hubspot-test-portal", () => {
  describe("parseArgs", () => {
    it("defaults dryRun to false", () => {
      expect(parseArgs([])).toEqual({ dryRun: false });
    });
    it("parses --dry-run", () => {
      expect(parseArgs(["--dry-run"])).toEqual({ dryRun: true });
    });
    it("parses --portal <id>", () => {
      expect(parseArgs(["--portal", "147062576"])).toEqual({
        dryRun: false,
        portal: "147062576",
      });
    });
  });

  describe("buildSeedTargets", () => {
    it("produces exactly 8 targets, one per QA state", () => {
      const targets = buildSeedTargets();
      expect(targets).toHaveLength(8);
      const states = targets.map((t) => t.state).sort();
      expect(states).toEqual(
        [
          "degraded",
          "eligible-strong",
          "empty",
          "fewer-contacts",
          "ineligible",
          "low-confidence",
          "restricted",
          "stale",
        ].sort(),
      );
    });

    it("every target name starts with the Slice2- prefix (idempotency marker)", () => {
      for (const t of buildSeedTargets()) {
        expect(t.companyName.startsWith("Slice2-")).toBe(true);
        expect(t.companyProperties.name).toBe(t.companyName);
      }
    });

    it("marks ineligible target with hs_is_target_account=false", () => {
      const ineligible = buildSeedTargets().find((t) => t.state === "ineligible");
      expect(ineligible?.companyProperties.hs_is_target_account).toBe(false);
    });

    it("empty state has zero contacts", () => {
      const empty = buildSeedTargets().find((t) => t.state === "empty");
      expect(empty?.contacts).toEqual([]);
    });

    it("eligible-strong has 3 contacts", () => {
      const strong = buildSeedTargets().find((t) => t.state === "eligible-strong");
      expect(strong?.contacts).toHaveLength(3);
    });
  });

  describe("buildSeedPlan", () => {
    it("marks all targets as create when nothing exists", () => {
      const plan = buildSeedPlan(buildSeedTargets(), []);
      expect(plan).toHaveLength(8);
      expect(plan.every((r) => r.action === "create")).toBe(true);
      expect(plan.every((r) => r.existingCompanyId === undefined)).toBe(true);
    });

    it("marks matching targets as update when marker search returns them", () => {
      const plan = buildSeedPlan(buildSeedTargets(), [
        { id: "co-X", properties: { name: "Slice2-Empty-GammaCo" } },
        { id: "co-Y", properties: { name: "Slice2-Ineligible-EtaPLC" } },
      ]);
      const byState = new Map(plan.map((r) => [r.state, r]));
      expect(byState.get("empty")?.action).toBe("update");
      expect(byState.get("empty")?.existingCompanyId).toBe("co-X");
      expect(byState.get("ineligible")?.action).toBe("update");
      expect(byState.get("ineligible")?.existingCompanyId).toBe("co-Y");
      // Others remain create.
      expect(byState.get("eligible-strong")?.action).toBe("create");
    });
  });

  describe("executeSeedPlan", () => {
    it("create path: calls createCompany + createContact + associate per contact", async () => {
      const client = stubClient({
        createCompany: vi.fn(async (props) => ({
          id: "co-CREATED",
          properties: props as Record<string, string>,
        })),
        createContact: vi.fn(async (props) => ({
          id: "ct-1",
          properties: props,
        })),
      });

      const targets = buildSeedTargets().filter((t) => t.state === "fewer-contacts");
      const plan = buildSeedPlan(targets, []);
      const results = await executeSeedPlan(client, plan);

      expect(results).toHaveLength(1);
      expect(results[0].companyId).toBe("co-CREATED");
      expect(results[0].contactIds).toEqual(["ct-1"]);
      expect(client.createCompany).toHaveBeenCalledTimes(1);
      expect(client.createContact).toHaveBeenCalledTimes(1);
      expect(client.associateContactWithCompany).toHaveBeenCalledWith("co-CREATED", "ct-1");
      expect(client.updateCompany).not.toHaveBeenCalled();
    });

    it("update path: calls updateCompany (not createCompany) for existing rows", async () => {
      const client = stubClient({
        updateCompany: vi.fn(async (id, props) => ({
          id,
          properties: props as Record<string, string>,
        })),
      });
      const targets = buildSeedTargets().filter((t) => t.state === "empty");
      const plan = buildSeedPlan(targets, [
        { id: "co-EXISTING", properties: { name: "Slice2-Empty-GammaCo" } },
      ]);
      const results = await executeSeedPlan(client, plan);

      expect(results[0].companyId).toBe("co-EXISTING");
      expect(client.updateCompany).toHaveBeenCalledWith(
        "co-EXISTING",
        expect.objectContaining({
          name: "Slice2-Empty-GammaCo",
        }),
      );
      expect(client.createCompany).not.toHaveBeenCalled();
    });
  });

  describe("runSeed", () => {
    it("dry-run returns 8 plan rows and does NOT construct a client", async () => {
      const log: string[] = [];
      const clientFactory = vi.fn(() => stubClient());
      const { plan } = await runSeed(["--dry-run"], {
        clientFactory,
        env: {}, // no token — should NOT throw in dry-run
        log: (s) => log.push(s),
      });

      expect(plan).toHaveLength(8);
      expect(plan.every((r) => r.action === "create")).toBe(true);
      expect(clientFactory).not.toHaveBeenCalled();
      expect(log.some((l) => l.includes("dry-run"))).toBe(true);
    });

    it("throws a clear error when --portal is missing and not dry-run", async () => {
      await expect(
        runSeed([], {
          env: {}, // no --portal flag, no HUBSPOT_TEST_PORTAL_ID
          clientFactory: () => stubClient(),
          log: () => {
            /* noop */
          },
        }),
      ).rejects.toThrow(/--portal/);
    });

    it("live run calls searchCompaniesByMarker and executes the plan when portal is provided", async () => {
      const client = stubClient({
        searchCompaniesByMarker: vi.fn(async () => [
          { id: "co-E", properties: { name: "Slice2-Empty-GammaCo" } },
        ]),
      });
      const log: string[] = [];
      const { plan, results } = await runSeed(["--portal", "147062576"], {
        env: {
          DATABASE_URL: "postgresql://hap:hap_local_dev@localhost:5433/hap_dev",
        },
        clientFactory: () => client,
        log: (s) => log.push(s),
      });

      expect(client.searchCompaniesByMarker).toHaveBeenCalledWith(
        SEED_MARKER_PROPERTY,
        SEED_MARKER_VALUE,
        SEED_MARKER_OPERATOR,
      );
      expect(plan.find((p) => p.state === "empty")?.action).toBe("update");
      expect(results).toBeDefined();
      expect(results ?? []).toHaveLength(8);
    });
  });
});
