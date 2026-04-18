import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildViteOptions, bundleTargets } from "../bundle-hubspot-card";

describe("bundle-hubspot-card — programmatic define contract", () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env.API_ORIGIN;
  });

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.API_ORIGIN;
    } else {
      process.env.API_ORIGIN = previous;
    }
  });

  it("exposes the card and settings targets", () => {
    const names = bundleTargets.map((target) => target.name).sort();
    expect(names).toEqual(["card", "settings"]);
  });

  it("emits __HAP_API_ORIGIN__ as JSON.stringify(apiOrigin) for each target", () => {
    for (const target of bundleTargets) {
      const options = buildViteOptions(target, "https://staging.example.test");
      expect(options.define).toEqual({
        __HAP_API_ORIGIN__: JSON.stringify("https://staging.example.test"),
      });
    }
  });

  it("uses an empty-string sentinel when API_ORIGIN is unset", () => {
    const firstTarget = bundleTargets[0];
    if (!firstTarget) throw new Error("expected at least one bundle target");
    const options = buildViteOptions(firstTarget, "");
    expect(options.define).toEqual({
      __HAP_API_ORIGIN__: JSON.stringify(""),
    });
  });

  it("preserves trailing slashes verbatim inside the JSON-encoded value", () => {
    const origin = "https://staging.example.test/";
    const firstTarget = bundleTargets[0];
    if (!firstTarget) throw new Error("expected at least one bundle target");
    const options = buildViteOptions(firstTarget, origin);
    expect(options.define).toEqual({
      __HAP_API_ORIGIN__: JSON.stringify(origin),
    });
    // Also assert the raw encoded form contains the trailing slash literally.
    const encoded = (options.define as Record<string, string>).__HAP_API_ORIGIN__;
    expect(encoded).toBe(`"${origin}"`);
  });

  it("keeps configFile=false and two-bundle lib structure", () => {
    for (const target of bundleTargets) {
      const options = buildViteOptions(target, "https://example.test");
      expect(options.configFile).toBe(false);
      expect(options.build?.lib).toBeTruthy();
      expect(options.build?.lib && "entry" in options.build.lib && options.build.lib.entry).toBe(
        target.entry,
      );
    }
  });
});
