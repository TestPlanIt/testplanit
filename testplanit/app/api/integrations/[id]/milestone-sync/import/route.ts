import { getSyncQueue } from "@/lib/queues";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { enqueueWithAuditContext } from "~/lib/auditContextEnqueue";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { authorizeProjectMilestoneSyncAdmin } from "~/lib/integrations/importAuthorization";
import type { SyncJobData } from "~/lib/integrations/services/SyncService";
import { authOptions } from "~/server/auth";

const VALID_KINDS = new Set(["RELEASE", "ITERATION"]);
const MAX_EXTERNAL_IDS = 500;

/**
 * Enqueue a bulk import of selected external milestones (Jira Fix
 * Versions / Sprints) as local Milestones shells. Project-ADMIN gated
 * (T-17-05-01); the resolved projectId (never a client-supplied one) is
 * threaded into the job so the worker cannot be tricked into writing to a
 * different project than the one the caller was authorized against.
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

      const externalIds = body?.externalIds;
      if (
        !Array.isArray(externalIds) ||
        externalIds.length === 0 ||
        externalIds.length > MAX_EXTERNAL_IDS ||
        !externalIds.every((v) => typeof v === "string")
      ) {
        return NextResponse.json(
          {
            error: `externalIds must be a non-empty array of strings (max ${MAX_EXTERNAL_IDS})`,
          },
          { status: 400 }
        );
      }

      let kinds: Array<"RELEASE" | "ITERATION"> | undefined;
      if (body?.kinds !== undefined) {
        if (
          !Array.isArray(body.kinds) ||
          !body.kinds.every((k: unknown) => VALID_KINDS.has(k as string))
        ) {
          return NextResponse.json(
            { error: "kinds must be an array of RELEASE/ITERATION" },
            { status: 400 }
          );
        }
        kinds = body.kinds;
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
        data: { externalIds, kinds },
      };

      await enqueueWithAuditContext(syncQueue, "import-milestones", jobData, {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: false,
      });

      return NextResponse.json({ queued: true }, { status: 202 });
    } catch (error: any) {
      console.error("Error queuing milestone import:", error);
      return NextResponse.json(
        { error: error.message || "Internal server error" },
        { status: 500 }
      );
    }
  }
);
