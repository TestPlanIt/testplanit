/**
 * SCIM 2.0 Groups collection route — RFC 7644 §3.3 / §3.4.2.
 *
 *   POST   /scim/v2/Groups  — create or JIT-bind a Group
 *   GET    /scim/v2/Groups  — list Groups (filter / startIndex / count)
 *   PUT    /scim/v2/Groups  — 405 (operates on individual resource only)
 *   PATCH  /scim/v2/Groups  — 405
 *   DELETE /scim/v2/Groups  — 405
 *
 * Every handler runs the SCIM bearer middleware first, validates the inbound
 * body shape with a zod schema that passes through URN-prefixed extension
 * keys, delegates to the service layer for the transaction-owning business
 * logic, and maps the service's typed error classes onto the shared
 * `scimError` envelope. All error responses carry `Content-Type:
 * application/scim+json` so IdPs can confidently parse the §3.12 envelope.
 */
import { isUniqueConstraintError } from "~/lib/utils/errors";
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
  createScimGroup,
  listScimGroups,
} from "~/lib/scim/services/groups";

/**
 * Defense-in-depth cap on the raw filter string. The filter translator
 * rejects unsupported operators, but a 1MB filter would still walk the
 * parser before the rejection — the route cuts it off before any work
 * happens.
 */
const MAX_FILTER_LENGTH = 1024;

/**
 * Inbound SCIM Group body shape for POST. `.passthrough()` on the top-level
 * object preserves URN-keyed enterprise extension blobs so the service
 * mapper can round-trip them.
 */
const scimGroupBodySchema = z
  .object({
    schemas: z.array(z.string()).optional(),
    displayName: z.string().min(1),
    externalId: z.string().optional(),
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

  const parsed = scimGroupBodySchema.safeParse(raw);
  if (!parsed.success) {
    return scimError(
      400,
      "invalidSyntax",
      parsed.error.issues[0]?.message ?? "Invalid request body"
    );
  }

  try {
    const result = await createScimGroup(
      parsed.data as Parameters<typeof createScimGroup>[0],
      ctx
    );
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
    if (isUniqueConstraintError(e)) {
      return scimError(
        409,
        "uniqueness",
        "displayName or externalId already exists"
      );
    }
    console.error("[scim/Groups] POST failed:", e);
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
    const result = await listScimGroups(
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
    console.error("[scim/Groups] GET failed:", e);
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
