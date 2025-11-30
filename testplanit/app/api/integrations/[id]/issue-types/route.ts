import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "~/server/auth";
import { IntegrationManager } from "@/lib/integrations/IntegrationManager";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const integrationId = id;

    // Get the integration
    const integration = await prisma.integration.findUnique({
      where: {
        id: parseInt(integrationId),
        status: "ACTIVE",
      },
    });

    if (!integration) {
      return NextResponse.json(
        { error: "Integration not found or inactive" },
        { status: 404 }
      );
    }

    // For OAuth2 integrations, check user auth
    if (integration.authType === "OAUTH2") {
      const userAuth = await prisma.userIntegrationAuth.findFirst({
        where: {
          userId: session.user.id,
          integrationId: parseInt(integrationId),
          isActive: true,
        },
      });

      if (!userAuth) {
        return NextResponse.json(
          { error: "User authentication required" },
          { status: 401 }
        );
      }
    }

    // Get projectKey from query params or from saved config
    const { searchParams } = new URL(request.url);
    let projectKey = searchParams.get("projectKey");

    // If projectKey not provided in query, try to get it from saved config
    if (!projectKey) {
      const projectIntegration = await prisma.projectIntegration.findFirst({
        where: {
          integrationId: parseInt(integrationId),
          isActive: true,
        },
      });

      if (!projectIntegration) {
        return NextResponse.json(
          { error: "No active project integration found" },
          { status: 404 }
        );
      }

      const config = projectIntegration.config as Record<string, any> | null;
      projectKey = config?.externalProjectKey || config?.externalProjectId || null;
    }

    if (!projectKey) {
      return NextResponse.json(
        { error: "No external project configured" },
        { status: 400 }
      );
    }

    // Initialize adapter through IntegrationManager
    const manager = IntegrationManager.getInstance();
    const adapter = await manager.getAdapter(integrationId);

    if (!adapter) {
      return NextResponse.json(
        { error: "Failed to initialize integration adapter" },
        { status: 500 }
      );
    }

    // Get issue types for the project
    // Some integrations (like GitHub) don't have issue types - return empty array
    if (!adapter.getIssueTypes) {
      return NextResponse.json({ issueTypes: [] });
    }
    const issueTypes = await adapter.getIssueTypes(projectKey);

    return NextResponse.json({ issueTypes });
  } catch (error) {
    console.error("Error fetching issue types:", error);
    return NextResponse.json(
      { error: "Failed to fetch issue types" },
      { status: 500 }
    );
  }
}