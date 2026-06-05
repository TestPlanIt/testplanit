/**
 * GET /scim/v2/ServiceProviderConfig — RFC 7644 §4 capability document.
 *
 * Returns the static SCIM Service Provider Configuration describing which
 * protocol features this server supports. IdPs (Okta, Entra, etc.) fetch this
 * endpoint during initial wiring to render their attribute-mapping UI and to
 * decide which sync operations to attempt.
 *
 * Non-GET methods return a 405 SCIM error envelope.
 */

import { NextRequest, NextResponse } from "next/server";

import { ScimAuthError, requireScimBearer } from "~/lib/scim/auth";
import { SCIM_SCHEMAS, SCIM_CONTENT_TYPE } from "~/lib/scim/constants";
import { scimError } from "~/lib/scim/errors";
import { scimLocation } from "~/lib/scim/responses";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireScimBearer(request);
  } catch (e) {
    if (e instanceof ScimAuthError) return e.response;
    throw e;
  }

  const body = {
    schemas: [SCIM_SCHEMAS.SERVICE_PROVIDER_CONFIG],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "OAuth Bearer Token",
        description:
          "Authentication via tps_ prefixed bearer tokens minted by an admin",
        specUri: "https://www.rfc-editor.org/rfc/rfc6750",
        primary: true,
      },
    ],
    meta: {
      resourceType: "ServiceProviderConfig",
      location: scimLocation("ServiceProviderConfig"),
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
