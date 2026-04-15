import { describe, expect, it } from "vitest";
import appHsmeta from "../app-hsmeta.json";
import cardHsmeta from "../cards/card-hsmeta.json";

// hsproject.json lives outside this package's tsconfig rootDir (it's at the
// HubSpot project root, not under src/). Its shape is enforced by HubSpot's
// own `hs project info` validation, so we don't duplicate the check here.

describe("HubSpot project scaffold (Slice 2 Step 1.5)", () => {
  it("app-hsmeta.json uses static private auth (anti-regression: no OAuth reversion)", () => {
    expect(appHsmeta.type).toBe("app");
    expect(appHsmeta.config.distribution).toBe("private");
    expect(appHsmeta.config.auth.type).toBe("static");
  });

  it("app-hsmeta.json permittedUrls.fetch contains the local API origin (anti-regression: cannot remove silently)", () => {
    expect(appHsmeta.config.permittedUrls.fetch).toContain("http://localhost:3001");
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
