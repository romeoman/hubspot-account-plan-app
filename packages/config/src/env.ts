/**
 * Slice 2 runtime environment validator.
 *
 * Consumers import `loadEnv()` to obtain a typed, validated snapshot of the
 * required process env. Missing/invalid vars throw a clear error listing all
 * issues — we never return a partial object.
 *
 * Required vars (must be present at startup):
 *   - DATABASE_URL           Postgres connection string (URL).
 *   - HUBSPOT_CLIENT_ID      HubSpot public-app client id.
 *   - HUBSPOT_CLIENT_SECRET  HubSpot public-app client secret.
 *   - ROOT_KEK               base64-encoded 32-byte key (AES-256 key-encryption key).
 *
 * Optional vars (typed-through when present, do not fail startup if missing):
 *   - HUBSPOT_PRIVATE_APP_TOKEN  Step 9+ — private-app token for dev loops.
 *   - OPENAI_API_KEY             cassette recording only.
 *   - EXA_API_KEY                cassette recording only.
 *   - ALLOW_TEST_AUTH            test bypass; must be literal "true" to enable.
 *
 * `loadEnv()` defaults to `process.env` but accepts an override record for
 * tests. Do NOT inline `process.env` shape checks at call sites — always
 * route through this validator so Slice 2 callers share one typed view.
 */

import { z } from "zod";

/**
 * Coerce empty strings to undefined so optional env vars behave naturally
 * when .env files declare `FOO=` (unset with sentinel).
 */
function emptyToUndef(value: unknown): unknown {
  if (typeof value === "string" && value === "") return undefined;
  return value;
}

/**
 * Validates that a value is a base64 string decoding to exactly `expectedBytes` bytes.
 */
function base64Key(expectedBytes: number) {
  return z.string().superRefine((value, ctx) => {
    if (value.length === 0) {
      ctx.addIssue({ code: "custom", message: "must not be empty" });
      return;
    }
    // Strict base64 check — rejects whitespace and out-of-alphabet chars.
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      ctx.addIssue({ code: "custom", message: "must be valid base64" });
      return;
    }
    let decodedLen: number;
    try {
      decodedLen = Buffer.from(value, "base64").length;
    } catch {
      ctx.addIssue({ code: "custom", message: "failed to decode as base64" });
      return;
    }
    if (decodedLen !== expectedBytes) {
      ctx.addIssue({
        code: "custom",
        message: `must decode to exactly ${expectedBytes} bytes (got ${decodedLen})`,
      });
    }
  });
}

const envSchema = z.object({
  DATABASE_URL: z.string().url("must be a valid URL"),
  HUBSPOT_CLIENT_ID: z.string().min(1, "must not be empty"),
  HUBSPOT_CLIENT_SECRET: z.string().min(1, "must not be empty"),
  ROOT_KEK: base64Key(32),

  // Empty strings (common from unset vars in .env files) are coerced to
  // undefined so optional presence checks work intuitively.
  HUBSPOT_PRIVATE_APP_TOKEN: z.preprocess(emptyToUndef, z.string().min(1).optional()),
  OPENAI_API_KEY: z.preprocess(emptyToUndef, z.string().min(1).optional()),
  EXA_API_KEY: z.preprocess(emptyToUndef, z.string().min(1).optional()),
  ALLOW_TEST_AUTH: z.preprocess(emptyToUndef, z.literal("true").optional()),
});

/** Validated, typed Slice 2 runtime environment. */
export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate the runtime environment.
 *
 * @throws Error with a readable multi-line message listing every invalid var
 *   when validation fails. Callers should fail fast (exit the process).
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const varName = issue.path.join(".") || "(root)";
        return `  - ${varName}: ${issue.message}`;
      })
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return result.data;
}
