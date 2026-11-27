import { IntegrationManager } from "@/lib/integrations/IntegrationManager";
import { baseDb } from "@/lib/db";
import {
  oauthReauthorizeUrl,
  reauthorizationBody,
} from "~/lib/integrations/errors";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "~/server/auth";

export async function GET(
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
    const integrationId = parseInt(id);
    const query = request.nextUrl.searchParams.get("query") || "";
    const projectKey =
      request.nextUrl.searchParams.get("projectKey") || undefined;
    const startAt = parseInt(
      request.nextUrl.searchParams.get("startAt") || "0"
    );
    const maxResults = parseInt(
      request.nextUrl.searchParams.get("maxResults") || "50"
    );

    const integration = await baseDb.integration.findUnique({
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

    provider = integration.provider;

    // An OAuth caller searches with their own authorization when they have
    // one; a caller without one borrows the integration's newest.
    let adapterUserId: string | undefined;
    if (integration.authType === "OAUTH2") {
      const ownAuth = await baseDb.userIntegrationAuth.findFirst({
        where: { userId: session.user.id, integrationId, isActive: true },
        select: { id: true },
      });
      if (ownAuth) {
        adapterUserId = session.user.id;
        authUrl = oauthReauthorizeUrl(provider, integrationId);
      }
    }

    // Initialize adapter through IntegrationManager
    const manager = IntegrationManager.getInstance();
    const adapter = await manager.getAdapter(
      integrationId.toString(),
      undefined,
      adapterUserId
    );

    if (!adapter) {
      return NextResponse.json(
        { error: "Failed to initialize integration adapter" },
        { status: 500 }
      );
    }

    // Adapters that can look users up on the tracker answer the search;
    // the rest have no directory to offer.
    if (adapter.searchUsers) {
      const result = await adapter.searchUsers(
        query,
        projectKey,
        startAt,
        maxResults
      );
      // Handle both old format (array) and new format (object with users and total)
      if (Array.isArray(result)) {
        return NextResponse.json({ users: result, total: result.length });
      }
      return NextResponse.json(result);
    }

    return NextResponse.json({ users: [] });
  } catch (error) {
    console.error("Error searching users:", error);
    const reauthorization = reauthorizationBody(error, provider, authUrl);
    if (reauthorization) {
      return NextResponse.json(reauthorization, { status: 401 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to search users",
      },
      { status: 500 }
    );
  }
}
