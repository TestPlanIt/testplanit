/**
 * SCIM 2.0 Groups resource route — RFC 7644 §3.4.1 / §3.5.1 / §3.5.2 / §3.6.
 *
 *   GET    /scim/v2/Groups/{id}  — retrieve one Group
 *   PUT    /scim/v2/Groups/{id}  — full replace
 *   PATCH  /scim/v2/Groups/{id}  — partial modify (RFC 7644 §3.5.2 PatchOp)
 *   DELETE /scim/v2/Groups/{id}  — soft-delete (204 No Content, tombstoned)
 *   POST   /scim/v2/Groups/{id}  — 405 (POST only valid on the collection)
 *
 * Every handler runs the SCIM bearer middleware first, validates the inbound
 * body shape with a zod schema that passthroughs URN-prefixed extension
 * keys, delegates to the service layer for transaction-owning business
 * logic, and maps the service's typed error classes onto the shared
 * `scimError` envelope. DELETE returns 204 with `Content-Type:
 * application/scim+json` explicitly set so IdPs can confirm the SCIM
 * surface even on an empty body.
 */
import { isUniqueConstraintError } from "~/lib/utils/errors";
import { ORMError } from "@zenstackhq/orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

import { ScimAuthError, requireScimBearer } from "~/lib/scim/auth";
import { SCIM_CONTENT_TYPE } from "~/lib/scim/constants";
import { scimError } from "~/lib/scim/errors";
import { ScimPatchApplyError } from "~/lib/scim/patch";
import { scimResponse } from "~/lib/scim/responses";
import {
  ScimNotFoundError,
  ScimUniquenessError,
  ScimValidationError,
  deleteScimGroup,
  getScimGroupById,
  patchScimGroup,
  putScimGroup,
} from "~/lib/scim/services/groups";

/**
 * Inbound SCIM Group body shape for PUT. `.passthrough()` preserves
 * URN-keyed enterprise extension blobs for the service mapper to
 * round-trip.
 */
const scimGroupBodySchema = z
  .object({
    schemas: z.array(z.string()).optional(),
    displayName: z.string().min(1),
    externalId: z.string().nullable().optional(),
    members: z
      .array(
        z
          .object({
            value: z.string(),
            display: z.string().optional(),
            type: z.string().optional(),
            $ref: z.string().optional(),
          })
          .passthrough()
      )
      .max(1000)
      .optional(),
  })
  .passthrough();

/**
 * SCIM PatchOp request body (RFC 7644 §3.5.2). The thin zod gate enforces
 * Operations is a non-empty array and each entry has an `op` string — the
 * full per-op semantic validation lives inside `applyScimPatch`, which
 * carries any rejection back through a `ScimPatchApplyError` envelope.
 */
const scimPatchSchema = z
  .object({
    schemas: z.array(z.string()).optional(),
    Operations: z
      .array(
        z
          .object({
            op: z.string().min(1),
            path: z.string().optional(),
            value: z.unknown().optional(),
          })
          .passthrough()
      )
      .min(1),
  })
  .passthrough();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  let ctx;
  try {
    ctx = await requireScimBearer(request);
  } catch (e) {
    if (e instanceof ScimAuthError) return e.response;
    throw e;
  }

  const { id } = await params;

  try {
    const resource = await getScimGroupById(id, ctx);
    return scimResponse(resource, { status: 200 });
  } catch (e) {
    if (e instanceof ScimNotFoundError) {
      return scimError(404, null, e.message);
    }
    console.error("[scim/Groups/:id] GET failed:", e);
    return scimError(500, null, "Internal server error");
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  let ctx;
  try {
    ctx = await requireScimBearer(request);
  } catch (e) {
    if (e instanceof ScimAuthError) return e.response;
    throw e;
  }

  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return scimError(400, "invalidSyntax", "Request body is not valid JSON");
  }

  const parsed = scimGroupBodySchema.safeParse(raw);
  if (!parsed.success) {
    return scimError(
      400,
      "invalidSyntax",
      parsed.error.issues[0]?.message ?? "Invalid request body"
    );
  }

  try {
    const result = await putScimGroup(
      id,
      parsed.data as Parameters<typeof putScimGroup>[1],
      ctx
    );
    return scimResponse(result.resource, { status: 200 });
  } catch (e) {
    if (e instanceof ScimNotFoundError) {
      return scimError(404, null, e.message);
    }
    if (e instanceof ScimValidationError) {
      return e.response;
    }
    if (e instanceof ScimUniquenessError) {
      return scimError(409, "uniqueness", e.message);
    }
    if (
      isUniqueConstraintError(e)
    ) {
      return scimError(
        409,
        "uniqueness",
        "displayName or externalId already exists"
      );
    }
    console.error("[scim/Groups/:id] PUT failed:", e);
    return scimError(500, null, "Internal server error");
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  let ctx;
  try {
    ctx = await requireScimBearer(request);
  } catch (e) {
    if (e instanceof ScimAuthError) return e.response;
    throw e;
  }

  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return scimError(400, "invalidSyntax", "Request body is not valid JSON");
  }

  const parsed = scimPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return scimError(
      400,
      "invalidSyntax",
      parsed.error.issues[0]?.message ?? "Invalid request body"
    );
  }

  try {
    const result = await patchScimGroup(
      id,
      parsed.data as Parameters<typeof patchScimGroup>[1],
      ctx
    );
    return scimResponse(result.resource, { status: 200 });
  } catch (e) {
    if (e instanceof ScimNotFoundError) {
      return scimError(404, null, e.message);
    }
    if (e instanceof ScimPatchApplyError) {
      return e.response;
    }
    if (e instanceof ScimValidationError) {
      return e.response;
    }
    if (e instanceof ScimUniquenessError) {
      return scimError(409, "uniqueness", e.message);
    }
    if (
      isUniqueConstraintError(e)
    ) {
      return scimError(
        409,
        "uniqueness",
        "displayName or externalId already exists"
      );
    }
    console.error("[scim/Groups/:id] PATCH failed:", e);
    return scimError(500, null, "Internal server error");
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  let ctx;
  try {
    ctx = await requireScimBearer(request);
  } catch (e) {
    if (e instanceof ScimAuthError) return e.response;
    throw e;
  }

  const { id } = await params;

  try {
    await deleteScimGroup(id, ctx);
    return new NextResponse(null, {
      status: 204,
      headers: { "Content-Type": SCIM_CONTENT_TYPE },
    });
  } catch (e) {
    if (e instanceof ScimNotFoundError) {
      return scimError(404, null, e.message);
    }
    console.error("[scim/Groups/:id] DELETE failed:", e);
    return scimError(500, null, "Internal server error");
  }
}

export async function POST(): Promise<NextResponse> {
  return scimError(405, null, "Method not supported");
}
