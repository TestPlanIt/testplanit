import { getSyncQueue } from "@/lib/queues";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { enqueueWithAuditContext } from "~/lib/auditContextEnqueue";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { authorizeProjectMilestoneSyncAdmin } from "~/lib/integrations/importAuthorization";
import { milestoneSyncService } from "~/lib/integrations/services/MilestoneSyncService";
import type { SyncJobData } from "~/lib/integrations/services/SyncService";
import { authOptions } from "~/server/auth";

/**
 * "Sync now" for milestones — gate-0 (manual) / gate-300 (hover/page-load)
 * freshness, mirroring `app/api/issues/[issueId]/sync/route.ts`.
 *
 * Two shapes, both project-ADMIN gated (T-17-05-01):
 *   - body.externalId present  -> single milestone refresh, performed
 *     immediately (mirrors the issue "Sync now" UX — the caller wants the
 *     result inline).
 *   - body.externalId absent   -> project-level PASSIVE refresh (Blocker 3):
 *     enqueues ONE `sync-milestones` job covering every synced milestone in
 *     the project, so a page-load calling this on mount doesn't fire N
 *     requests for N milestones.
 */
export const POST = withAuditContext(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { id } = await params;
      const integrationId = parseInt(id);
      if (isNaN(integrationId)) {
        return NextResponse.json(
          { error: "Invalid integration ID" },
          { status: 400 }
        );
      }

      const body = await req.json().catch(() => ({}));
      const projectMappingId = body?.projectMappingId;
      if (!projectMappingId || typeof projectMappingId !== "string") {
        return NextResponse.json(
          { error: "projectMappingId is required" },
          { status: 400 }
        );
      }

      const externalId = body?.externalId;
      if (externalId !== undefined && typeof externalId !== "string") {
        return NextResponse.json(
          { error: "externalId must be a string" },
          { status: 400 }
        );
      }

      const auth = await authorizeProjectMilestoneSyncAdmin(
        session,
        integrationId,
        projectMappingId
      );
      if (!auth.ok) {
        return NextResponse.json(
          { error: auth.error },
          { status: auth.status }
        );
      }

      // Trigger context controls the freshness gate.
      // `manual` forces a fresh fetch (user explicitly clicked Sync).
      // `hover` allows a 5-minute cache (page-load passive refresh).
      const triggerParam = req.nextUrl.searchParams.get("trigger");
      const minFreshnessSeconds = triggerParam === "hover" ? 300 : 0;

      if (externalId) {
        const result = await milestoneSyncService.performMilestoneRefresh(
          session.user.id,
          integrationId,
          externalId,
          { minFreshnessSeconds }
        );

        if (!result.success) {
          return NextResponse.json(
            { error: result.error || "Failed to sync milestone" },
            { status: 500 }
          );
        }

        if (result.cached || result.locked) {
          return NextResponse.json({
            success: true,
            cached: result.cached ?? false,
            locked: result.locked ?? false,
            message: result.cached
              ? "Milestone is already fresh; skipped upstream sync"
              : "A sync is already in progress for this milestone",
          });
        }

        return NextResponse.json({
          success: true,
          message: "Milestone synced successfully",
        });
      }

      // Project-level bulk refresh — one request instead of N.
      const syncQueue = getSyncQueue();
      if (!syncQueue) {
        return NextResponse.json(
          { error: "Sync queue not available" },
          { status: 500 }
        );
      }

      const jobData: SyncJobData = {
        userId: session.user.id,
        integrationId,
        projectId: String(auth.projectId),
        action: "sync",
        data: { minFreshnessSeconds },
      };

      await enqueueWithAuditContext(syncQueue, "sync-milestones", jobData, {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: false,
      });

      return NextResponse.json({ queued: true });
    } catch (error: any) {
      console.error("Error syncing milestones:", error);
      return NextResponse.json(
        { error: error.message || "Internal server error" },
        { status: 500 }
      );
    }
  }
);
