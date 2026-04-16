import { describe, expect, it, vi } from "vitest";
import { buildUploadRunner, type UploadDeps } from "../hs-project-upload";

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

describe("hs-project-upload", () => {
  it("bundles the HubSpot card before copying and uploading the project", () => {
    const deps = makeDeps();

    const exitCode = buildUploadRunner(deps)(["--profile", "dev"]);

    expect(exitCode).toBe(0);
    expect(deps.runBundle).toHaveBeenCalledTimes(1);
    expect(deps.copyProject).toHaveBeenCalledWith("/repo/apps/hubspot-project", "/tmp/hap-upload");
    expect(deps.runUpload).toHaveBeenCalledWith("/tmp/hap-upload", ["--profile", "dev"]);
  });

  it("does not upload when bundling fails", () => {
    const deps = makeDeps({
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
