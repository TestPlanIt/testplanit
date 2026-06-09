/**
 * GET /scim/v2/Schemas — RFC 7644 §4 schema discovery.
 *
 * Returns a SCIM ListResponse envelope wrapping the three schema documents this
 * server advertises: the core User and core Group schemas plus the enterprise
 * User extension. Each entry is the full RFC 7643 schema document with a fresh
 * meta block injected at request time (`resourceType: "Schema"`, absolute
 * `location` derived from NEXTAUTH_URL).
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

const SCHEMA_URNS = [
  SCIM_SCHEMAS.CORE_USER,
  SCIM_SCHEMAS.CORE_GROUP,
  SCIM_SCHEMAS.ENTERPRISE_USER,
] as const;

const URN_TO_SCHEMA: Record<(typeof SCHEMA_URNS)[number], unknown> = {
  [SCIM_SCHEMAS.CORE_USER]: userSchema,
  [SCIM_SCHEMAS.CORE_GROUP]: groupSchema,
  [SCIM_SCHEMAS.ENTERPRISE_USER]: enterpriseSchema,
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireScimBearer(request);
  } catch (e) {
    if (e instanceof ScimAuthError) return e.response;
    throw e;
  }

  const resources = SCHEMA_URNS.map((urn) => {
    const schema = URN_TO_SCHEMA[urn] as Record<string, unknown>;
    return {
      ...schema,
      meta: {
        resourceType: "Schema",
        location: scimLocation("Schemas", urn),
      },
    };
  });

  return NextResponse.json(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: resources.length,
      itemsPerPage: resources.length,
      startIndex: 1,
      Resources: resources,
    },
    {
      status: 200,
      headers: {
        "Content-Type": SCIM_CONTENT_TYPE,
        "Cache-Control": "no-store",
      },
    }
  );
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
