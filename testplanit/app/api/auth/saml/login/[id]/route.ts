import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/auth/saml/login/[id]
 *
 * Initiates SAML login by redirecting to the SAML initiation handler.
 * The signin page navigates here with the provider ID in the URL path.
 * This handler extracts the ID and delegates to /api/auth/saml?provider={id}.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const searchParams = request.nextUrl.searchParams;
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  // Redirect to the SAML initiation handler with the provider ID as a query param
  const samlUrl = new URL("/api/auth/saml", request.url);
  samlUrl.searchParams.set("provider", id);
  samlUrl.searchParams.set("callbackUrl", callbackUrl);

  return NextResponse.redirect(samlUrl);
}
