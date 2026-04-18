/**
 * Slice 11 Task 4 — CLI shim for lifecycle subscription bootstrap.
 *
 * Invokes `ensureLifecycleSubscriptions` directly (no HTTP). Intended for
 * operators running via `pnpm --filter @hap/api lifecycle:bootstrap`.
 *
 * Exit codes:
 *   0 — success; JSON report printed to stdout.
 *   1 — unexpected / generic error; `{ error: "internal_error" }` on stderr.
 *   2 — misconfiguration (missing `LIFECYCLE_TARGET_URL`).
 *   3 — `SubscriptionBootstrapError`; redacted shape on stderr.
 *
 * Never prints bearer tokens, raw error messages, or response bodies.
 */

import {
  ensureLifecycleSubscriptions,
  SubscriptionBootstrapError,
} from "../src/lib/hubspot-subscription-bootstrap";

async function main(): Promise<void> {
  const targetUrl = process.env.LIFECYCLE_TARGET_URL;
  if (!targetUrl || targetUrl.length === 0) {
    process.stderr.write("lifecycle-bootstrap: LIFECYCLE_TARGET_URL is required\n");
    process.exit(2);
  }

  try {
    const report = await ensureLifecycleSubscriptions({ targetUrl });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(0);
  } catch (err) {
    if (err instanceof SubscriptionBootstrapError) {
      const payload = {
        error: "upstream_failure",
        stage: err.stage,
        status: err.status,
        eventTypeId: err.eventTypeId,
      };
      process.stderr.write(`${JSON.stringify(payload)}\n`);
      process.exit(3);
    }
    process.stderr.write(`${JSON.stringify({ error: "internal_error" })}\n`);
    process.exit(1);
  }
}

void main();
