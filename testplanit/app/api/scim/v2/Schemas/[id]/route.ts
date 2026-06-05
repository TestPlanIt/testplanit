/**
 * GET /scim/v2/Schemas/{id} — RFC 7644 §4 schema discovery by URN.
 *
 * Returns the RFC 7643 schema document for one of the three advertised URNs
 * (core User, core Group, enterprise User extension) with a fresh meta block
 * injected at request time. Unknown URNs return the RFC 7644 §3.12 error
 * envelope with status 404 and scimType omitted.
 *
 * Non-GET methods return a 405 SCIM error envelope.
 */

import { NextRequest, NextResponse } from "next/server";

import { ScimAuthError, requireScimBearer } from "~/lib/scim/auth";
import { SCIM_CONTENT_TYPE, SCIM_SCHEMAS } from "~/lib/scim/constants";
import { scimError } from "~/lib/scim/errors";
import { scimLocation } from "~/lib/scim/responses";
import enterpriseSchema from "~/lib/scim/schemas/enterprise.json";
import groupSchema from "~/lib/scim/schemas/group.json";
import userSchema from "~/lib/scim/schemas/user.json";

const URN_TO_SCHEMA: Record<string, unknown> = {
  [SCIM_SCHEMAS.CORE_USER]: userSchema,
  [SCIM_SCHEMAS.CORE_GROUP]: groupSchema,
  [SCIM_SCHEMAS.ENTERPRISE_USER]: enterpriseSchema,
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireScimBearer(request);
  } catch (e) {
    if (e instanceof ScimAuthError) return e.response;
    throw e;
  }

  const { id } = await params;

  const schema = URN_TO_SCHEMA[id];
  if (!schema) {
    return scimError(404, null, "Schema not found");
  }

  const body = {
    ...(schema as Record<string, unknown>),
    meta: {
      resourceType: "Schema",
      location: scimLocation("Schemas", id),
    },
  };

  return NextResponse.json(body, {
    status: 200,
    headers: {
      "Content-Type": SCIM_CONTENT_TYPE,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(): Promise<NextResponse> {
  return scimError(405, null, "Method not supported");
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
