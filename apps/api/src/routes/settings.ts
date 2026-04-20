import type { SettingsUpdate } from "@hap/config";
import { settingsResponseSchema, settingsUpdateSchema } from "@hap/validators";
import { Hono } from "hono";
import { readSettings, SettingsValidationError, updateSettings } from "../lib/settings-service";
import type { TenantVariables } from "../middleware/tenant";
import { createTestConnectionRoute } from "./settings-test-connection";

export const settingsRoutes = new Hono<{ Variables: TenantVariables }>();

// B4: Credential verification endpoint — mounted under the settings router so
// it inherits the `/api/*` auth + tenant middleware chain. See
// `./settings-test-connection.ts` for the full contract.
settingsRoutes.route("/test-connection", createTestConnectionRoute());

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

  try {
    await updateSettings({ db, tenantId }, parsed.data as SettingsUpdate);
  } catch (err) {
    if (err instanceof SettingsValidationError) {
      return c.json({ error: "invalid_settings", detail: err.message }, 400);
    }
    throw err;
  }
  const settings = await readSettings({ db, tenantId });
  const response = settingsResponseSchema.safeParse(settings);
  if (!response.success) {
    return c.json({ error: "invalid_settings_response" }, 500);
  }
  return c.json(response.data, 200);
});
