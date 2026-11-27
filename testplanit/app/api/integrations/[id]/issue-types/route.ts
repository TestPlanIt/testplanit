import { IntegrationManager } from "@/lib/integrations/IntegrationManager";
import { baseDb } from "@/lib/db";
import {
  oauthReauthorizeUrl,
  reauthorizationBody,
} from "~/lib/integrations/errors";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "~/server/auth";
import { withRequestRouting } from "~/lib/db/requestRouting";

async function handleGET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let provider = "";
  let authUrl: string | undefined;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const integrationId = id;

    // Get the integration
    const integration = await baseDb.integration.findUnique({
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

    provider = integration.provider;

    // For OAuth2 integrations, check user auth
    if (integration.authType === "OAUTH2") {
      authUrl = oauthReauthorizeUrl(provider, integrationId);
      const userAuth = await baseDb.userIntegrationAuth.findFirst({
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
      const projectIntegration = await baseDb.projectIntegration.findFirst({
        where: {
          integrationId: parseInt(integrationId),
          isActive: true,
        },
      });

      if (projectIntegration) {
        const config = projectIntegration.config as Record<string, any> | null;
        projectKey =
          config?.externalProjectKey ||
          config?.externalProjectId ||
          config?.projectPath ||
          null;
      }
    }

    // Initialize adapter through IntegrationManager
    const manager = IntegrationManager.getInstance();
    const adapter = await manager.getAdapter(
      integrationId,
      undefined,
      integration.authType === "OAUTH2" ? session.user.id : undefined
    );

    if (!adapter) {
      return NextResponse.json(
        { error: "Failed to initialize integration adapter" },
        { status: 500 }
      );
    }

    // Some integrations don't have issue types - return empty array
    if (!adapter.getIssueTypes) {
      return NextResponse.json({ issueTypes: [] });
    }

    // Pass projectKey (may be empty string for adapters with static type lists)
    const issueTypes = await adapter.getIssueTypes(projectKey ?? "");

    return NextResponse.json({ issueTypes });
  } catch (error) {
    console.error("Error fetching issue types:", error);
    const reauthorization = reauthorizationBody(error, provider, authUrl);
    if (reauthorization) {
      return NextResponse.json(reauthorization, { status: 401 });
    }
    return NextResponse.json(
      { error: "Failed to fetch issue types" },
      { status: 500 }
    );
  }
}

export const GET = withRequestRouting(handleGET);
