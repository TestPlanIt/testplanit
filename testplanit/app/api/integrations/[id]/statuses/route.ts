import { IntegrationManager } from "@/lib/integrations/IntegrationManager";
import { baseDb } from "@/lib/db";
import { FIXED_TRACKER_STATUSES } from "@/lib/integrations/fixedTrackerStatuses";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "~/server/auth";

/**
 * The statuses an issue tracker uses, from its adapter: a project's workflow
 * statuses where the tracker defines them per project (`projectKey`), its
 * global list, or the fixed states of trackers that only open and close.
 * A tracker that can't list statuses returns an empty list.
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
    const integrationId = Number(id);
    if (!Number.isInteger(integrationId)) {
      return NextResponse.json(
        { error: "Integration not found or inactive" },
        { status: 404 }
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

    // Fixed states need no tracker call, so no credentials either.
    const fixed = FIXED_TRACKER_STATUSES[integration.provider];
    if (fixed) {
      return NextResponse.json({ statuses: fixed });
    }

    if (integration.authType === "OAUTH2") {
      const userAuth = await baseDb.userIntegrationAuth.findFirst({
        where: {
          userId: session.user.id,
          integrationId,
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

    const adapter = await IntegrationManager.getInstance().getAdapter(
      String(integrationId)
    );
    if (!adapter) {
      return NextResponse.json(
        { error: "Failed to initialize integration adapter" },
        { status: 500 }
      );
    }
    if (!adapter.getStatuses) {
      return NextResponse.json({ statuses: [] });
    }

    const projectKey =
      new URL(request.url).searchParams.get("projectKey") || undefined;
    const statuses = await adapter.getStatuses(projectKey);
    return NextResponse.json({ statuses });
  } catch (error) {
    console.error("Error fetching statuses:", error);
    return NextResponse.json(
      { error: "Failed to fetch statuses" },
      { status: 500 }
    );
  }
}
