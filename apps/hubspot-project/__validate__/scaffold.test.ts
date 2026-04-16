import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import appHsmeta from "../src/app/app-hsmeta.json";
import cardHsmeta from "../src/app/cards/card-hsmeta.json";
import settingsHsmeta from "../src/app/settings/settings-hsmeta.json";

// hsproject.json lives at the project root (outside src/). Its shape is
// enforced by HubSpot's own `hs project validate` and checked in CI via
// `hs project upload`, so we don't duplicate that assertion here.
//
// __validate__/ lives ABOVE src/ on purpose: HubSpot's project bundler
// only walks src/, so anything placed here is invisible to the upload but
// still picked up by vitest (root config: include "**/*.test.ts").

describe("HubSpot project scaffold (Slice 3 Task 5)", () => {
  it("app-hsmeta.json uses OAuth marketplace auth (Slice 3 migration from static/private)", () => {
    expect(appHsmeta.type).toBe("app");
    expect(appHsmeta.config.distribution).toBe("marketplace");
    expect(appHsmeta.config.auth.type).toBe("oauth");
  });

  it("app-hsmeta.json has redirectUrls with localhost for dev", () => {
    const urls = (appHsmeta.config.auth as { redirectUrls?: string[] }).redirectUrls ?? [];
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.some((u: string) => u.includes("localhost"))).toBe(true);
  });

  it("app-hsmeta.json permittedUrls.fetch includes https://api.hubapi.com for OAuth token exchange", () => {
    expect(appHsmeta.config.permittedUrls.fetch).toContain("https://api.hubapi.com");
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

  it("SignalCard.tsx re-exports the bundled default export directly", () => {
    const signalCardPath = resolve(import.meta.dirname, "../src/app/cards/SignalCard.tsx");
    const signalCardSource = readFileSync(signalCardPath, "utf8").trim();

    expect(signalCardSource).toBe('export { default } from "./dist/index.js";');
  });

  it("settings-hsmeta.json registers a settings extension entrypoint", () => {
    expect(settingsHsmeta.type).toBe("settings");
    expect(settingsHsmeta.config.entrypoint).toBe("/app/settings/Settings.tsx");
  });

  it("Settings.tsx re-exports the bundled settings default export directly", () => {
    const settingsPath = resolve(import.meta.dirname, "../src/app/settings/Settings.tsx");
    const settingsSource = readFileSync(settingsPath, "utf8").trim();

    expect(settingsSource).toBe('export { default } from "./dist/index.js";');
  });

  it("settings/package.json mirrors the HubSpot feature scaffold shape", () => {
    const settingsPackagePath = resolve(import.meta.dirname, "../src/app/settings/package.json");
    const settingsPackage = JSON.parse(readFileSync(settingsPackagePath, "utf8")) as {
      name: string;
      type: string;
      dependencies?: Record<string, string>;
    };

    expect(settingsPackage.name).toBe("hap-signal-workspace-settings");
    expect(settingsPackage.type).toBe("module");
    expect(settingsPackage.dependencies?.["@hubspot/ui-extensions"]).toBeDefined();
    expect(settingsPackage.dependencies?.react).toBeDefined();
  });

  it("settings-entry.tsx registers a HubSpot settings extension", () => {
    const settingsEntryPath = resolve(
      import.meta.dirname,
      "../../hubspot-extension/src/settings/settings-entry.tsx",
    );
    const settingsEntrySource = readFileSync(settingsEntryPath, "utf8");

    expect(settingsEntrySource).toContain('hubspot.extend<"settings">');
    expect(settingsEntrySource).toContain("export default function HubSpotSettingsEntry()");
  });
});
