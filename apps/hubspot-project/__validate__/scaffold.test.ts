import { describe, expect, it } from "vitest";
import appHsmeta from "../src/app/app-hsmeta.json";
import cardHsmeta from "../src/app/cards/card-hsmeta.json";

// hsproject.json lives at the project root (outside src/). Its shape is
// enforced by HubSpot's own `hs project validate` and checked in CI via
// `hs project upload`, so we don't duplicate that assertion here.
//
// __validate__/ lives ABOVE src/ on purpose: HubSpot's project bundler
// only walks src/, so anything placed here is invisible to the upload but
// still picked up by vitest (root config: include "**/*.test.ts").

describe("HubSpot project scaffold (Slice 2 Step 1.5)", () => {
  it("app-hsmeta.json uses static private auth (anti-regression: no OAuth reversion)", () => {
    expect(appHsmeta.type).toBe("app");
    expect(appHsmeta.config.distribution).toBe("private");
    expect(appHsmeta.config.auth.type).toBe("static");
  });

  it("app-hsmeta.json permittedUrls.fetch is HTTPS-only (HubSpot rejects http and localhost on upload)", () => {
    const urls = appHsmeta.config.permittedUrls.fetch;
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith("https://")).toBe(true);
      expect(url).not.toContain("localhost");
    }
  });

  it("app-hsmeta.json permittedUrls.fetch includes the default API origin that api-fetcher.ts uses (Step 11 anti-regression)", () => {
    // This string is intentionally duplicated here and in
    // `apps/hubspot-extension/src/features/snapshot/hooks/api-fetcher.ts`
    // (`DEFAULT_API_BASE_URL`). If they drift, the extension will call an
    // origin HubSpot blocks at the outbound proxy and every snapshot load
    // will fail silently. This test keeps them aligned.
    //
    // We cannot import `DEFAULT_API_BASE_URL` directly because this
    // __validate__ package is isolated from the extension workspace; a
    // hard-coded literal is the correct way to catch drift.
    const EXPECTED_DEFAULT_API_BASE_URL = "https://hap-signal-workspace.vercel.app";
    expect(appHsmeta.config.permittedUrls.fetch).toContain(EXPECTED_DEFAULT_API_BASE_URL);
  });

  it("app-hsmeta.json scopes match the wedge (companies + contacts read)", () => {
    const scopes = appHsmeta.config.auth.requiredScopes;
    expect(scopes).toContain("crm.objects.companies.read");
    expect(scopes).toContain("crm.objects.contacts.read");
  });

  it("card-hsmeta.json mounts on company crm.record.tab pointing at SignalCard.tsx", () => {
    expect(cardHsmeta.type).toBe("card");
    expect(cardHsmeta.config.location).toBe("crm.record.tab");
    expect(cardHsmeta.config.objectTypes).toContain("companies");
    expect(cardHsmeta.config.entrypoint).toBe("/app/cards/SignalCard.tsx");
  });
});
