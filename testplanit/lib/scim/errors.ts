/**
 * SCIM 2.0 error response builder per RFC 7644 §3.12.
 *
 * Every SCIM error response MUST be a JSON object with:
 *   - `schemas`: ["urn:ietf:params:scim:api:messages:2.0:Error"]
 *   - `status`: stringified HTTP status code
 *   - `detail`: human-readable English description (server-side error strings
 *     stay English — diagnosability beats locale fidelity for this category)
 *   - `scimType` (optional): one of the codes from RFC 7644 §3.12 Table 9.
 *     When the caller passes `null` the field is omitted from the body entirely
 *     (NOT serialized as JSON `null`).
 *
 * RFC 7644 §3.12 Table 9 valid status / scimType pairings:
 *   | status | scimType                                                       |
 *   |--------|----------------------------------------------------------------|
 *   | 400    | invalidFilter, invalidPath, invalidSyntax, invalidValue,       |
 *   |        | invalidVers, mutability, noTarget, sensitive, tooMany          |
 *   | 401    | (none)                                                         |
 *   | 403    | (none)                                                         |
 *   | 404    | (none — caller passes `null`)                                  |
 *   | 409    | uniqueness                                                     |
 *   | 412    | (none)                                                         |
 *   | 500    | (none)                                                         |
 *   | 501    | (none — caller passes `null`)                                  |
 *
 * Exposes ONE function — `scimError` — that returns a `NextResponse` with
 * the correct status, Content-Type, and body shape. There is intentionally
 * no per-status sugar helper (e.g. `notFound()`, `conflict()`); callers
 * always pass the explicit `(status, scimType, detail)` tuple so every error
 * path is grep-able by status code.
 */

import { NextResponse } from "next/server";

import { SCIM_CONTENT_TYPE, SCIM_ERROR_SCHEMA_URN } from "./constants";

export type ScimErrorType =
  | "invalidFilter"
  | "invalidPath"
  | "invalidSyntax"
  | "invalidValue"
  | "invalidVers"
  | "mutability"
  | "noTarget"
  | "sensitive"
  | "tooMany"
  | "uniqueness"
  | null;

/**
 * Build a SCIM error response ready to return from a Next.js route handler.
 *
 * @param status   - HTTP status code (RFC 7644 §3.12 valid set: 400, 401, 403,
 *                   404, 409, 412, 500, 501)
 * @param scimType - scimType code per RFC 7644 §3.12 Table 9, or `null` to
 *                   omit the field entirely.
 * @param detail   - English diagnostic message describing the failure.
 *
 * @example
 *   return scimError(404, null, `User ${id} not found`);
 *   return scimError(400, "invalidFilter", "Filter could not be parsed");
 *   return scimError(409, "uniqueness", "userName already exists");
 */
export function scimError(
  status: number,
  scimType: ScimErrorType,
  detail: string
): NextResponse {
  const body: Record<string, unknown> = {
    schemas: [SCIM_ERROR_SCHEMA_URN],
    status: String(status),
    detail,
  };

  if (scimType !== null) {
    body.scimType = scimType;
  }

  return NextResponse.json(body, {
    status,
    headers: { "Content-Type": SCIM_CONTENT_TYPE },
  });
}
