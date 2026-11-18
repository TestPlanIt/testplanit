/**
 * GET /api/scim/v2/.well-known/scim-configuration — endpoint pointer probe.
 *
 * Returns the three absolute URLs an IdP needs to bootstrap discovery
 * (ServiceProviderConfig, Schemas, ResourceTypes). The URLs are derived from
 * `NEXTAUTH_URL` via `getScimBaseUrl`; request-host headers are never read
 * (a spoofed host would otherwise poison the URLs handed back to the IdP).
 *
 * Non-GET methods return a 405 SCIM error envelope.
 */

import { NextRequest, NextResponse } from "next/server";

import { ScimAuthError, requireScimBearer } from "~/lib/scim/auth";
import { SCIM_BASE_PATH, SCIM_CONTENT_TYPE } from "~/lib/scim/constants";
import { scimError } from "~/lib/scim/errors";
import { getScimBaseUrl } from "~/lib/scim/responses";
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

  const base = getScimBaseUrl();
  const body = {
    serviceProviderConfig: `${base}${SCIM_BASE_PATH}/ServiceProviderConfig`,
    schemas: `${base}${SCIM_BASE_PATH}/Schemas`,
    resourceTypes: `${base}${SCIM_BASE_PATH}/ResourceTypes`,
  };

  return NextResponse.json(body, {
    status: 200,
    headers: {
      "Content-Type": SCIM_CONTENT_TYPE,
      "Cache-Control": "no-store",
    },
  });
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
