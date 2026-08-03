import { getEnhancedDb } from "@/lib/auth/utils";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "~/server/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getEnhancedDb(session);
    const { id } = await params;
    const integrationId = parseInt(id);

    // First, get the integration to check its auth type
    const integration = await db.integration.findUnique({
      where: { id: integrationId },
    });

    if (!integration) {
      return NextResponse.json(
        { error: "Integration not found" },
        { status: 404 }
      );
    }

    // If it's an API key or PAT integration, it's already authenticated at the integration level
    if (
      integration.authType === "API_KEY" ||
      integration.authType === "PERSONAL_ACCESS_TOKEN"
    ) {
      return NextResponse.json({ authenticated: true });
    }

    // For OAuth integrations, check if user has authentication
    const userAuth = await db.userIntegrationAuth.findFirst({
      where: {
        userId: session.user.id,
        integrationId,
        isActive: true,
      },
    });

    // URL the client opens to (re)authorize this integration as the current
    // user. Consumers open it in a popup, so the callback should land on the
    // auth-complete page every signed-in user can view.
    const authUrl = `/api/integrations/oauth/${integration.provider.toLowerCase()}/auth?integrationId=${integrationId}&returnUrl=${encodeURIComponent("/integrations/auth-complete")}`;

    if (!userAuth) {
      return NextResponse.json(
        { error: "No authentication found", authUrl },
        { status: 401 }
      );
    }

    // If the access token has expired, it can be transparently refreshed on
    // first use when a refresh token is on record. Treat that as authenticated
    // here and let the adapter refresh when the request is actually made. Only
    // prompt for re-authorization when there is no refresh token to fall back on.
    if (userAuth.tokenExpiresAt && userAuth.tokenExpiresAt < new Date()) {
      if (userAuth.refreshToken) {
        return NextResponse.json({ authenticated: true });
      }
      return NextResponse.json(
        { error: "Token expired", authUrl },
        { status: 401 }
      );
    }

    return NextResponse.json({ authenticated: true });
  } catch (error) {
    console.error("Error checking authentication:", error);
    return NextResponse.json(
      { error: "Failed to check authentication" },
      { status: 500 }
    );
  }
}
