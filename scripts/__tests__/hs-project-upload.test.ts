import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildUploadRunner, extractProfileName, type UploadDeps } from "../hs-project-upload";

function makeDeps(overrides: Partial<UploadDeps> = {}): UploadDeps {
  return {
    repoRoot: () => "/repo",
    makeTempDir: vi.fn(() => "/tmp/hap-upload"),
    copyProject: vi.fn(),
    runBundle: vi.fn(),
    runUpload: vi.fn(() => 0),
    log: vi.fn(),
    ...overrides,
  };
}

/**
 * Stage a HubSpot profile file on disk under `${root}/apps/hubspot-project/`
 * so `resolveProfilePath` + `loadProfile` can read it during tests.
 */
function stageProfile(root: string, name: string, apiOrigin: string | null): void {
  const dir = join(root, "apps/hubspot-project");
  mkdirSync(dir, { recursive: true });
  const variables: Record<string, string> = {
    OAUTH_REDIRECT_URI: "https://example.test/oauth/callback",
  };
  if (apiOrigin !== null) {
    variables.API_ORIGIN = apiOrigin;
  }
  writeFileSync(join(dir, `hsprofile.${name}.json`), JSON.stringify({ accountId: 42, variables }));
}

describe("extractProfileName", () => {
  it.each([
    ["--profile staging", ["--profile", "staging"], "staging"],
    ["--profile=staging", ["--profile=staging"], "staging"],
    ["-p staging", ["-p", "staging"], "staging"],
    ["-p=staging", ["-p=staging"], "staging"],
    ["absent", ["other", "args"], undefined],
  ])("%s", (_label, argv, expected) => {
    expect(extractProfileName(argv)).toBe(expected);
  });

  it.each([
    ["--profile as last arg", ["--profile"]],
    ["-p as last arg", ["-p"]],
    ["--profile followed by another flag", ["--profile", "--other"]],
    ["-p followed by another flag", ["-p", "--other"]],
  ])("throws a clear missing-value error: %s", (_label, argv) => {
    expect(() => extractProfileName(argv)).toThrow(/missing value for --profile/i);
  });
});

describe("hs-project-upload", () => {
  let profileRoot: string;
  let previousApiOrigin: string | undefined;

  beforeEach(() => {
    profileRoot = mkdtempSync(join(tmpdir(), "hap-upload-base-"));
    previousApiOrigin = process.env.API_ORIGIN;
    stageProfile(profileRoot, "dev", "https://dev.example.test");
  });

  afterEach(() => {
    rmSync(profileRoot, { recursive: true, force: true });
    if (previousApiOrigin === undefined) {
      delete process.env.API_ORIGIN;
    } else {
      process.env.API_ORIGIN = previousApiOrigin;
    }
  });

  it("bundles the HubSpot card before copying and uploading the project", () => {
    const deps = makeDeps({ repoRoot: () => profileRoot });

    const exitCode = buildUploadRunner(deps)(["--profile", "dev"]);

    expect(exitCode).toBe(0);
    expect(deps.runBundle).toHaveBeenCalledTimes(1);
    expect(deps.copyProject).toHaveBeenCalledWith(
      join(profileRoot, "apps/hubspot-project"),
      "/tmp/hap-upload",
    );
    expect(deps.runUpload).toHaveBeenCalledWith("/tmp/hap-upload", ["--profile", "dev"]);
  });

  it("mirrors the selected profile into tmp/src so HubSpot CLI can load it", () => {
    const uploadTmp = mkdtempSync(join(tmpdir(), "hap-upload-dest-"));
    const deps = makeDeps({
      repoRoot: () => profileRoot,
      makeTempDir: () => uploadTmp,
      copyProject: (src, tmp) => {
        cpSync(src, tmp, { recursive: true });
      },
    });

    try {
      const exitCode = buildUploadRunner(deps)(["--profile", "dev"]);

      expect(exitCode).toBe(0);
      expect(readFileSync(join(uploadTmp, "src", "hsprofile.dev.json"), "utf8")).toBe(
        readFileSync(join(profileRoot, "apps/hubspot-project", "hsprofile.dev.json"), "utf8"),
      );
    } finally {
      rmSync(uploadTmp, { recursive: true, force: true });
    }
  });

  it("does not upload when bundling fails", () => {
    const deps = makeDeps({
      repoRoot: () => profileRoot,
      runBundle: vi.fn(() => {
        throw new Error("bundle failed");
      }),
    });

    expect(() => buildUploadRunner(deps)(["--profile", "dev"])).toThrow(/bundle failed/);
    expect(deps.runUpload).not.toHaveBeenCalled();
  });

  it("requires an explicit HubSpot profile for upload", () => {
    const deps = makeDeps();

    expect(() => buildUploadRunner(deps)([])).toThrow(/--profile/);
    expect(deps.runUpload).not.toHaveBeenCalled();
  });
});

describe("hs-project-upload — profile API_ORIGIN handoff", () => {
  let profileRoot: string;
  let previousApiOrigin: string | undefined;

  beforeEach(() => {
    profileRoot = mkdtempSync(join(tmpdir(), "hap-upload-profile-"));
    previousApiOrigin = process.env.API_ORIGIN;
  });

  afterEach(() => {
    rmSync(profileRoot, { recursive: true, force: true });
    if (previousApiOrigin === undefined) {
      delete process.env.API_ORIGIN;
    } else {
      process.env.API_ORIGIN = previousApiOrigin;
    }
  });

  function depsReadingProfile(
    overrides: Partial<UploadDeps> = {},
  ): UploadDeps & { observedApiOrigin: { value: string | undefined } } {
    const observed = { value: undefined as string | undefined };
    const deps = makeDeps({
      repoRoot: () => profileRoot,
      runBundle: vi.fn(() => {
        observed.value = process.env.API_ORIGIN;
      }),
      ...overrides,
    });
    return Object.assign(deps, { observedApiOrigin: observed });
  }

  it.each([
    ["--profile staging", ["--profile", "staging"]],
    ["--profile=staging", ["--profile=staging"]],
    ["-p staging", ["-p", "staging"]],
    ["-p=staging", ["-p=staging"]],
  ])("extracts the profile name from %s", (_label, args) => {
    stageProfile(profileRoot, "staging", "https://staging.example.test");
    const deps = depsReadingProfile();

    const code = buildUploadRunner(deps)(args);

    expect(code).toBe(0);
    expect(deps.observedApiOrigin.value).toBe("https://staging.example.test");
  });

  it("sets process.env.API_ORIGIN to the profile value at the moment runBundle is called", () => {
    stageProfile(profileRoot, "staging", "https://staging.example.test/");
    const deps = depsReadingProfile();

    buildUploadRunner(deps)(["--profile", "staging"]);

    expect(deps.observedApiOrigin.value).toBe("https://staging.example.test/");
  });

  it("restores the previous API_ORIGIN value after the runner returns", () => {
    process.env.API_ORIGIN = "https://prior.example.test";
    stageProfile(profileRoot, "staging", "https://staging.example.test");
    const deps = depsReadingProfile();

    buildUploadRunner(deps)(["--profile", "staging"]);

    expect(process.env.API_ORIGIN).toBe("https://prior.example.test");
  });

  it("deletes API_ORIGIN after the runner if it was previously unset", () => {
    delete process.env.API_ORIGIN;
    stageProfile(profileRoot, "staging", "https://staging.example.test");
    const deps = depsReadingProfile();

    buildUploadRunner(deps)(["--profile", "staging"]);

    expect(process.env.API_ORIGIN).toBeUndefined();
  });

  it("restores API_ORIGIN even when runUpload throws", () => {
    process.env.API_ORIGIN = "https://prior.example.test";
    stageProfile(profileRoot, "staging", "https://staging.example.test");
    const deps = depsReadingProfile({
      runUpload: vi.fn(() => {
        throw new Error("upload blew up");
      }),
    });

    expect(() => buildUploadRunner(deps)(["--profile", "staging"])).toThrow(/upload blew up/);
    expect(process.env.API_ORIGIN).toBe("https://prior.example.test");
  });

  it("surfaces MissingApiOriginError before bundling or uploading when profile lacks API_ORIGIN", () => {
    stageProfile(profileRoot, "staging", null);
    const deps = depsReadingProfile();

    expect(() => buildUploadRunner(deps)(["--profile", "staging"])).toThrow(
      /variables\.API_ORIGIN/,
    );
    expect(deps.runBundle).not.toHaveBeenCalled();
    expect(deps.runUpload).not.toHaveBeenCalled();
  });
});
