import { baseDb } from "@/lib/db";
import { IntegrationManager } from "@/lib/integrations/IntegrationManager";
import { toExternalIssueDetails } from "@/lib/integrations/issueDetails";
import { syncService } from "@/lib/integrations/services/SyncService";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "~/server/auth";

/**
 * Live details of one issue from its tracker, in the same shape whatever the
 * provider, for the hover popovers. `issueKey` is the key the issue is
 * stored under; a GitHub key without its repository is resolved from the
 * stored issue the same way a manual sync resolves it.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const issueKey = searchParams.get("issueKey");
    const integrationIdParam = searchParams.get("integrationId");
    const integrationId = Number(integrationIdParam);

    if (!issueKey || !integrationIdParam || !Number.isInteger(integrationId)) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    const integration = await baseDb.integration.findUnique({
      where: { id: integrationId, status: "ACTIVE" },
      select: { id: true, provider: true },
    });
    if (!integration) {
      return NextResponse.json(
        { error: "Integration not found or not active" },
        { status: 404 }
      );
    }

    const adapter = await IntegrationManager.getInstance().getAdapter(
      String(integrationId)
    );
    if (!adapter) {
      return NextResponse.json(
        { error: "Integration not found or not active" },
        { status: 404 }
      );
    }

    let issueRef = issueKey;
    if (integration.provider === "GITHUB") {
      try {
        issueRef = await syncService._resolveGitHubIssueIdForSync(
          baseDb,
          integrationId,
          issueKey
        );
      } catch {
        issueRef = issueKey;
      }
    }

    const issue = await adapter.getIssue(issueRef);
    return NextResponse.json(
      toExternalIssueDetails(issue, integration.provider)
    );
  } catch (error: any) {
    console.error("Error fetching issue details:", error);

    if (
      error.message?.includes("401") ||
      error.message?.includes("Unauthorized")
    ) {
      return NextResponse.json(
        {
          error: "Authentication failed. Please check integration credentials.",
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: error.message || "Failed to fetch issue details" },
      { status: 500 }
    );
  }
}
