import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { getEnhancedDb } from "@/lib/auth/utils";

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

    // If it's an API key integration, it's already authenticated at the integration level
    if (integration.authType === "API_KEY") {
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

    if (!userAuth) {
      return NextResponse.json(
        { error: "No authentication found" },
        { status: 401 }
      );
    }

    // Check if token is expired
    if (userAuth.tokenExpiresAt && userAuth.tokenExpiresAt < new Date()) {
      return NextResponse.json({ error: "Token expired" }, { status: 401 });
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
