import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { AuthenticationService } from "~/lib/integrations/AuthenticationService";
import { IntegrationManager } from "~/lib/integrations/IntegrationManager";
import { getEnhancedDb } from "@/lib/auth/utils";
import { prisma } from "~/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    // Check if user is authenticated
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get integration ID from query params
    const integrationId = request.nextUrl.searchParams.get("integrationId");
    if (!integrationId) {
      return NextResponse.json(
        { error: "Integration ID is required" },
        { status: 400 }
      );
    }

    // Get enhanced Prisma client for the user
    const db = await getEnhancedDb(session);

    // Verify the integration exists and user has access
    const integration = await db.integration.findUnique({
      where: { id: parseInt(integrationId) },
    });

    if (!integration) {
      return NextResponse.json(
        { error: "Integration not found" },
        { status: 404 }
      );
    }

    if (integration.provider !== "JIRA") {
      return NextResponse.json(
        { error: "Invalid integration type" },
        { status: 400 }
      );
    }

    // Get the Jira adapter
    const manager = IntegrationManager.getInstance();
    const adapter = await manager.getAdapter(integrationId);

    if (!adapter) {
      return NextResponse.json(
        { error: "Failed to initialize adapter" },
        { status: 500 }
      );
    }

    // Generate state token and store it
    const state = AuthenticationService.generateState();
    await AuthenticationService.storeOAuthState(
      session.user.id,
      integration.id,
      state
    );

    // Get the authorization URL
    const authUrl = adapter.getAuthorizationUrl!(state);

    // Redirect to Jira's authorization URL
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error("Error in Jira auth endpoint:", error);
    return NextResponse.json(
      { error: "Failed to initiate OAuth flow" },
      { status: 500 }
    );
  }
}
