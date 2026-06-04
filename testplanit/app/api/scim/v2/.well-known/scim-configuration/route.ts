/**
 * GET /scim/v2/.well-known/scim-configuration — endpoint pointer probe.
 *
 * Returns the three absolute URLs an IdP needs to bootstrap discovery
 * (ServiceProviderConfig, Schemas, ResourceTypes). The URLs are derived from
 * `NEXTAUTH_URL` via `getScimBaseUrl`; request-host headers are never read
 * (a spoofed host would otherwise poison the URLs handed back to the IdP).
 *
 * Non-GET methods return a 405 SCIM error envelope.
 */

import { NextResponse } from "next/server";

import { SCIM_CONTENT_TYPE } from "~/lib/scim/constants";
import { scimError } from "~/lib/scim/errors";
import { getScimBaseUrl } from "~/lib/scim/responses";

export async function GET(): Promise<NextResponse> {
  const base = getScimBaseUrl();
  const body = {
    serviceProviderConfig: `${base}/scim/v2/ServiceProviderConfig`,
    schemas: `${base}/scim/v2/Schemas`,
    resourceTypes: `${base}/scim/v2/ResourceTypes`,
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
