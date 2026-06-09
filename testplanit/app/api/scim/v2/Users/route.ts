/**
 * SCIM 2.0 Users collection route — RFC 7644 §3.3 / §3.4.2.
 *
 *   POST   /scim/v2/Users  — create or JIT-bind a User
 *   GET    /scim/v2/Users  — list Users (filter / startIndex / count)
 *   PUT    /scim/v2/Users  — 405 (operates on individual resource only)
 *   PATCH  /scim/v2/Users  — 405
 *   DELETE /scim/v2/Users  — 405
 *
 * The route layer is intentionally thin: every handler runs the SCIM bearer
 * middleware first, validates the inbound body shape with a zod schema that
 * passes through the SCIM extension URN keys, delegates to the service layer
 * for the transaction-owning business logic, and maps the service's typed
 * error classes onto the shared `scimError` envelope. All error responses
 * carry `Content-Type: application/scim+json` so IdPs can confidently parse
 * the §3.12 error envelope.
 */
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

import { ScimAuthError, requireScimBearer } from "~/lib/scim/auth";
import {
  SCIM_CONTENT_TYPE,
  SCIM_LIST_RESPONSE_SCHEMA_URN,
} from "~/lib/scim/constants";
import { scimError } from "~/lib/scim/errors";
import { InvalidFilterError } from "~/lib/scim/filter";
import { scimResponse } from "~/lib/scim/responses";
import {
  ScimUniquenessError,
  ScimValidationError,
  createScimUser,
  listScimUsers,
} from "~/lib/scim/services/users";

/**
 * Defense-in-depth cap on the raw filter string. The filter translator already
 * rejects unsupported operators, but a 1MB filter would still walk the parser
 * before the rejection — the route cuts it off before any work happens.
 */
const MAX_FILTER_LENGTH = 1024;

/**
 * SCIM User create / replace body. `.passthrough()` on the top-level object
 * preserves URN-keyed enterprise extension blobs so the service mapper can
 * round-trip them. The nested `name` and `emails` shapes also passthrough so
 * IdPs sending extra attributes (e.g. `name.honorificPrefix`) do not get
 * rejected at the route layer.
 */
const scimUserBodySchema = z
  .object({
    schemas: z.array(z.string()).optional(),
    userName: z.string().min(1),
    externalId: z.string().optional(),
    name: z
      .object({
        formatted: z.string().optional(),
        givenName: z.string().optional(),
        familyName: z.string().optional(),
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  let ctx;
  try {
    ctx = await requireScimBearer(request);
  } catch (e) {
    if (e instanceof ScimAuthError) return e.response;
    throw e;
  }

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
    const result = await createScimUser(parsed.data, ctx);
    return scimResponse(result.resource, {
      status: result.linked ? 200 : 201,
    });
  } catch (e) {
    if (e instanceof ScimUniquenessError) {
      return scimError(409, "uniqueness", e.message);
    }
    if (e instanceof ScimValidationError) {
      return e.response;
    }
    if (
      typeof Prisma?.PrismaClientKnownRequestError === "function" &&
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return scimError(409, "uniqueness", "userName already exists");
    }
    console.error("[scim/Users] POST failed:", e);
    return scimError(500, null, "Internal server error");
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  let ctx;
  try {
    ctx = await requireScimBearer(request);
  } catch (e) {
    if (e instanceof ScimAuthError) return e.response;
    throw e;
  }

  const url = new URL(request.url);
  const rawFilter = url.searchParams.get("filter");
  const rawStartIndex = url.searchParams.get("startIndex");
  const rawCount = url.searchParams.get("count");

  if (rawFilter !== null && rawFilter.length > MAX_FILTER_LENGTH) {
    return scimError(400, "invalidFilter", "Filter exceeds maximum length");
  }

  const startIndex = rawStartIndex
    ? Math.max(1, parseInt(rawStartIndex, 10) || 1)
    : 1;
  const count = rawCount !== null ? parseInt(rawCount, 10) : undefined;

  try {
    const result = await listScimUsers(
      {
        filter: rawFilter ?? undefined,
        startIndex,
        count: Number.isFinite(count) ? (count as number) : undefined,
      },
      ctx
    );
    return NextResponse.json(
      {
        schemas: [SCIM_LIST_RESPONSE_SCHEMA_URN],
        totalResults: result.totalResults,
        itemsPerPage: result.resources.length,
        startIndex,
        Resources: result.resources,
      },
      {
        status: 200,
        headers: { "Content-Type": SCIM_CONTENT_TYPE },
      }
    );
  } catch (e) {
    if (e instanceof InvalidFilterError) {
      return scimError(400, "invalidFilter", e.message);
    }
    console.error("[scim/Users] GET failed:", e);
    return scimError(500, null, "Internal server error");
  }
}

export async function PUT(): Promise<NextResponse> {
  return scimError(405, null, "Method not supported");
}

export async function PATCH(): Promise<NextResponse> {
  return scimError(405, null, "Method not supported");
}

export async function DELETE(): Promise<NextResponse> {
  return scimError(405, null, "Method not supported");
}
