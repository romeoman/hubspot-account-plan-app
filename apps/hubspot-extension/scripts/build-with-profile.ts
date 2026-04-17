/**
 * Profile-aware extension build wrapper.
 *
 * Closes the Slice 8 gap: the Vite `define` block reads
 * `process.env.API_ORIGIN` but nothing sets that env per HubSpot profile
 * (`hsprofile.local.json`, `hsprofile.staging.json`, `hsprofile.production.json`).
 * This wrapper reads the selected profile file, extracts its
 * `variables.API_ORIGIN`, sets the env, and invokes the existing build.
 *
 * Library (this file): pure helpers + orchestrator. The CLI entry lives in
 * `build-with-profile-cli.ts` so tests can import the helpers without
 * triggering a build as a side effect of import.
 *
 * Intended production usage (from the HubSpot project build step):
 *
 *   pnpm --filter @hap/hubspot-extension exec tsx \
 *     scripts/build-with-profile-cli.ts --profile staging
 *
 * Profile files live in `apps/hubspot-project/` (gitignored real files,
 * committed `.example.json` templates).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Error thrown when the caller asks for a profile name we refuse to resolve. */
export class InvalidProfileNameError extends Error {
  constructor(name: string) {
    super(
      `Invalid profile name: ${JSON.stringify(name)}. Only lowercase ` +
        `alphanumerics, dashes, and underscores are allowed — no slashes, ` +
        `dots, spaces, or shell metacharacters.`,
    );
    this.name = "InvalidProfileNameError";
  }
}

/** Error thrown when the resolved profile path does not exist on disk. */
export class MissingProfileFileError extends Error {
  constructor(path: string) {
    super(
      `HubSpot profile file not found: ${path}. Copy ` +
        `hsprofile.<name>.example.json to hsprofile.<name>.json and fill in ` +
        `the account-specific values before running the build.`,
    );
    this.name = "MissingProfileFileError";
  }
}

/** Error thrown when the profile's `variables.API_ORIGIN` is missing/empty. */
export class MissingApiOriginError extends Error {
  constructor() {
    super(
      "Profile is missing a non-empty variables.API_ORIGIN. The wrapper " +
        "refuses to invoke the build without it — the produced bundle " +
        "would hard-code the prod fallback instead of the profile's origin.",
    );
    this.name = "MissingApiOriginError";
  }
}

export type HsProfile = {
  accountId: number;
  variables: Record<string, string>;
};

/**
 * Allowed profile-name regex. Intentionally strict:
 *   - lowercase ASCII letters, digits, dashes, underscores
 *   - at least one character
 *   - rejects `..`, `/`, `.`, whitespace, and anything that would let a
 *     caller pivot the resolved path outside the profile directory.
 */
const PROFILE_NAME_RE = /^[a-z0-9_-]+$/;

/**
 * Resolve a profile name to its on-disk path without ever escaping
 * `profileDir`. Throws on any name that fails {@link PROFILE_NAME_RE}.
 */
export function resolveProfilePath(profileName: string, profileDir: string): string {
  if (!PROFILE_NAME_RE.test(profileName)) {
    throw new InvalidProfileNameError(profileName);
  }
  return join(profileDir, `hsprofile.${profileName}.json`);
}

/** Read + parse the profile file. Throws typed errors on IO / JSON failures. */
export function loadProfile(profilePath: string): HsProfile {
  if (!existsSync(profilePath)) {
    throw new MissingProfileFileError(profilePath);
  }
  const raw = readFileSync(profilePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `Profile file is not valid JSON: ${profilePath}`,
      cause instanceof Error ? { cause } : undefined,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { accountId?: unknown }).accountId !== "number" ||
    typeof (parsed as { variables?: unknown }).variables !== "object" ||
    (parsed as { variables?: unknown }).variables === null
  ) {
    throw new Error(
      `Profile file has unexpected shape (expected { accountId: number, ` +
        `variables: object }): ${profilePath}`,
    );
  }
  return parsed as HsProfile;
}

/** Return `variables.API_ORIGIN` or throw if absent / empty / whitespace. */
export function extractApiOrigin(profile: HsProfile): string {
  const value = profile.variables?.API_ORIGIN;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MissingApiOriginError();
  }
  return value;
}

export type RunBuildWithProfileOptions = {
  profileName: string;
  profileDir: string;
  /**
   * Injected build callable. In production this runs `vite build`; in tests
   * it is a captured spy. Keeping the build out of this function means the
   * unit tests never touch Vite and execute in milliseconds.
   */
  runBuild: () => Promise<void>;
};

/**
 * Orchestrate the wrapper flow:
 *   1. resolve profile path (validated)
 *   2. read + parse profile
 *   3. extract API_ORIGIN
 *   4. set `process.env.API_ORIGIN` for the duration of the build
 *   5. invoke `runBuild`
 *   6. restore the previous env (success OR failure path)
 */
export async function runBuildWithProfile(opts: RunBuildWithProfileOptions): Promise<void> {
  const profilePath = resolveProfilePath(opts.profileName, opts.profileDir);
  const profile = loadProfile(profilePath);
  const apiOrigin = extractApiOrigin(profile);

  const previous = process.env.API_ORIGIN;
  process.env.API_ORIGIN = apiOrigin;
  try {
    await opts.runBuild();
  } finally {
    if (previous === undefined) {
      delete process.env.API_ORIGIN;
    } else {
      process.env.API_ORIGIN = previous;
    }
  }
}
