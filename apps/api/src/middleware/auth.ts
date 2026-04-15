/**
 * Slice 2 auth middleware entry point.
 *
 * Slice 1 shipped a bearer-token middleware (`API_TOKENS` env map). Slice 2
 * Step 4 replaces that with HubSpot's v3 signed-request verification. To keep
 * the public import surface stable for callers (`apps/api/src/index.ts`,
 * routes, tests), this module re-exports the signature middleware factory as
 * `authMiddleware`.
 *
 * All real verification logic, including the gated test bypass, lives in
 * `./hubspot-signature.ts`. See that file's JSDoc for the full spec and
 * retrieved doc date.
 */

import { hubspotSignatureMiddleware } from "./hubspot-signature";

export const authMiddleware = hubspotSignatureMiddleware;
