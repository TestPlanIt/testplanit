/**
 * GET /scim/v2/ResourceTypes — RFC 7643 §6 resource-type discovery.
 *
 * Returns a SCIM ListResponse wrapping exactly two ResourceType entries: User
 * and Group. Each entry advertises its endpoint, the core schema URN it maps
 * to, and any schema extensions IdPs can attach (the enterprise User extension
 * is advertised on the User resource type with required: false).
 *
 * The two-element resources array is inlined in this handler (no helper, no
 * DB read); a future iteration can swap to dynamic enumeration once
 * `schemaExtensions` actually contains URN-prefixed keys.
 *
 * Non-GET methods return a 405 SCIM error envelope.
 */

import { NextRequest, NextResponse } from "next/server";

import { ScimAuthError, requireScimBearer } from "~/lib/scim/auth";
import { SCIM_CONTENT_TYPE, SCIM_SCHEMAS } from "~/lib/scim/constants";
import { scimError } from "~/lib/scim/errors";
import { scimLocation } from "~/lib/scim/responses";
import {
  withPrimaryRequestRouting,
  withRequestRouting,
} from "~/lib/db/requestRouting";

async function handleGET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireScimBearer(request);
  } catch (e) {
    if (e instanceof ScimAuthError) return e.response;
    throw e;
  }

  const resources = [
    {
      schemas: [SCIM_SCHEMAS.RESOURCE_TYPE],
      id: "User",
      name: "User",
      endpoint: "/Users",
      description: "User Account",
      schema: SCIM_SCHEMAS.CORE_USER,
      schemaExtensions: [
        {
          schema: SCIM_SCHEMAS.ENTERPRISE_USER,
          required: false,
        },
      ],
      meta: {
        resourceType: "ResourceType",
        location: scimLocation("ResourceTypes", "User"),
      },
    },
    {
      schemas: [SCIM_SCHEMAS.RESOURCE_TYPE],
      id: "Group",
      name: "Group",
      endpoint: "/Groups",
      description: "Group",
      schema: SCIM_SCHEMAS.CORE_GROUP,
      schemaExtensions: [],
      meta: {
        resourceType: "ResourceType",
        location: scimLocation("ResourceTypes", "Group"),
      },
    },
  ];

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

export const GET = withPrimaryRequestRouting(handleGET);

async function handlePOST(): Promise<NextResponse> {
  return scimError(405, null, "Method not supported");
}

export const POST = withRequestRouting(handlePOST);

async function handlePUT(): Promise<NextResponse> {
  return scimError(405, null, "Method not supported");
}

export const PUT = withRequestRouting(handlePUT);

async function handlePATCH(): Promise<NextResponse> {
  return scimError(405, null, "Method not supported");
}

export const PATCH = withRequestRouting(handlePATCH);

async function handleDELETE(): Promise<NextResponse> {
  return scimError(405, null, "Method not supported");
}

export const DELETE = withRequestRouting(handleDELETE);
