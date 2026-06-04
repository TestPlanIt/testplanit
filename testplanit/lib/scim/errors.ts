/**
 * SCIM 2.0 error response builder per RFC 7644 §3.12.
 *
 * Every SCIM error response MUST be a JSON object with:
 *   - `schemas`: ["urn:ietf:params:scim:api:messages:2.0:Error"]
 *   - `status`: stringified HTTP status code
 *   - `detail`: human-readable English description (NOT i18n'd — server-side
 *     strings stay English per project policy and per RFC 7644 §3.12 which
 *     describes `detail` as a diagnostic field for the calling client)
 *   - `scimType` (optional): one of the codes from RFC 7644 §3.12 Table 9
 *
 * RFC 7644 §3.12 Table 9 valid pairings:
 *   | status | scimType                                                         |
 *   |--------|------------------------------------------------------------------|
 *   | 400    | invalidFilter, invalidPath, invalidSyntax, invalidValue,         |
 *   |        | noTarget, tooMany, mutability, sensitive                         |
 *   | 401    | (none — no scimType)                                             |
 *   | 403    | (none)                                                           |
 *   | 404    | (none)                                                           |
 *   | 409    | uniqueness                                                       |
 *   | 412    | (none)                                                           |
 *   | 500    | (none)                                                           |
 *   | 501    | (none)                                                           |
 *
 * This module exposes ONE function — `scimError` — that returns a Next.js
 * `Response` with the correct status code, Content-Type, and body shape.
 * Per CONTEXT.md D-12 there is no `ScimError` class. Callers throw nothing;
 * they `return scimError(...)` from route handlers.
 */

import {
  SCIM_CONTENT_TYPE,
  SCIM_ERROR_SCHEMA,
  type ScimErrorType,
} from "./constants";

export interface ScimErrorBody {
  schemas: [typeof SCIM_ERROR_SCHEMA];
  status: string;
  detail: string;
  scimType?: ScimErrorType;
}

/**
 * Build a SCIM error `Response` ready to return from a Next.js route handler.
 *
 * @param status   - HTTP status code (RFC 7644 §3.12 valid set: 400, 401, 403,
 *                   404, 409, 412, 500, 501)
 * @param detail   - English diagnostic message describing the failure
 * @param scimType - Optional scimType code per RFC 7644 §3.12 Table 9.
 *                   Only emitted in the body when supplied; callers are
 *                   responsible for pairing it with a valid status.
 *
 * @example
 *   return scimError(404, `User ${id} not found`);
 *   return scimError(400, "Filter could not be parsed", "invalidFilter");
 *   return scimError(409, "userName already exists", "uniqueness");
 */
export function scimError(
  status: number,
  detail: string,
  scimType?: ScimErrorType,
): Response {
  const body: ScimErrorBody = {
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(status),
    detail,
  };

  if (scimType !== undefined) {
    body.scimType = scimType;
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": SCIM_CONTENT_TYPE },
  });
}
