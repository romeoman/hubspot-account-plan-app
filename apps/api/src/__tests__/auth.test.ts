/**
 * Slice 2 auth.ts is a thin re-export: authMiddleware() === hubspotSignatureMiddleware().
 *
 * Deep behavior (signature verification, timestamp freshness, portal
 * resolution, test bypass gating) is covered in
 * `apps/api/src/middleware/__tests__/hubspot-signature.test.ts`. This file
 * only asserts the re-export shape so callers that `import { authMiddleware }`
 * continue to work after the rewrite.
 */
import { describe, expect, it } from "vitest";
import { authMiddleware } from "../middleware/auth";
import { hubspotSignatureMiddleware } from "../middleware/hubspot-signature";

describe("authMiddleware (Slice 2 delegation)", () => {
  it("is the HubSpot signed-request middleware factory", () => {
    expect(typeof authMiddleware).toBe("function");
    const mw = authMiddleware();
    expect(typeof mw).toBe("function");
    // Both factories must produce middleware with the same arity (c, next).
    expect(mw.length).toBe(hubspotSignatureMiddleware().length);
  });
});
