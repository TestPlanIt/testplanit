import { IntegrationManager } from "@/lib/integrations/IntegrationManager";
import type { CreateIssueMetadata } from "@/lib/integrations/adapters/IssueAdapter";
import { baseDb } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "~/server/auth";

const EMPTY_METADATA: CreateIssueMetadata = {
  labels: [],
  milestones: [],
  assignees: [],
  issueTypes: [],
};

/**
 * GET /api/integrations/[id]/create-metadata?projectKey=
 *
 * The labels, milestones, assignable users and issue types the create
 * form can offer for one tracker project. Trackers that take none of
 * these answer with empty lists.
 */
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
    const integrationId = parseInt(id);
    if (Number.isNaN(integrationId)) {
      return NextResponse.json(
        { error: "Invalid integration id" },
        { status: 400 }
      );
    }

    const integration = await baseDb.integration.findUnique({
      where: { id: integrationId, status: "ACTIVE" },
    });
    if (!integration) {
      return NextResponse.json(
        { error: "Integration not found or inactive" },
        { status: 404 }
      );
    }

    let userAuth: { id: string } | null = null;
    if (integration.authType === "OAUTH2") {
      userAuth = await baseDb.userIntegrationAuth.findFirst({
        where: {
          userId: session.user.id,
          integrationId,
          isActive: true,
        },
        select: { id: true },
      });
      if (!userAuth) {
        return NextResponse.json(
          { error: "User authentication required" },
          { status: 401 }
        );
      }
    }

    let projectKey = request.nextUrl.searchParams.get("projectKey");
    if (!projectKey) {
      const projectIntegration = await baseDb.projectIntegration.findFirst({
        where: { integrationId, isActive: true },
      });
      const config = projectIntegration?.config as Record<string, any> | null;
      projectKey =
        config?.externalProjectKey || config?.externalProjectId || null;
    }
    if (!projectKey) {
      return NextResponse.json(
        { error: "projectKey is required" },
        { status: 400 }
      );
    }

    const manager = IntegrationManager.getInstance();
    const adapter = await manager.getAdapter(
      String(integrationId),
      undefined,
      userAuth ? session.user.id : undefined
    );
    if (!adapter) {
      return NextResponse.json(
        { error: "Failed to initialize integration adapter" },
        { status: 500 }
      );
    }

    if (!adapter.getCreateIssueMetadata) {
      return NextResponse.json(EMPTY_METADATA);
    }

    const metadata = await adapter.getCreateIssueMetadata(projectKey);
    return NextResponse.json(metadata);
  } catch (error) {
    console.error("Error fetching create-issue metadata:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch create-issue metadata",
      },
      { status: 500 }
    );
  }
}
