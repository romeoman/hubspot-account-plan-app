/**
 * Slice 11 Task 3 — idempotent ensure/diff of HubSpot app lifecycle
 * subscriptions on the webhooks-journal API.
 *
 * Behavior locked by `docs/slice-11-preflight-notes.md`:
 *   - GET  https://api.hubapi.com/webhooks-journal/subscriptions/2026-03
 *     returns `{ results: [{ id, subscriptionType, eventTypeId, ... }] }`.
 *   - POST https://api.hubapi.com/webhooks-journal/subscriptions/2026-03
 *     with body `{ subscriptionType: "APP_LIFECYCLE_EVENT", eventTypeId }`.
 *   - The subscription API is app-scoped. Target URL is NOT transmitted on
 *     the wire (it is configured on the app itself). We still echo the
 *     caller's `targetUrl` back in the returned report for observability.
 *
 * Secrets posture:
 *   - Bearer token is obtained from `getAppAccessToken()` and only placed
 *     on outbound `Authorization` headers.
 *   - Thrown error messages MUST NOT contain the bearer token or any
 *     response body. Only HTTP status + the eventTypeId that failed.
 */

import { HUBSPOT_LIFECYCLE_EVENT_IDS } from "../routes/lifecycle";
import { getAppAccessToken } from "./hubspot-app-auth";

export const HUBSPOT_SUBSCRIPTIONS_URL =
  "https://api.hubapi.com/webhooks-journal/subscriptions/2026-03";

const LIFECYCLE_SUBSCRIPTION_TYPE = "APP_LIFECYCLE_EVENT";

const REQUIRED_EVENT_TYPE_IDS: readonly string[] = [
  HUBSPOT_LIFECYCLE_EVENT_IDS.APP_INSTALL,
  HUBSPOT_LIFECYCLE_EVENT_IDS.APP_UNINSTALL,
];

export type SubscriptionEntry = {
  eventTypeId: string;
  subscriptionId: string;
};

export type EnsureLifecycleSubscriptionsReport = {
  targetUrl: string;
  created: SubscriptionEntry[];
  alreadyPresent: SubscriptionEntry[];
};

export type EnsureLifecycleSubscriptionsOptions = {
  targetUrl: string;
  fetchImpl?: typeof fetch;
  getToken?: () => Promise<string>;
};

export class SubscriptionBootstrapError extends Error {
  readonly stage: "list" | "create";
  readonly status?: number;
  readonly eventTypeId?: string;
  constructor(
    message: string,
    opts: { stage: "list" | "create"; status?: number; eventTypeId?: string },
  ) {
    super(message);
    this.name = "SubscriptionBootstrapError";
    this.stage = opts.stage;
    this.status = opts.status;
    this.eventTypeId = opts.eventTypeId;
  }
}

type ListResultItem = {
  id?: unknown;
  subscriptionType?: unknown;
  eventTypeId?: unknown;
};

type ListResponseBody = {
  results?: unknown;
};

type CreateResponseBody = {
  id?: unknown;
  subscriptionType?: unknown;
  eventTypeId?: unknown;
};

function byEventTypeId(a: SubscriptionEntry, b: SubscriptionEntry): number {
  if (a.eventTypeId < b.eventTypeId) return -1;
  if (a.eventTypeId > b.eventTypeId) return 1;
  return 0;
}

async function listLifecycleSubscriptions(
  fetchImpl: typeof fetch,
  token: string,
): Promise<Map<string, string>> {
  let response: Response;
  try {
    response = await fetchImpl(HUBSPOT_SUBSCRIPTIONS_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
  } catch (_cause) {
    throw new SubscriptionBootstrapError("failed to reach HubSpot subscriptions list endpoint", {
      stage: "list",
    });
  }

  if (!response.ok) {
    throw new SubscriptionBootstrapError(
      `HubSpot subscriptions list returned non-2xx status ${response.status}`,
      { stage: "list", status: response.status },
    );
  }

  let body: ListResponseBody;
  try {
    body = (await response.json()) as ListResponseBody;
  } catch (_cause) {
    throw new SubscriptionBootstrapError("HubSpot subscriptions list returned invalid JSON", {
      stage: "list",
      status: response.status,
    });
  }

  const existing = new Map<string, string>();
  const results = Array.isArray(body.results) ? body.results : [];
  for (const raw of results) {
    const item = raw as ListResultItem;
    if (
      typeof item.id === "string" &&
      typeof item.eventTypeId === "string" &&
      item.subscriptionType === LIFECYCLE_SUBSCRIPTION_TYPE &&
      REQUIRED_EVENT_TYPE_IDS.includes(item.eventTypeId)
    ) {
      // First write wins; duplicates should not happen but we don't overwrite.
      if (!existing.has(item.eventTypeId)) {
        existing.set(item.eventTypeId, item.id);
      }
    }
  }
  return existing;
}

async function createLifecycleSubscription(
  fetchImpl: typeof fetch,
  token: string,
  eventTypeId: string,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(HUBSPOT_SUBSCRIPTIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        subscriptionType: LIFECYCLE_SUBSCRIPTION_TYPE,
        eventTypeId,
      }),
    });
  } catch (_cause) {
    throw new SubscriptionBootstrapError(
      `failed to reach HubSpot subscriptions create endpoint for eventTypeId ${eventTypeId}`,
      { stage: "create", eventTypeId },
    );
  }

  if (!response.ok) {
    throw new SubscriptionBootstrapError(
      `HubSpot subscriptions create returned non-2xx status ${response.status} for eventTypeId ${eventTypeId}`,
      { stage: "create", status: response.status, eventTypeId },
    );
  }

  let body: CreateResponseBody;
  try {
    body = (await response.json()) as CreateResponseBody;
  } catch (_cause) {
    throw new SubscriptionBootstrapError(
      `HubSpot subscriptions create returned invalid JSON for eventTypeId ${eventTypeId}`,
      { stage: "create", status: response.status, eventTypeId },
    );
  }

  if (typeof body.id !== "string" || body.id.length === 0) {
    throw new SubscriptionBootstrapError(
      `HubSpot subscriptions create response missing id for eventTypeId ${eventTypeId}`,
      { stage: "create", status: response.status, eventTypeId },
    );
  }

  return body.id;
}

export async function ensureLifecycleSubscriptions(
  options: EnsureLifecycleSubscriptionsOptions,
): Promise<EnsureLifecycleSubscriptionsReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const getToken = options.getToken ?? (() => getAppAccessToken());

  const token = await getToken();
  const existing = await listLifecycleSubscriptions(fetchImpl, token);

  const alreadyPresent: SubscriptionEntry[] = [];
  const created: SubscriptionEntry[] = [];

  for (const eventTypeId of REQUIRED_EVENT_TYPE_IDS) {
    const existingId = existing.get(eventTypeId);
    if (typeof existingId === "string") {
      alreadyPresent.push({ eventTypeId, subscriptionId: existingId });
      continue;
    }
    const subscriptionId = await createLifecycleSubscription(fetchImpl, token, eventTypeId);
    created.push({ eventTypeId, subscriptionId });
  }

  alreadyPresent.sort(byEventTypeId);
  created.sort(byEventTypeId);

  return {
    targetUrl: options.targetUrl,
    created,
    alreadyPresent,
  };
}
