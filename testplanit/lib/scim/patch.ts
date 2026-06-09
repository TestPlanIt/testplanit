/**
 * SCIM 2.0 PATCH interpreter — a pure wrapper around `scim-patch` that adds
 * three guarantees over the bare library:
 *
 *   1. Body-shape validation runs FIRST (delegated to `patchBodyValidation`)
 *      and any `ScimError` it throws is mapped to a prebuilt SCIM error
 *      response carried on a `ScimPatchApplyError`. The route handler catches
 *      the carrier and returns `error.response` directly.
 *
 *   2. A narrow Entra preprocessing step coerces `value:"False"` / `value:"True"`
 *      to booleans, but ONLY for `path === "active"`. The Microsoft Entra IdP
 *      without the `aadOptscim062020` feature flag emits string booleans for
 *      the active flag specifically; we never broaden the coercion to other
 *      attributes because legitimate string values like a `name.givenName` of
 *      "False" would otherwise be silently turned into the boolean `false`.
 *
 *   3. The non-mutating draft option + `treatMissingAsAdd: true` are passed to
 *      the underlying call so that partial PATCH failure leaves the input
 *      resource byte-identical. The service layer composes this wrapper inside a single
 *      `prisma.$transaction` and issues exactly one `tx.user.update` against
 *      the returned draft — the RFC 7644 §3.5.2 atomicity contract becomes a
 *      consequence of this option instead of a discipline the caller has to
 *      remember on every code path.
 *
 * Operations arrays longer than 500 entries are rejected with a 400
 * envelope BEFORE `scim-patch` ever sees the array — a DoS guard against
 * adversarial bodies that could otherwise blow the reduce stack inside the
 * library.
 *
 * Non-`ScimError` exceptions (e.g. a `TypeError` from a malformed body) pass
 * through unwrapped so the service layer can distinguish library bugs from
 * RFC-compliant rejection without parsing an envelope.
 */

import {
  ScimError,
  patchBodyValidation,
  scimPatch,
  type ScimPatch,
  type ScimPatchOperation,
} from "scim-patch";

import { scimError, type ScimErrorType } from "./errors";

import type { NextResponse } from "next/server";

const MAX_OPERATIONS = 500;

/**
 * Carrier exception thrown by {@link applyScimPatch} when a PATCH cannot be
 * applied. `response` holds a fully-built SCIM error envelope ready for the
 * route handler to return verbatim: `catch (e) { if (e instanceof
 * ScimPatchApplyError) return e.response; throw e; }`.
 */
export class ScimPatchApplyError extends Error {
  constructor(public readonly response: NextResponse) {
    super("SCIM patch apply failed");
    this.name = "ScimPatchApplyError";
  }
}

/**
 * Apply a SCIM 2.0 PATCH body to an in-memory SCIM resource and return a new
 * draft. The input `current` is never mutated. Throws {@link
 * ScimPatchApplyError} for every RFC-compliant rejection (carrying a
 * prebuilt SCIM error response); rethrows any other exception unchanged.
 */
export function applyScimPatch<T>(current: T, body: ScimPatch): T {
  // DoS guard runs BEFORE patchBodyValidation so an adversarial 1e6-op body
  // is rejected without an O(n) walk inside the library.
  if (
    typeof body === "object" &&
    body !== null &&
    Array.isArray((body as { Operations?: unknown }).Operations) &&
    (body as ScimPatch).Operations.length > MAX_OPERATIONS
  ) {
    throw new ScimPatchApplyError(
      scimError(
        400,
        "invalidSyntax",
        `Operations array exceeds maximum length of ${MAX_OPERATIONS}`
      )
    );
  }

  try {
    patchBodyValidation(body);
  } catch (e) {
    if (e instanceof ScimError) {
      throw new ScimPatchApplyError(mapScimErrorCode(e));
    }
    throw e;
  }

  const preprocessed = body.Operations.flatMap(rewriteEntraMembersRemove).map(
    coerceEntraActiveString
  );

  try {
    return scimPatch(
      current as unknown as Parameters<typeof scimPatch>[0],
      preprocessed,
      { mutateDocument: false, treatMissingAsAdd: true }
    ) as unknown as T;
  } catch (e) {
    if (e instanceof ScimError) {
      throw new ScimPatchApplyError(mapScimErrorCode(e));
    }
    throw e;
  }
}

/**
 * Narrow Entra members-Remove rewrite: when the inbound op matches the exact
 * non-spec shape Microsoft Entra emits without the `aadOptscim062020` flag
 * (`{op:"Remove", path:"members", value:[{value:"<id>"}, ...]}`), fan it out
 * into one spec-form remove per member-id. Every other op shape — including
 * unrelated members-path ops, string-value ops, ops with non-string entries,
 * and an empty value array — passes through unchanged so the existing
 * scim-patch behavior is preserved verbatim.
 *
 * Embedded backslashes and double-quotes in the member id are escaped before
 * being templated into the rewritten `members[value eq "<id>"]` filter so a
 * malicious id cannot break out of the filter expression. Backslashes must
 * be escaped FIRST — escaping the quote first and the backslash after would
 * double-escape the inserted backslash before the now-escaped quote, leaving
 * an even count of trailing backslashes that the SCIM filter parser would
 * consume as `\\` pairs and then close the string on the unescaped `"`.
 */
export function rewriteEntraMembersRemove(
  op: ScimPatchOperation
): ScimPatchOperation | ScimPatchOperation[] {
  const opLower = typeof op.op === "string" ? op.op.toLowerCase() : "";
  if (opLower !== "remove") {
    return op;
  }
  if (op.path !== "members") {
    return op;
  }
  const value = (op as { value?: unknown }).value;
  if (!Array.isArray(value) || value.length === 0) {
    return op;
  }
  const allValid = value.every(
    (entry: unknown): entry is { value: string } =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { value?: unknown }).value === "string"
  );
  if (!allValid) {
    return op;
  }
  return (value as Array<{ value: string }>).map((entry) => {
    const escaped = entry.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return {
      op: "remove",
      path: `members[value eq "${escaped}"]`,
    };
  });
}

/**
 * Narrow Entra coercion: only `path === "active"` with the exact capitalized
 * string `"False"` or `"True"` is rewritten to a boolean. Every other op
 * passes through verbatim.
 */
function coerceEntraActiveString(op: ScimPatchOperation): ScimPatchOperation {
  if (
    op.path === "active" &&
    typeof (op as { value?: unknown }).value === "string"
  ) {
    const v = (op as { value: string }).value;
    if (v === "False") return { ...op, value: false } as ScimPatchOperation;
    if (v === "True") return { ...op, value: true } as ScimPatchOperation;
  }
  return op;
}

/**
 * Map a `ScimError` subclass from `scim-patch` to a prebuilt SCIM envelope.
 * The library already populates `scimCode` per the RFC 7644 §3.12 table, so
 * the only translation needed is the fallback when a subclass omits it.
 */
function mapScimErrorCode(e: ScimError): NextResponse {
  const scimType: ScimErrorType =
    (e.scimCode as ScimErrorType | undefined) ?? "invalidSyntax";
  return scimError(400, scimType, e.message);
}
