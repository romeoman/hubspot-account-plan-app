import { type Database, tenantHubspotOauth, tenants } from "@hap/db";
import { eq } from "drizzle-orm";
import { invalidateTenantConfig } from "./config-resolver";

type LifecycleDeps = {
  db: Database;
  tenantId: string;
};

export type DeactivateTenantArgs = LifecycleDeps & {
  reason: string;
  deactivatedAt?: Date;
};

export type ReactivateTenantArgs = LifecycleDeps;
export type HubSpotLifecycleEventType = "app_install" | "app_uninstall";

export type ApplyHubSpotLifecycleEventArgs = {
  db: Database;
  portalId: string;
  eventType: HubSpotLifecycleEventType;
  occurredAt?: Date;
};

export async function deactivateTenant(args: DeactivateTenantArgs): Promise<void> {
  const { db, tenantId, reason } = args;
  const deactivatedAt = args.deactivatedAt ?? new Date();

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as Database;

    await txDb
      .update(tenants)
      .set({
        isActive: false,
        deactivatedAt,
        deactivationReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));

    await txDb.delete(tenantHubspotOauth).where(eq(tenantHubspotOauth.tenantId, tenantId));
  });

  invalidateTenantConfig(tenantId);
}

export async function reactivateTenant(args: ReactivateTenantArgs): Promise<void> {
  const { db, tenantId } = args;

  await db
    .update(tenants)
    .set({
      isActive: true,
      deactivatedAt: null,
      deactivationReason: null,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  invalidateTenantConfig(tenantId);
}

export async function applyHubSpotLifecycleEvent(
  args: ApplyHubSpotLifecycleEventArgs,
): Promise<void> {
  const { db, portalId, eventType } = args;
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.hubspotPortalId, portalId),
  });

  if (!tenant) {
    return;
  }

  if (eventType === "app_uninstall") {
    await deactivateTenant({
      db,
      tenantId: tenant.id,
      reason: "hubspot_app_uninstalled",
      deactivatedAt: args.occurredAt,
    });
    return;
  }

  await reactivateTenant({
    db,
    tenantId: tenant.id,
  });
}
