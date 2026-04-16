import type { SettingsUpdate } from "@hap/config";
import { settingsResponseSchema, settingsUpdateSchema } from "@hap/validators";
import { Hono } from "hono";
import { readSettings, updateSettings } from "../lib/settings-service";
import type { TenantVariables } from "../middleware/tenant";

export const settingsRoutes = new Hono<{ Variables: TenantVariables }>();

settingsRoutes.get("/", async (c) => {
  const tenantId = c.get("tenantId");
  const db = c.get("db");
  if (!tenantId || !db) {
    return c.json({ error: "tenant_context_missing" }, 500);
  }

  const settings = await readSettings({ db, tenantId });
  const parsed = settingsResponseSchema.safeParse(settings);
  if (!parsed.success) {
    return c.json({ error: "invalid_settings_response" }, 500);
  }
  return c.json(parsed.data, 200);
});

settingsRoutes.put("/", async (c) => {
  const tenantId = c.get("tenantId");
  const db = c.get("db");
  if (!tenantId || !db) {
    return c.json({ error: "tenant_context_missing" }, 500);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const parsed = settingsUpdateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: "invalid_settings", issues: parsed.error.issues }, 400);
  }

  await updateSettings({ db, tenantId }, parsed.data as SettingsUpdate);
  const settings = await readSettings({ db, tenantId });
  const response = settingsResponseSchema.safeParse(settings);
  if (!response.success) {
    return c.json({ error: "invalid_settings_response" }, 500);
  }
  return c.json(response.data, 200);
});
