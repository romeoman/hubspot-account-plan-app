/**
 * HubSpot app-lifecycle webhook receiver (Slice 7).
 *
 * Closes the Slice 6 loop: `applyHubSpotLifecycleEvent` already exists as a
 * service — this route gives HubSpot a signed HTTP endpoint to deliver
 * install / uninstall events to.
 *
 * Mount point: `POST /webhooks/hubspot/lifecycle` (OUTSIDE `/api/*`, so it
 * does not flow through auth/tenant/nonce middleware). Authenticity is
 * proven by `verifyHubSpotSignatureV3`, which shares HMAC logic with
 * `hubspotSignatureMiddleware`. The middleware itself cannot be reused as-is
 * because HubSpot webhook payloads are top-level JSON arrays and the
 * middleware requires a `portalId` at the body root.
 *
 * Event-id mapping (per docs/slice-6-preflight-notes.md, verified against
 * HubSpot's Webhooks journal + management API docs):
 *   - 4-1909196  →  app_install
 *   - 4-1916193  →  app_uninstall
 *   - anything else  →  ignored (counted, no effect)
 *
 * The receiver is idempotent by construction:
 *   - `applyHubSpotLifecycleEvent` is a no-op when no tenant matches the
 *     portalId. Returning 200 for unknown portals prevents HubSpot's
 *     webhook retry loop from hammering us forever on stale deliveries.
 *   - Re-delivering an uninstall for an already-deactivated tenant re-runs
 *     the update (sets `isActive=false` again, clears already-empty oauth
 *     rows) without error.
 */
import type { Database } from "@hap/db";
import { Hono } from "hono";
import {
  applyHubSpotLifecycleEvent,
  type HubSpotLifecycleEventType,
} from "../lib/tenant-lifecycle.js";
import {
  canonicalizeRequestUrl,
  verifyHubSpotSignatureV3,
} from "../middleware/hubspot-signature.js";

/**
 * HubSpot's documented event-type IDs for APP_LIFECYCLE_EVENT webhooks.
 * These are STRINGS in the v4 journal payload (e.g., "4-1909196") and
 * MUST be kept in sync with `docs/slice-6-preflight-notes.md`.
 */
export const HUBSPOT_LIFECYCLE_EVENT_IDS = {
  APP_INSTALL: "4-1909196",
  APP_UNINSTALL: "4-1916193",
} as const;

const SIGNATURE_HEADER = "x-hubspot-signature-v3";
const TIMESTAMP_HEADER = "x-hubspot-request-timestamp";

/**
 * Minimal shape for events we care about. HubSpot's real payload has more
 * fields (eventId, subscriptionId, appId, attemptNumber, sourceId, ...);
 * we accept and ignore them.
 */
type RawLifecycleEvent = {
  portalId?: number | string;
  eventTypeId?: string;
  occurredAt?: number;
};

/**
 * Map a HubSpot `eventTypeId` string to the domain lifecycle event our
 * service understands. Returns `null` when the id is not one we act on.
 */
function mapEventTypeId(eventTypeId: unknown): HubSpotLifecycleEventType | null {
  if (eventTypeId === HUBSPOT_LIFECYCLE_EVENT_IDS.APP_INSTALL) return "app_install";
  if (eventTypeId === HUBSPOT_LIFECYCLE_EVENT_IDS.APP_UNINSTALL) return "app_uninstall";
  return null;
}

function coercePortalId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export type LifecycleWebhookDeps = {
  db: Database;
};

/**
 * Construct the Hono sub-app for the lifecycle webhook receiver.
 *
 * Sub-app (not a top-level app) so `apps/api/src/index.ts` can mount it at
 * `/webhooks/hubspot/lifecycle` via `app.route(...)`, giving us one request
 * with a clean `c.req.url` for signature reconstruction.
 */
export function lifecycleWebhookRoutes(deps: LifecycleWebhookDeps): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const signature = c.req.header(SIGNATURE_HEADER);
    const timestampRaw = c.req.header(TIMESTAMP_HEADER);

    if (!signature || !timestampRaw) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const timestamp = Number(timestampRaw);
    const body = await c.req.text();

    const verdict = verifyHubSpotSignatureV3({
      method: "POST",
      // Canonicalize via x-forwarded-proto so TLS-terminating proxies (Vercel
      // edge -> Node function plain-TCP socket) match HubSpot's HTTPS-signed
      // URL. Same fix as the middleware (issue #24).
      url: canonicalizeRequestUrl(c.req.url, c.req.header("x-forwarded-proto") ?? null),
      body,
      timestamp,
      signature,
    });

    if (!verdict.ok) {
      // Redacted failure log — never includes the signature or body.
      console.warn(`hubspot-lifecycle-webhook: ${verdict.reason}`);
      return c.json({ error: "unauthorized" }, 401);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return c.json({ error: "invalid_payload" }, 400);
    }

    const events: RawLifecycleEvent[] = Array.isArray(parsed)
      ? (parsed as RawLifecycleEvent[])
      : [parsed as RawLifecycleEvent];

    let applied = 0;
    let ignored = 0;

    for (const event of events) {
      const eventType = mapEventTypeId(event?.eventTypeId);
      if (eventType === null) {
        ignored += 1;
        continue;
      }

      const portalId = coercePortalId(event?.portalId);
      if (portalId === null) {
        // A signed payload missing a portalId is a protocol violation, but
        // the signature check already passed. Treat as ignored so HubSpot
        // doesn't keep retrying — we logged it above via signature path
        // only if it had failed. Log explicitly here.
        console.warn("hubspot-lifecycle-webhook: event missing portalId");
        ignored += 1;
        continue;
      }

      const occurredAt =
        typeof event.occurredAt === "number" ? new Date(event.occurredAt) : undefined;

      await applyHubSpotLifecycleEvent({
        db: deps.db,
        portalId,
        eventType,
        occurredAt,
      });

      applied += 1;
    }

    return c.json({ received: events.length, applied, ignored }, 200);
  });

  return app;
}
