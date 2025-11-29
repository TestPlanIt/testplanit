import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { syncService } from "@/lib/integrations/services/SyncService";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ issueId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { issueId: issueIdParam } = await params;
    const issueId = parseInt(issueIdParam);
    if (isNaN(issueId)) {
      return NextResponse.json({ error: "Invalid issue ID" }, { status: 400 });
    }

    // Fetch the issue to get integration and external ID
    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      include: {
        integration: true,
      },
    });

    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    if (!issue.integrationId || !issue.externalId) {
      return NextResponse.json(
        {
          error:
            "Issue does not have an external integration or external ID",
        },
        { status: 400 }
      );
    }

    // Check if the integration supports syncing
    if (!issue.integration) {
      return NextResponse.json(
        { error: "Integration not found" },
        { status: 404 }
      );
    }

    // Queue the sync job
    const jobId = await syncService.queueIssueRefresh(
      session.user.id,
      issue.integrationId,
      issue.externalId
    );

    if (!jobId) {
      return NextResponse.json(
        { error: "Failed to queue sync job" },
        { status: 500 }
      );
    }

    // Perform the sync immediately (could also be done via worker)
    const result = await syncService.performIssueRefresh(
      session.user.id,
      issue.integrationId,
      issue.externalId
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to sync issue" },
        { status: 500 }
      );
    }

    // Fetch the updated issue
    const updatedIssue = await prisma.issue.findUnique({
      where: { id: issueId },
      include: {
        integration: {
          select: {
            id: true,
            name: true,
            provider: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
            iconUrl: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      issue: updatedIssue,
      message: "Issue synced successfully",
    });
  } catch (error: any) {
    console.error("Error syncing issue:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
