/**
 * Tests for the HubSpot-project profile-aware extension build wrapper.
 *
 * The wrapper lives here (inside the extension package) because
 * `apps/hubspot-project/` is intentionally excluded from the pnpm workspace
 * and cannot host runnable TypeScript. It reads a profile file from the
 * sibling `apps/hubspot-project/hsprofile.<name>.json`, extracts the
 * `API_ORIGIN` variable, and invokes the existing extension build with
 * `process.env.API_ORIGIN` set to that value.
 *
 * The build itself is covered by `__tests__/built-bundle-origin.test.ts`
 * (Slice 8). Here we pin the profile-parsing + env-handoff contract.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractApiOrigin,
  InvalidProfileNameError,
  loadProfile,
  MissingApiOriginError,
  MissingProfileFileError,
  resolveProfilePath,
  runBuildWithProfile,
} from "../build-with-profile";

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "hap-build-wrapper-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function writeProfile(name: string, contents: unknown): string {
  const path = join(scratch, `hsprofile.${name}.json`);
  writeFileSync(path, JSON.stringify(contents));
  return path;
}

describe("resolveProfilePath()", () => {
  it("maps a profile name to the expected hsprofile.<name>.json path", () => {
    expect(resolveProfilePath("staging", scratch)).toBe(join(scratch, "hsprofile.staging.json"));
  });

  it("accepts the three shipped profile names", () => {
    for (const name of ["local", "staging", "production"]) {
      expect(() => resolveProfilePath(name, scratch)).not.toThrow();
    }
  });

  it.each([
    "",
    "..",
    "../leak",
    "with space",
    "UP",
    "semi;colon",
  ])("rejects malformed profile name %j", (bad) => {
    expect(() => resolveProfilePath(bad, scratch)).toThrow(InvalidProfileNameError);
  });
});

describe("loadProfile()", () => {
  it("parses a valid profile file into its JSON shape", () => {
    const path = writeProfile("staging", {
      accountId: 12345678,
      variables: {
        OAUTH_REDIRECT_URI: "https://x/oauth/callback",
        API_ORIGIN: "https://x",
      },
    });

    const loaded = loadProfile(path);
    expect(loaded.accountId).toBe(12345678);
    expect(loaded.variables.API_ORIGIN).toBe("https://x");
  });

  it("throws a clear MissingProfileFileError when the path does not exist", () => {
    const path = join(scratch, "hsprofile.nope.json");
    expect(() => loadProfile(path)).toThrow(MissingProfileFileError);
  });

  it("throws on malformed JSON rather than silently returning an empty object", () => {
    const path = join(scratch, "hsprofile.bad.json");
    writeFileSync(path, "{not json");

    expect(() => loadProfile(path)).toThrow(/profile file is not valid JSON/i);
  });
});

describe("extractApiOrigin()", () => {
  it("returns the API_ORIGIN variable when present", () => {
    const origin = "https://hap-signal-workspace-staging.vercel.app";
    expect(extractApiOrigin({ accountId: 1, variables: { API_ORIGIN: origin } })).toBe(origin);
  });

  it("throws MissingApiOriginError when variables object is missing", () => {
    expect(() =>
      extractApiOrigin({ accountId: 1 } as unknown as {
        accountId: number;
        variables: Record<string, string>;
      }),
    ).toThrow(MissingApiOriginError);
  });

  it("throws MissingApiOriginError when API_ORIGIN is empty or whitespace", () => {
    expect(() => extractApiOrigin({ accountId: 1, variables: { API_ORIGIN: "" } })).toThrow(
      MissingApiOriginError,
    );
    expect(() => extractApiOrigin({ accountId: 1, variables: { API_ORIGIN: "   " } })).toThrow(
      MissingApiOriginError,
    );
  });
});

describe("runBuildWithProfile() — env handoff", () => {
  it("sets process.env.API_ORIGIN to the profile value before invoking the build", async () => {
    writeProfile("staging", {
      accountId: 1,
      variables: {
        API_ORIGIN: "https://hap-signal-workspace-staging.vercel.app",
      },
    });

    // Capture the env the build sees at invocation time, NOT after.
    let envAtBuildTime: string | undefined;
    const runBuild = vi.fn(async () => {
      envAtBuildTime = process.env.API_ORIGIN;
    });

    await runBuildWithProfile({
      profileName: "staging",
      profileDir: scratch,
      runBuild,
    });

    expect(runBuild).toHaveBeenCalledTimes(1);
    expect(envAtBuildTime).toBe("https://hap-signal-workspace-staging.vercel.app");
  });

  it("restores the previous API_ORIGIN after the build completes (no env leakage)", async () => {
    writeProfile("staging", {
      accountId: 1,
      variables: {
        API_ORIGIN: "https://hap-signal-workspace-staging.vercel.app",
      },
    });

    const previous = process.env.API_ORIGIN;
    process.env.API_ORIGIN = "https://sentinel.example.com";
    try {
      await runBuildWithProfile({
        profileName: "staging",
        profileDir: scratch,
        runBuild: async () => {
          // no-op
        },
      });
      expect(process.env.API_ORIGIN).toBe("https://sentinel.example.com");
    } finally {
      if (previous === undefined) {
        delete process.env.API_ORIGIN;
      } else {
        process.env.API_ORIGIN = previous;
      }
    }
  });

  it("restores env even when the build throws", async () => {
    writeProfile("staging", {
      accountId: 1,
      variables: {
        API_ORIGIN: "https://hap-signal-workspace-staging.vercel.app",
      },
    });

    const previous = process.env.API_ORIGIN;
    delete process.env.API_ORIGIN;
    try {
      await expect(
        runBuildWithProfile({
          profileName: "staging",
          profileDir: scratch,
          runBuild: async () => {
            throw new Error("vite build failed");
          },
        }),
      ).rejects.toThrow(/vite build failed/);
      expect(process.env.API_ORIGIN).toBeUndefined();
    } finally {
      if (previous !== undefined) {
        process.env.API_ORIGIN = previous;
      }
    }
  });

  it("surfaces a readable error when the profile file is missing", async () => {
    await expect(
      runBuildWithProfile({
        profileName: "local",
        profileDir: scratch,
        runBuild: async () => {
          throw new Error("should not run");
        },
      }),
    ).rejects.toThrow(MissingProfileFileError);
  });
});
