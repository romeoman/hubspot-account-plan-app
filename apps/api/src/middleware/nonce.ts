import type { MiddlewareHandler } from "hono";
import { computeBodyHash, recordNonce } from "../lib/replay-nonce";
import type { TenantVariables } from "./tenant";

const TIMESTAMP_HEADER = "x-hubspot-request-timestamp";

type NonceVariables = TenantVariables & {
  rawBody?: string;
};

export function nonceMiddleware(): MiddlewareHandler<{ Variables: NonceVariables }> {
  return async (c, next) => {
    const tenantId = c.get("tenantId");
    if (!tenantId) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const timestampRaw = c.req.header(TIMESTAMP_HEADER);
    if (!timestampRaw) {
      const bypassEligible =
        process.env.NODE_ENV === "test" && process.env.ALLOW_TEST_AUTH === "true";
      if (bypassEligible) {
        await next();
        return;
      }
      return c.json({ error: "unauthorized" }, 401);
    }

    const timestamp = Number(timestampRaw);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const db = c.get("db");
    if (!db) {
      throw new Error("nonce middleware requires a tenant-scoped db handle");
    }

    const rawBody = c.get("rawBody") ?? "";
    const bodyHash = computeBodyHash(rawBody);
    const { duplicate } = await recordNonce(db, { tenantId, timestamp, bodyHash });
    if (duplicate) {
      return c.json({ error: "replay_detected" }, 401);
    }

    await next();
  };
}
