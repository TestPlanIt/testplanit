/**
 * SCIM 2.0 Users resource route — RFC 7644 §3.4.1 / §3.5.1 / §3.5.2 / §3.6.
 *
 *   GET    /scim/v2/Users/{id}  — retrieve one User
 *   PUT    /scim/v2/Users/{id}  — full replace
 *   PATCH  /scim/v2/Users/{id}  — partial modify (RFC 7644 §3.5.2 PatchOp body)
 *   DELETE /scim/v2/Users/{id}  — soft-delete (204 No Content, tombstoned)
 *   POST   /scim/v2/Users/{id}  — 405 (POST only valid on the collection)
 *
 * Every handler runs the SCIM bearer middleware first, validates the inbound
 * body where applicable with a zod schema that passthroughs the SCIM extension
 * URN keys, delegates to the service layer for transaction-owning business
 * logic, and maps the service's typed error classes onto the shared
 * `scimError` envelope. DELETE returns 204 with `Content-Type:
 * application/scim+json` explicitly set so IdPs can confirm the SCIM
 * surface even on an empty body.
 */
import { Prisma } from "@prisma/client";
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
  deleteScimUser,
  getScimUserById,
  patchScimUser,
  putScimUser,
} from "~/lib/scim/services/users";

/**
 * Inbound SCIM User body shape for PUT (and POST, on the collection sibling
 * route). `.passthrough()` keeps URN-keyed enterprise extension blobs intact
 * for the service mapper to round-trip.
 */
const scimUserBodySchema = z
  .object({
    schemas: z.array(z.string()).optional(),
    userName: z.string().min(1),
    externalId: z.string().nullable().optional(),
    name: z
      .object({
        formatted: z.string().optional(),
        givenName: z.string().nullable().optional(),
        familyName: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
    emails: z
      .array(
        z
          .object({
            value: z.string(),
            primary: z.boolean().optional(),
            type: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
    active: z.boolean().optional(),
    password: z.string().optional(),
  })
  .passthrough();

/**
 * SCIM PatchOp request body (RFC 7644 §3.5.2). The thin zod gate here only
 * enforces that `Operations` exists, is non-empty, and that every entry has
 * an `op` string — the full per-op semantic validation lives inside the
 * `applyScimPatch` wrapper, which carries any rejection back through a
 * `ScimPatchApplyError` envelope.
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
    const resource = await getScimUserById(id, ctx);
    return scimResponse(resource, { status: 200 });
  } catch (e) {
    if (e instanceof ScimNotFoundError) {
      return scimError(404, null, e.message);
    }
    console.error("[scim/Users/:id] GET failed:", e);
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

  const parsed = scimUserBodySchema.safeParse(raw);
  if (!parsed.success) {
    return scimError(
      400,
      "invalidSyntax",
      parsed.error.issues[0]?.message ?? "Invalid request body"
    );
  }

  try {
    const result = await putScimUser(id, parsed.data, ctx);
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
      typeof Prisma?.PrismaClientKnownRequestError === "function" &&
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return scimError(409, "uniqueness", "userName already exists");
    }
    console.error("[scim/Users/:id] PUT failed:", e);
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
    const result = await patchScimUser(id, parsed.data, ctx);
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
      typeof Prisma?.PrismaClientKnownRequestError === "function" &&
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return scimError(409, "uniqueness", "userName already exists");
    }
    console.error("[scim/Users/:id] PATCH failed:", e);
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
    await deleteScimUser(id, ctx);
    return new NextResponse(null, {
      status: 204,
      headers: { "Content-Type": SCIM_CONTENT_TYPE },
    });
  } catch (e) {
    if (e instanceof ScimNotFoundError) {
      return scimError(404, null, e.message);
    }
    console.error("[scim/Users/:id] DELETE failed:", e);
    return scimError(500, null, "Internal server error");
  }
}

export async function POST(): Promise<NextResponse> {
  return scimError(405, null, "Method not supported");
}
