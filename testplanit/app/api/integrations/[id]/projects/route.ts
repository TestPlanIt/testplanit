import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { getEnhancedDb } from "@/lib/auth/utils";
import { getIntegrationClient } from "~/lib/integrations";

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

    // Get the integration
    const integration = await db.integration.findFirst({
      where: {
        id: integrationId,
        status: "ACTIVE",
        isDeleted: false,
      },
    });

    if (!integration) {
      return NextResponse.json(
        { error: "Integration not found" },
        { status: 404 }
      );
    }

    // For API key integrations, we don't need user-specific auth
    let userAuth = null;
    if (integration.authType === "OAUTH2") {
      // Check if user has authentication for OAuth integrations
      userAuth = await db.userIntegrationAuth.findFirst({
        where: {
          userId: session.user.id,
          integrationId,
          isActive: true,
        },
      });

      if (!userAuth) {
        return NextResponse.json(
          { error: "Authentication required" },
          { status: 401 }
        );
      }
    }

    // Get integration client
    const client = await getIntegrationClient(integration, userAuth);

    // Fetch projects from the integration
    const projects = await client.getProjects();

    return NextResponse.json({ projects });
  } catch (error) {
    console.error("Error fetching integration projects:", error);

    // Check if it's an authentication error from the external API
    if (error instanceof Error &&
        (error.message.includes("401") ||
         error.message.includes("Unauthorized") ||
         error.message.includes("Bad credentials"))) {
      return NextResponse.json(
        { error: "Authentication expired or invalid" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch projects" },
      { status: 500 }
    );
  }
}
