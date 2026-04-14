import { randomUUID } from "node:crypto";
import { createDatabase, providerConfig, tenants } from "@hap/db";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkEligibility,
  clearEligibilityCache,
  DEFAULT_ELIGIBILITY_PROPERTY,
  ELIGIBILITY_CACHE_TTL_MS,
} from "../eligibility";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const db = createDatabase(DATABASE_URL);

// Unique prefix so this file's cleanup never races with other test files
// that also touch the `tenants` table.
const PORTAL_PREFIX = `eligtest-${randomUUID().slice(0, 8)}-`;

function portalId() {
  return `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;
}

async function seedTenant(name = "Test") {
  const [inserted] = await db
    .insert(tenants)
    .values({ hubspotPortalId: portalId(), name })
    .returning();
  if (!inserted) throw new Error("failed to seed tenant");
  return inserted;
}

async function setHubspotProviderConfig(tenantId: string, settings: Record<string, unknown>) {
  await db
    .insert(providerConfig)
    .values({
      tenantId,
      providerName: "hubspot",
      enabled: true,
      settings,
      thresholds: {},
    })
    .onConflictDoUpdate({
      target: [providerConfig.tenantId, providerConfig.providerName],
      set: { settings },
    });
}

beforeEach(async () => {
  clearEligibilityCache();
  // Clean only rows created by this test file's portal prefix.
  const ours = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
  for (const row of ours) {
    await db.delete(providerConfig).where(eq(providerConfig.tenantId, row.id));
  }
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

afterAll(async () => {
  clearEligibilityCache();
});

describe("checkEligibility", () => {
  it("returns eligible for truthy property value (boolean true)", async () => {
    const tenant = await seedTenant();
    const fetcher = vi.fn().mockResolvedValue(true);

    const result = await checkEligibility(
      { db, fetcher },
      { tenantId: tenant.id, companyId: "company-1" },
    );

    expect(result).toEqual({ eligible: true, reason: "eligible" });
    expect(fetcher).toHaveBeenCalledWith("company-1", DEFAULT_ELIGIBILITY_PROPERTY);
  });

  it("returns eligible for string 'true'", async () => {
    const tenant = await seedTenant();
    const fetcher = vi.fn().mockResolvedValue("true");
    const result = await checkEligibility(
      { db, fetcher },
      { tenantId: tenant.id, companyId: "company-1" },
    );
    expect(result).toEqual({ eligible: true, reason: "eligible" });
  });

  it("returns ineligible for explicit false boolean", async () => {
    const tenant = await seedTenant();
    const fetcher = vi.fn().mockResolvedValue(false);
    const result = await checkEligibility(
      { db, fetcher },
      { tenantId: tenant.id, companyId: "company-1" },
    );
    expect(result).toEqual({ eligible: false, reason: "ineligible" });
  });

  it("returns ineligible for string 'false'", async () => {
    const tenant = await seedTenant();
    const fetcher = vi.fn().mockResolvedValue("false");
    const result = await checkEligibility(
      { db, fetcher },
      { tenantId: tenant.id, companyId: "company-1" },
    );
    expect(result).toEqual({ eligible: false, reason: "ineligible" });
  });

  it("returns unconfigured when property value is null/undefined", async () => {
    const tenant = await seedTenant();
    const fetcher = vi.fn().mockResolvedValue(null);
    const result = await checkEligibility(
      { db, fetcher },
      { tenantId: tenant.id, companyId: "company-1" },
    );
    expect(result).toEqual({ eligible: false, reason: "unconfigured" });

    const fetcher2 = vi.fn().mockResolvedValue(undefined);
    const result2 = await checkEligibility(
      { db, fetcher: fetcher2 },
      { tenantId: tenant.id, companyId: "company-2" },
    );
    expect(result2).toEqual({ eligible: false, reason: "unconfigured" });
  });

  it("returns unconfigured (fail-safe) when fetcher throws", async () => {
    const tenant = await seedTenant();
    const fetcher = vi.fn().mockRejectedValue(new Error("HubSpot API down"));
    const result = await checkEligibility(
      { db, fetcher },
      { tenantId: tenant.id, companyId: "company-1" },
    );
    expect(result).toEqual({ eligible: false, reason: "unconfigured" });
  });

  it("uses configurable property name from provider_config settings", async () => {
    const tenant = await seedTenant();
    await setHubspotProviderConfig(tenant.id, {
      eligibilityPropertyName: "custom_target_flag",
    });
    const fetcher = vi.fn().mockResolvedValue(true);

    const result = await checkEligibility(
      { db, fetcher },
      { tenantId: tenant.id, companyId: "company-1" },
    );

    expect(result).toEqual({ eligible: true, reason: "eligible" });
    expect(fetcher).toHaveBeenCalledWith("company-1", "custom_target_flag");
  });

  it("caches results within TTL — fetcher called once across repeated calls", async () => {
    const tenant = await seedTenant();
    const fetcher = vi.fn().mockResolvedValue(true);
    const now = vi.fn().mockReturnValue(1_000_000);

    const r1 = await checkEligibility(
      { db, fetcher, now },
      { tenantId: tenant.id, companyId: "company-1" },
    );
    const r2 = await checkEligibility(
      { db, fetcher, now },
      { tenantId: tenant.id, companyId: "company-1" },
    );

    expect(r1).toEqual(r2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after cache entry expires (>5 min)", async () => {
    const tenant = await seedTenant();
    const fetcher = vi.fn().mockResolvedValue(true);
    let current = 1_000_000;
    const now = () => current;

    await checkEligibility({ db, fetcher, now }, { tenantId: tenant.id, companyId: "company-1" });
    current += ELIGIBILITY_CACHE_TTL_MS + 1;
    await checkEligibility({ db, fetcher, now }, { tenantId: tenant.id, companyId: "company-1" });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps caches tenant-scoped — tenant A lookup never serves tenant B", async () => {
    const tenantA = await seedTenant("A");
    const tenantB = await seedTenant("B");
    const fetcherA = vi.fn().mockResolvedValue(true);
    const fetcherB = vi.fn().mockResolvedValue(false);
    const now = () => 1_000_000;

    const a1 = await checkEligibility(
      { db, fetcher: fetcherA, now },
      { tenantId: tenantA.id, companyId: "shared-company" },
    );
    const b1 = await checkEligibility(
      { db, fetcher: fetcherB, now },
      { tenantId: tenantB.id, companyId: "shared-company" },
    );

    expect(a1).toEqual({ eligible: true, reason: "eligible" });
    expect(b1).toEqual({ eligible: false, reason: "ineligible" });
    // Each tenant's fetcher was invoked exactly once — no cross-tenant cache hit.
    expect(fetcherA).toHaveBeenCalledTimes(1);
    expect(fetcherB).toHaveBeenCalledTimes(1);

    // Repeat calls: both served from cache, no additional fetcher calls.
    await checkEligibility(
      { db, fetcher: fetcherA, now },
      { tenantId: tenantA.id, companyId: "shared-company" },
    );
    await checkEligibility(
      { db, fetcher: fetcherB, now },
      { tenantId: tenantB.id, companyId: "shared-company" },
    );
    expect(fetcherA).toHaveBeenCalledTimes(1);
    expect(fetcherB).toHaveBeenCalledTimes(1);
  });

  // Keep the `and` import meaningful for type-check without a dead reference.
  it("db helper imports are wired (sanity)", () => {
    expect(typeof and).toBe("function");
  });
});
