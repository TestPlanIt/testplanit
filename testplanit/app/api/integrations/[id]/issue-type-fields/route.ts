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
    
    // Get issueTypeId from query params
    const { searchParams } = new URL(request.url);
    const issueTypeId = searchParams.get("issueTypeId");
    
    if (!issueTypeId) {
      return NextResponse.json(
        { error: "Issue type ID is required" },
        { status: 400 }
      );
    }

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

    // Get issue type fields
    if (!adapter.getIssueTypeFields) {
      return NextResponse.json(
        { error: "This integration does not support fetching issue type fields" },
        { status: 400 }
      );
    }
    const fields = await adapter.getIssueTypeFields(projectKey, issueTypeId);

    return NextResponse.json({ fields });
  } catch (error) {
    console.error("Error fetching issue type fields:", error);
    return NextResponse.json(
      { error: "Failed to fetch issue type fields" },
      { status: 500 }
    );
  }
}