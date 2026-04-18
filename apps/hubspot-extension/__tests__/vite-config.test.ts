/**
 * Tests for the HubSpot extension's Vite config.
 *
 * The build pipeline is the only place where `process.env.API_ORIGIN` can
 * flow INTO the bundled JavaScript: HubSpot's `hs project upload` expands
 * `${API_ORIGIN}` inside `hsmeta.json` from the active profile, but it does
 * NOT propagate the variable into the TypeScript source. We close that gap
 * by having the HubSpot-side build wrapper set `API_ORIGIN` in the env
 * before invoking `vite build`, and have Vite replace the global constant
 * `__HAP_API_ORIGIN__` at build time via `define`.
 *
 * This test pins the contract of the `define` block so a future refactor
 * can't silently drop the substitution.
 */
import { resolve as resolvePath } from "node:path";
import type { UserConfig } from "vite";
import { describe, expect, it } from "vitest";

async function loadConfigWithEnv(
  envOverride: Partial<NodeJS.ProcessEnv>,
): Promise<UserConfig | Awaited<UserConfig>> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(envOverride)) {
    previous[key] = process.env[key];
    const value = envOverride[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    // Bust the module cache so Vite re-reads process.env on each call.
    const configPath = resolvePath(__dirname, "../vite.config.ts");
    const modUrl = `${configPath}?env=${encodeURIComponent(JSON.stringify(envOverride))}`;
    const mod = (await import(/* @vite-ignore */ modUrl)) as {
      default: UserConfig | (() => UserConfig | Promise<UserConfig>);
    };
    const raw = mod.default;
    return typeof raw === "function" ? await raw() : raw;
  } finally {
    for (const [key, prevValue] of Object.entries(previous)) {
      if (prevValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prevValue;
      }
    }
  }
}

function defineFor(config: UserConfig): Record<string, string> {
  const defineBlock = (config.define ?? {}) as Record<string, string>;
  return defineBlock;
}

describe("hubspot-extension vite.config.ts", () => {
  it("injects __HAP_API_ORIGIN__ from process.env.API_ORIGIN as a JSON string literal", async () => {
    const cfg = await loadConfigWithEnv({
      API_ORIGIN: "https://hap-signal-workspace-staging.vercel.app",
    });

    const block = defineFor(cfg);
    expect(block.__HAP_API_ORIGIN__).toBe(
      JSON.stringify("https://hap-signal-workspace-staging.vercel.app"),
    );
  });

  it("injects an empty-string literal when API_ORIGIN is unset, so the runtime resolver falls through", async () => {
    const cfg = await loadConfigWithEnv({ API_ORIGIN: undefined });

    const block = defineFor(cfg);
    // `JSON.stringify("")` → '""'. An empty string is how we signal
    // "no build-time configuration; use runtime/default fallback" in the
    // resolver. See resolve-api-base-url.test.ts for the consumer side.
    expect(block.__HAP_API_ORIGIN__).toBe(JSON.stringify(""));
  });

  it("preserves the API_ORIGIN value verbatim (no trailing-slash normalization)", async () => {
    // Clarity: the resolver does NOT strip trailing slashes. If a profile
    // supplies "https://host/" the built bundle carries that exact string
    // and any downstream URL construction (`${baseUrl}/api/snapshot/...`)
    // is responsible for reconciling it. Pin this as an explicit decision
    // so a later "helpful" normalization doesn't break signed fetch URLs.
    const cfg = await loadConfigWithEnv({
      API_ORIGIN: "https://hap-signal-workspace.vercel.app/",
    });

    const block = defineFor(cfg);
    expect(block.__HAP_API_ORIGIN__).toBe(
      JSON.stringify("https://hap-signal-workspace.vercel.app/"),
    );
  });
});
