/**
 * Slice 11 Task 3 — idempotent ensure/diff of HubSpot app lifecycle subscriptions.
 *
 * Covers `../hubspot-subscription-bootstrap.ts`:
 *   - all-missing -> creates both install + uninstall
 *   - partial-present -> only creates the missing one
 *   - both-present -> no creates
 *   - list error (non-2xx) -> typed error, no creates attempted
 *   - create error (non-2xx) -> typed error identifying which eventTypeId failed
 *   - secrets posture -> errors must not contain the bearer token
 *
 * Zero network access: every test injects fetchImpl + getToken.
 */

import { describe, expect, it } from "vitest";
import { HUBSPOT_LIFECYCLE_EVENT_IDS } from "../../routes/lifecycle.js";
import {
  ensureLifecycleSubscriptions,
  HUBSPOT_SUBSCRIPTIONS_URL,
  SubscriptionBootstrapError,
} from "../hubspot-subscription-bootstrap.js";

const INSTALL = HUBSPOT_LIFECYCLE_EVENT_IDS.APP_INSTALL;
const UNINSTALL = HUBSPOT_LIFECYCLE_EVENT_IDS.APP_UNINSTALL;

const TOKEN = "bearer-token-shhh-secret";
const TARGET_URL = "https://example.com/api/lifecycle";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchCall = { url: string; init?: RequestInit };

function makeFetch(responses: Response[]): {
  fetchImpl: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  let i = 0;
  const fetchImpl = (async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: String(input), init });
    const response = responses[i++];
    if (!response) throw new Error(`unexpected fetch call index ${i - 1}`);
    return response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function getToken(): Promise<string> {
  return Promise.resolve(TOKEN);
}

describe("ensureLifecycleSubscriptions — URL contract", () => {
  it("exports the locked webhooks-journal subscriptions URL", () => {
    expect(HUBSPOT_SUBSCRIPTIONS_URL).toBe(
      "https://api.hubapi.com/webhooks-journal/subscriptions/2026-03",
    );
  });
});

describe("ensureLifecycleSubscriptions — all missing", () => {
  it("creates both install and uninstall subscriptions", async () => {
    const { fetchImpl, calls } = makeFetch([
      jsonResponse({ results: [] }),
      jsonResponse({
        id: "sub-install-1",
        subscriptionType: "APP_LIFECYCLE_EVENT",
        eventTypeId: INSTALL,
      }),
      jsonResponse({
        id: "sub-uninstall-2",
        subscriptionType: "APP_LIFECYCLE_EVENT",
        eventTypeId: UNINSTALL,
      }),
    ]);

    const report = await ensureLifecycleSubscriptions({
      targetUrl: TARGET_URL,
      fetchImpl,
      getToken,
    });

    expect(report.targetUrl).toBe(TARGET_URL);
    expect(report.alreadyPresent).toEqual([]);
    expect(report.created).toEqual([
      { eventTypeId: INSTALL, subscriptionId: "sub-install-1" },
      { eventTypeId: UNINSTALL, subscriptionId: "sub-uninstall-2" },
    ]);

    expect(calls).toHaveLength(3);
    const listCall = calls[0]!;
    const createInstall = calls[1]!;
    const createUninstall = calls[2]!;
    expect(listCall.url).toBe(HUBSPOT_SUBSCRIPTIONS_URL);
    expect(listCall.init?.method ?? "GET").toBe("GET");
    expect((listCall.init?.headers as Record<string, string> | undefined)?.Authorization).toBe(
      `Bearer ${TOKEN}`,
    );

    // First create call is install
    expect(createInstall.url).toBe(HUBSPOT_SUBSCRIPTIONS_URL);
    expect(createInstall.init?.method).toBe("POST");
    const headers1 = createInstall.init?.headers as Record<string, string>;
    expect(headers1.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers1["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(createInstall.init?.body))).toEqual({
      subscriptionType: "APP_LIFECYCLE_EVENT",
      eventTypeId: INSTALL,
    });

    // Second create is uninstall
    expect(JSON.parse(String(createUninstall.init?.body))).toEqual({
      subscriptionType: "APP_LIFECYCLE_EVENT",
      eventTypeId: UNINSTALL,
    });
  });
});

describe("ensureLifecycleSubscriptions — partial present", () => {
  it("creates only the missing subscription and reports the existing one", async () => {
    const { fetchImpl, calls } = makeFetch([
      jsonResponse({
        results: [
          {
            id: "existing-install",
            subscriptionType: "APP_LIFECYCLE_EVENT",
            eventTypeId: INSTALL,
          },
        ],
      }),
      jsonResponse({
        id: "new-uninstall",
        subscriptionType: "APP_LIFECYCLE_EVENT",
        eventTypeId: UNINSTALL,
      }),
    ]);

    const report = await ensureLifecycleSubscriptions({
      targetUrl: TARGET_URL,
      fetchImpl,
      getToken,
    });

    expect(report.alreadyPresent).toEqual([
      { eventTypeId: INSTALL, subscriptionId: "existing-install" },
    ]);
    expect(report.created).toEqual([{ eventTypeId: UNINSTALL, subscriptionId: "new-uninstall" }]);
    expect(calls).toHaveLength(2);
  });

  it("ignores unrelated subscription entries and only creates missing lifecycle events", async () => {
    const { fetchImpl, calls } = makeFetch([
      jsonResponse({
        results: [
          {
            id: "noise-1",
            subscriptionType: "OBJECT_CREATION",
            eventTypeId: "other-thing",
          },
          {
            id: "existing-uninstall",
            subscriptionType: "APP_LIFECYCLE_EVENT",
            eventTypeId: UNINSTALL,
          },
        ],
      }),
      jsonResponse({
        id: "new-install",
        subscriptionType: "APP_LIFECYCLE_EVENT",
        eventTypeId: INSTALL,
      }),
    ]);

    const report = await ensureLifecycleSubscriptions({
      targetUrl: TARGET_URL,
      fetchImpl,
      getToken,
    });

    expect(report.created).toEqual([{ eventTypeId: INSTALL, subscriptionId: "new-install" }]);
    expect(report.alreadyPresent).toEqual([
      { eventTypeId: UNINSTALL, subscriptionId: "existing-uninstall" },
    ]);
    expect(calls).toHaveLength(2);
  });
});

describe("ensureLifecycleSubscriptions — both present", () => {
  it("makes no create calls and returns both in alreadyPresent sorted by eventTypeId", async () => {
    const { fetchImpl, calls } = makeFetch([
      jsonResponse({
        results: [
          {
            id: "u-id",
            subscriptionType: "APP_LIFECYCLE_EVENT",
            eventTypeId: UNINSTALL,
          },
          {
            id: "i-id",
            subscriptionType: "APP_LIFECYCLE_EVENT",
            eventTypeId: INSTALL,
          },
        ],
      }),
    ]);

    const report = await ensureLifecycleSubscriptions({
      targetUrl: TARGET_URL,
      fetchImpl,
      getToken,
    });

    expect(report.created).toEqual([]);
    expect(report.alreadyPresent).toEqual([
      { eventTypeId: INSTALL, subscriptionId: "i-id" },
      { eventTypeId: UNINSTALL, subscriptionId: "u-id" },
    ]);
    expect(calls).toHaveLength(1);
  });

  it("normalizes numeric subscription ids from the list response to strings", async () => {
    // Per docs/slice-11-preflight-notes.md §2, HubSpot's webhooks-journal
    // subscriptions API returns `id` as a number (e.g. `"id": 60001005`).
    // The list filter must accept numeric ids and coerce them to strings,
    // otherwise existing subscriptions are silently skipped and we would
    // duplicate-create them.
    const { fetchImpl, calls } = makeFetch([
      jsonResponse({
        results: [
          {
            id: 60001005,
            subscriptionType: "APP_LIFECYCLE_EVENT",
            eventTypeId: INSTALL,
          },
          {
            id: 60001006,
            subscriptionType: "APP_LIFECYCLE_EVENT",
            eventTypeId: UNINSTALL,
          },
        ],
      }),
    ]);

    const report = await ensureLifecycleSubscriptions({
      targetUrl: TARGET_URL,
      fetchImpl,
      getToken,
    });

    expect(report.created).toEqual([]);
    expect(report.alreadyPresent).toEqual([
      { eventTypeId: INSTALL, subscriptionId: "60001005" },
      { eventTypeId: UNINSTALL, subscriptionId: "60001006" },
    ]);
    expect(calls).toHaveLength(1);
  });

  it("recognizes live 2026-03 list responses that return objectTypeId for lifecycle events", async () => {
    const { fetchImpl, calls } = makeFetch([
      jsonResponse({
        results: [
          {
            id: 60227053,
            subscriptionType: "APP_LIFECYCLE_EVENT",
            objectTypeId: INSTALL,
          },
          {
            id: 60227054,
            subscriptionType: "APP_LIFECYCLE_EVENT",
            objectTypeId: UNINSTALL,
          },
        ],
      }),
    ]);

    const report = await ensureLifecycleSubscriptions({
      targetUrl: TARGET_URL,
      fetchImpl,
      getToken,
    });

    expect(report.created).toEqual([]);
    expect(report.alreadyPresent).toEqual([
      { eventTypeId: INSTALL, subscriptionId: "60227053" },
      { eventTypeId: UNINSTALL, subscriptionId: "60227054" },
    ]);
    expect(calls).toHaveLength(1);
  });

  it("normalizes numeric subscription ids from the create response to strings", async () => {
    // Same numeric-id shape must be honored on create responses.
    const { fetchImpl, calls } = makeFetch([
      jsonResponse({ results: [] }),
      jsonResponse({
        id: 60001111,
        subscriptionType: "APP_LIFECYCLE_EVENT",
        eventTypeId: INSTALL,
      }),
      jsonResponse({
        id: 60002222,
        subscriptionType: "APP_LIFECYCLE_EVENT",
        eventTypeId: UNINSTALL,
      }),
    ]);

    const report = await ensureLifecycleSubscriptions({
      targetUrl: TARGET_URL,
      fetchImpl,
      getToken,
    });

    expect(report.created).toEqual([
      { eventTypeId: INSTALL, subscriptionId: "60001111" },
      { eventTypeId: UNINSTALL, subscriptionId: "60002222" },
    ]);
    expect(report.alreadyPresent).toEqual([]);
    expect(calls).toHaveLength(3);
  });
});

describe("ensureLifecycleSubscriptions — error paths", () => {
  it("throws a typed error when the list call returns non-2xx and does not attempt creates", async () => {
    const { fetchImpl, calls } = makeFetch([
      new Response("unauthorized", {
        status: 401,
        headers: { "content-type": "text/plain" },
      }),
    ]);

    const err = await ensureLifecycleSubscriptions({
      targetUrl: TARGET_URL,
      fetchImpl,
      getToken,
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(SubscriptionBootstrapError);
    const typed = err as SubscriptionBootstrapError;
    expect(typed.stage).toBe("list");
    expect(typed.status).toBe(401);
    expect(typed.message).not.toContain(TOKEN);
    expect(calls).toHaveLength(1);
  });

  it("throws a typed error with the failing eventTypeId when a create call returns non-2xx", async () => {
    const { fetchImpl, calls } = makeFetch([
      jsonResponse({ results: [] }),
      new Response("bad request", {
        status: 400,
        headers: { "content-type": "text/plain" },
      }),
    ]);

    const err = await ensureLifecycleSubscriptions({
      targetUrl: TARGET_URL,
      fetchImpl,
      getToken,
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(SubscriptionBootstrapError);
    const typed = err as SubscriptionBootstrapError;
    expect(typed.stage).toBe("create");
    expect(typed.status).toBe(400);
    expect(typed.eventTypeId).toBe(INSTALL);
    expect(typed.message).not.toContain(TOKEN);
    // list + first (failing) create only — second create NOT attempted
    expect(calls).toHaveLength(2);
  });

  it("error messages never contain the bearer token even on unexpected JSON shapes", async () => {
    const { fetchImpl } = makeFetch([
      new Response(JSON.stringify({ error: "nope", token: TOKEN }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    ]);

    const err = await ensureLifecycleSubscriptions({
      targetUrl: TARGET_URL,
      fetchImpl,
      getToken,
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(SubscriptionBootstrapError);
    expect((err as Error).message).not.toContain(TOKEN);
  });
});
