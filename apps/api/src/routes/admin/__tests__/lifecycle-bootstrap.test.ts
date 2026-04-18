/**
 * Tests for POST /admin/lifecycle/bootstrap — guarded admin endpoint that
 * invokes `ensureLifecycleSubscriptions` via a DI-friendly factory.
 *
 * Security contract:
 *   - Auth is a shared `X-Internal-Bootstrap-Token` header compared against
 *     `INTERNAL_BOOTSTRAP_TOKEN` using length-safe constant-time comparison.
 *   - Responses never leak the internal token, bearer, body, or raw error.
 */
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  type EnsureLifecycleSubscriptionsOptions,
  type EnsureLifecycleSubscriptionsReport,
  SubscriptionBootstrapError,
} from "../../../lib/hubspot-subscription-bootstrap";
import { createLifecycleBootstrapRoute } from "../lifecycle-bootstrap";

const VALID_TOKEN = "internal-bootstrap-token-0123456789";
const TARGET_URL = "https://example.com/webhooks/hubspot/lifecycle";

function mount(
  deps: {
    ensure?: (
      opts: EnsureLifecycleSubscriptionsOptions,
    ) => Promise<EnsureLifecycleSubscriptionsReport>;
    env?: Record<string, string | undefined>;
  } = {},
) {
  const app = new Hono();
  app.route("/admin/lifecycle", createLifecycleBootstrapRoute(deps));
  return app;
}

function goodReport(): EnsureLifecycleSubscriptionsReport {
  return {
    targetUrl: TARGET_URL,
    created: [{ eventTypeId: "4-1909196", subscriptionId: "sub-install-1" }],
    alreadyPresent: [{ eventTypeId: "4-1916193", subscriptionId: "sub-uninstall-1" }],
  };
}

describe("POST /admin/lifecycle/bootstrap", () => {
  it("returns 401 when X-Internal-Bootstrap-Token is missing", async () => {
    const ensure =
      vi.fn<
        (opts: EnsureLifecycleSubscriptionsOptions) => Promise<EnsureLifecycleSubscriptionsReport>
      >();
    const app = mount({
      ensure,
      env: {
        INTERNAL_BOOTSTRAP_TOKEN: VALID_TOKEN,
        LIFECYCLE_TARGET_URL: TARGET_URL,
      },
    });

    const res = await app.request("/admin/lifecycle/bootstrap", {
      method: "POST",
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "missing_internal_token" });
    expect(ensure).not.toHaveBeenCalled();
  });

  it("returns 403 when token has the same length but wrong value", async () => {
    const ensure =
      vi.fn<
        (opts: EnsureLifecycleSubscriptionsOptions) => Promise<EnsureLifecycleSubscriptionsReport>
      >();
    const wrong = VALID_TOKEN.split("").reverse().join("");
    expect(wrong.length).toBe(VALID_TOKEN.length);

    const app = mount({
      ensure,
      env: {
        INTERNAL_BOOTSTRAP_TOKEN: VALID_TOKEN,
        LIFECYCLE_TARGET_URL: TARGET_URL,
      },
    });

    const res = await app.request("/admin/lifecycle/bootstrap", {
      method: "POST",
      headers: { "X-Internal-Bootstrap-Token": wrong },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "invalid_internal_token" });
    expect(ensure).not.toHaveBeenCalled();
  });

  it("returns 403 when token has a different length than the configured token", async () => {
    const ensure =
      vi.fn<
        (opts: EnsureLifecycleSubscriptionsOptions) => Promise<EnsureLifecycleSubscriptionsReport>
      >();
    const app = mount({
      ensure,
      env: {
        INTERNAL_BOOTSTRAP_TOKEN: VALID_TOKEN,
        LIFECYCLE_TARGET_URL: TARGET_URL,
      },
    });

    const res = await app.request("/admin/lifecycle/bootstrap", {
      method: "POST",
      headers: { "X-Internal-Bootstrap-Token": "short" },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "invalid_internal_token" });
    expect(ensure).not.toHaveBeenCalled();
  });

  it("returns 503 when INTERNAL_BOOTSTRAP_TOKEN env is missing (misconfigured)", async () => {
    const ensure =
      vi.fn<
        (opts: EnsureLifecycleSubscriptionsOptions) => Promise<EnsureLifecycleSubscriptionsReport>
      >();
    const app = mount({
      ensure,
      env: {
        INTERNAL_BOOTSTRAP_TOKEN: undefined,
        LIFECYCLE_TARGET_URL: TARGET_URL,
      },
    });

    const res = await app.request("/admin/lifecycle/bootstrap", {
      method: "POST",
      headers: { "X-Internal-Bootstrap-Token": VALID_TOKEN },
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "bootstrap_not_configured" });
    expect(ensure).not.toHaveBeenCalled();
  });

  it("returns 503 when LIFECYCLE_TARGET_URL env is missing", async () => {
    const ensure =
      vi.fn<
        (opts: EnsureLifecycleSubscriptionsOptions) => Promise<EnsureLifecycleSubscriptionsReport>
      >();
    const app = mount({
      ensure,
      env: {
        INTERNAL_BOOTSTRAP_TOKEN: VALID_TOKEN,
        LIFECYCLE_TARGET_URL: undefined,
      },
    });

    const res = await app.request("/admin/lifecycle/bootstrap", {
      method: "POST",
      headers: { "X-Internal-Bootstrap-Token": VALID_TOKEN },
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "bootstrap_not_configured" });
    expect(ensure).not.toHaveBeenCalled();
  });

  it("returns 200 with the report when token is valid and ensure succeeds", async () => {
    const report = goodReport();
    const ensure =
      vi.fn<
        (opts: EnsureLifecycleSubscriptionsOptions) => Promise<EnsureLifecycleSubscriptionsReport>
      >();
    ensure.mockResolvedValue(report);
    const app = mount({
      ensure,
      env: {
        INTERNAL_BOOTSTRAP_TOKEN: VALID_TOKEN,
        LIFECYCLE_TARGET_URL: TARGET_URL,
      },
    });

    const res = await app.request("/admin/lifecycle/bootstrap", {
      method: "POST",
      headers: { "X-Internal-Bootstrap-Token": VALID_TOKEN },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(report);
    expect(ensure).toHaveBeenCalledTimes(1);
    const firstCall = ensure.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toMatchObject({ targetUrl: TARGET_URL });
  });

  it("returns 502 with redacted shape when ensure throws SubscriptionBootstrapError", async () => {
    const err = new SubscriptionBootstrapError("redacted-internal-detail", {
      stage: "create",
      status: 502,
      eventTypeId: "4-1909196",
    });
    const ensure = vi.fn(async () => {
      throw err;
    });
    const app = mount({
      ensure,
      env: {
        INTERNAL_BOOTSTRAP_TOKEN: VALID_TOKEN,
        LIFECYCLE_TARGET_URL: TARGET_URL,
      },
    });

    const res = await app.request("/admin/lifecycle/bootstrap", {
      method: "POST",
      headers: { "X-Internal-Bootstrap-Token": VALID_TOKEN },
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({
      error: "upstream_failure",
      stage: "create",
      status: 502,
      eventTypeId: "4-1909196",
    });
    // Must not leak the error message, bearer tokens, or internal token.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("redacted-internal-detail");
    expect(serialized).not.toContain(VALID_TOKEN);
  });

  it("returns 500 with opaque error when ensure throws a generic Error", async () => {
    const ensure = vi.fn(async () => {
      throw new Error("boom");
    });
    const app = mount({
      ensure,
      env: {
        INTERNAL_BOOTSTRAP_TOKEN: VALID_TOKEN,
        LIFECYCLE_TARGET_URL: TARGET_URL,
      },
    });

    const res = await app.request("/admin/lifecycle/bootstrap", {
      method: "POST",
      headers: { "X-Internal-Bootstrap-Token": VALID_TOKEN },
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "internal_error" });
    expect(JSON.stringify(body)).not.toContain("boom");
  });
});
