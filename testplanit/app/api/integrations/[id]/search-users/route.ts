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
    const integrationId = parseInt(id);
    const query = request.nextUrl.searchParams.get("query") || "";
    const projectKey = request.nextUrl.searchParams.get("projectKey") || undefined;
    const startAt = parseInt(request.nextUrl.searchParams.get("startAt") || "0");
    const maxResults = parseInt(request.nextUrl.searchParams.get("maxResults") || "50");

    const integration = await prisma.integration.findUnique({
      where: {
        id: integrationId,
        status: "ACTIVE",
      },
    });

    if (!integration) {
      return NextResponse.json(
        { error: "Integration not found" },
        { status: 404 }
      );
    }

    // Initialize adapter through IntegrationManager
    const manager = IntegrationManager.getInstance();
    const adapter = await manager.getAdapter(integrationId.toString());

    if (!adapter) {
      return NextResponse.json(
        { error: "Failed to initialize integration adapter" },
        { status: 500 }
      );
    }

    // For Jira, search users
    if (integration.provider === "JIRA" && adapter.searchUsers) {
      const result = await adapter.searchUsers(query, projectKey, startAt, maxResults);
      // Handle both old format (array) and new format (object with users and total)
      if (Array.isArray(result)) {
        return NextResponse.json({ users: result, total: result.length });
      }
      return NextResponse.json(result);
    }

    return NextResponse.json({ users: [] });
  } catch (error) {
    console.error("Error searching users:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to search users" },
      { status: 500 }
    );
  }
}