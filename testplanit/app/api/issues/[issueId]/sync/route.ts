import { syncService } from "@/lib/integrations/services/SyncService";
import { baseDb } from "@/lib/db";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { authOptions } from "~/server/auth";

export const POST = withAuditContext(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ issueId: string }> }
  ) => {
    try {
      const session = await getServerSession(authOptions);

      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { issueId: issueIdParam } = await params;
      const issueId = parseInt(issueIdParam);
      if (isNaN(issueId)) {
        return NextResponse.json(
          { error: "Invalid issue ID" },
          { status: 400 }
        );
      }

      // Fetch the issue to get integration and external ID
      const issue = await baseDb.issue.findUnique({
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
            error: "Issue does not have an external integration or external ID",
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

      // SIMPLE_URL integrations have no API to pull from — sync is not supported
      if (issue.integration.provider === "SIMPLE_URL") {
        return NextResponse.json(
          {
            error: "Sync is not supported for Simple URL integrations",
          },
          { status: 400 }
        );
      }

      // Trigger context controls the freshness gate inside performIssueRefresh.
      // `manual` forces a fresh fetch (user explicitly clicked Sync).
      // `hover` allows a 5-minute cache so opening the same issue popover
      //   in two tabs / refreshing the table doesn't hammer the upstream API.
      // Unknown / missing values default to `manual` (safe — always sync).
      const triggerParam = req.nextUrl.searchParams.get("trigger");
      const minFreshnessSeconds =
        triggerParam === "hover" ? 300 : 0; /* manual / default */

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
        issue.externalId,
        { minFreshnessSeconds }
      );

      if (!result.success) {
        return NextResponse.json(
          { error: result.error || "Failed to sync issue" },
          { status: 500 }
        );
      }

      // If the freshness gate or per-issue lock short-circuited the sync,
      // surface that to the caller so the UI can avoid a redundant refetch.
      if (result.cached || result.locked) {
        return NextResponse.json({
          success: true,
          cached: result.cached ?? false,
          locked: result.locked ?? false,
          message: result.cached
            ? "Issue is already fresh; skipped upstream sync"
            : "A sync is already in progress for this issue",
        });
      }

      // Fetch the updated issue
      const updatedIssue = await baseDb.issue.findUnique({
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
);
