import { describe, expect, it } from "vitest";
import { loadEnv } from "../env";

/**
 * Env validator tests (Slice 3). HUBSPOT_DEV_PORTAL_TOKEN removed;
 * ANTHROPIC_API_KEY + GEMINI_API_KEY added as optionals.
 */

// 32 random bytes base64-encoded (length === 44 chars, decodes to 32 bytes).
const VALID_KEK = "pS2N3fWhGDOO2aSEWBd2tj/1Dn6agCry6zqWT02KpQM=";

const VALID_ENV = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  HUBSPOT_CLIENT_ID: "client-id-123",
  HUBSPOT_CLIENT_SECRET: "client-secret-456",
  ROOT_KEK: VALID_KEK,
};

describe("loadEnv: happy path", () => {
  it("parses all required vars", () => {
    const env = loadEnv(VALID_ENV);
    expect(env.DATABASE_URL).toBe(VALID_ENV.DATABASE_URL);
    expect(env.HUBSPOT_CLIENT_ID).toBe(VALID_ENV.HUBSPOT_CLIENT_ID);
    expect(env.HUBSPOT_CLIENT_SECRET).toBe(VALID_ENV.HUBSPOT_CLIENT_SECRET);
    expect(env.ROOT_KEK).toBe(VALID_KEK);
  });

  it("passes through optional vars when present", () => {
    const env = loadEnv({
      ...VALID_ENV,
      OPENAI_API_KEY: "sk-test",
      EXA_API_KEY: "exa-test",
      ANTHROPIC_API_KEY: "sk-ant-test",
      GEMINI_API_KEY: "AIza-test",
      ALLOW_TEST_AUTH: "true",
    });
    expect(env.OPENAI_API_KEY).toBe("sk-test");
    expect(env.EXA_API_KEY).toBe("exa-test");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
    expect(env.GEMINI_API_KEY).toBe("AIza-test");
    expect(env.ALLOW_TEST_AUTH).toBe("true");
  });

  it("optional vars are undefined when absent", () => {
    const env = loadEnv(VALID_ENV);
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.EXA_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.ALLOW_TEST_AUTH).toBeUndefined();
  });

  it("HUBSPOT_DEV_PORTAL_TOKEN is NOT in the schema (removed in Slice 3)", () => {
    const env = loadEnv({ ...VALID_ENV, HUBSPOT_DEV_PORTAL_TOKEN: "pat-xyz" });
    expect("HUBSPOT_DEV_PORTAL_TOKEN" in env).toBe(false);
  });

  it("defaults to process.env when no argument passed", () => {
    // vitest.setup.ts loads real .env; DATABASE_URL should be set.
    const env = loadEnv();
    expect(env.DATABASE_URL).toMatch(/^postgres/);
  });
});

describe("loadEnv: required var errors", () => {
  it("throws when DATABASE_URL is missing", () => {
    const { DATABASE_URL: _omit, ...rest } = VALID_ENV;
    expect(() => loadEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it("throws when DATABASE_URL is not a URL", () => {
    expect(() => loadEnv({ ...VALID_ENV, DATABASE_URL: "not-a-url" })).toThrow(/DATABASE_URL/);
  });

  it("throws when HUBSPOT_CLIENT_ID is missing", () => {
    const { HUBSPOT_CLIENT_ID: _omit, ...rest } = VALID_ENV;
    expect(() => loadEnv(rest)).toThrow(/HUBSPOT_CLIENT_ID/);
  });

  it("throws when HUBSPOT_CLIENT_ID is empty", () => {
    expect(() => loadEnv({ ...VALID_ENV, HUBSPOT_CLIENT_ID: "" })).toThrow(/HUBSPOT_CLIENT_ID/);
  });

  it("throws when HUBSPOT_CLIENT_SECRET is missing", () => {
    const { HUBSPOT_CLIENT_SECRET: _omit, ...rest } = VALID_ENV;
    expect(() => loadEnv(rest)).toThrow(/HUBSPOT_CLIENT_SECRET/);
  });

  it("throws when ROOT_KEK is missing", () => {
    const { ROOT_KEK: _omit, ...rest } = VALID_ENV;
    expect(() => loadEnv(rest)).toThrow(/ROOT_KEK/);
  });

  it("throws when ROOT_KEK is not base64", () => {
    expect(() => loadEnv({ ...VALID_ENV, ROOT_KEK: "!!not-base64!!" })).toThrow(/ROOT_KEK/);
  });

  it("throws when ROOT_KEK decodes to wrong length (16 bytes, not 32)", () => {
    const kek16 = Buffer.alloc(16, 1).toString("base64");
    expect(() => loadEnv({ ...VALID_ENV, ROOT_KEK: kek16 })).toThrow(/ROOT_KEK/);
  });

  it("throws when ROOT_KEK decodes to wrong length (64 bytes, not 32)", () => {
    const kek64 = Buffer.alloc(64, 1).toString("base64");
    expect(() => loadEnv({ ...VALID_ENV, ROOT_KEK: kek64 })).toThrow(/ROOT_KEK/);
  });
});
