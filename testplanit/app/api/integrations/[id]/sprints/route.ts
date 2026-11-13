import { IntegrationManager } from "@/lib/integrations/IntegrationManager";
import { baseDb } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "~/server/auth";

/**
 * GET /api/integrations/[id]/sprints?projectKey=
 *
 * The open (active and future) sprints on the project's boards — the only
 * sprints Jira lets a new issue be created into.
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

    const projectKey = request.nextUrl.searchParams.get("projectKey");
    if (!projectKey) {
      return NextResponse.json(
        { error: "projectKey is required" },
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

    if (integration.authType === "OAUTH2") {
      const userAuth = await baseDb.userIntegrationAuth.findFirst({
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

    const adapter = await IntegrationManager.getInstance().getAdapter(
      String(integrationId)
    );
    if (!adapter) {
      return NextResponse.json(
        { error: "Failed to initialize integration adapter" },
        { status: 500 }
      );
    }
    if (!adapter.getExternalMilestones) {
      return NextResponse.json({ sprints: [] });
    }

    const { items } = await adapter.getExternalMilestones({
      projectKey,
      kind: "ITERATION",
      includeClosed: false,
    });

    const sprints = items
      .filter((item) => item.kind === "ITERATION" && item.state !== "CLOSED")
      .sort(
        (a, b) =>
          (a.state === "ACTIVE" ? 0 : 1) - (b.state === "ACTIVE" ? 0 : 1)
      )
      .map((item) => ({ id: item.id, name: item.name, state: item.state }));

    return NextResponse.json({ sprints });
  } catch (error) {
    console.error("Error fetching sprints:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch sprints",
      },
      { status: 500 }
    );
  }
}
