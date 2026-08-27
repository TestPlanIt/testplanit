import { baseDb } from "@/lib/db";
import { SYNC_STATUS } from "@/lib/integrations/services/SyncService";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
import { authOptions } from "~/server/auth";

/**
 * Request cooperative cancellation of a running typed import (D-07).
 *
 * What this is: a write of a single flag (`IntegrationProject.syncStatus` ->
 * `SYNC_STATUS.cancelRequested`) that the running import's per-page loop
 * re-reads once per page (up to `IMPORT_PAGE_SIZE` = 50 issues) and honors by
 * stopping cleanly. The stop is bounded by one in-flight page, not
 * immediate — 28-05's paging loop is the mechanism that actually observes
 * this flag; this route only writes it.
 *
 * What this deliberately is NOT: it does not reach for BullMQ's job-removal
 * mechanism (see app/api/admin/queues/[queueName]/jobs/[jobId]/route.ts,
 * action "remove"). That mechanism is system-admin-only, and removing a
 * queued job's record does not stop a worker loop that is already
 * executing — the loop would keep running to completion with no record of
 * ever having been asked to stop. Cooperative cancellation via the
 * syncStatus flag is the only way to actually interrupt an in-flight
 * paged-to-completion walk.
 *
 * Project-admin gated, mirroring requirements-config/route.ts's stricter
 * gate. Gate order, fixed: 401 session -> 400 integration id -> 400 payload
 * shape -> 403 admin -> 404 mapping -> 409 (not currently syncing) -> write.
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

      let body: any;
      try {
        body = await req.json();
      } catch {
        return NextResponse.json(
          { error: "Malformed JSON body" },
          { status: 400 }
        );
      }

      const projectId = body?.projectId;
      if (
        typeof projectId !== "number" ||
        !Number.isFinite(projectId) ||
        !Number.isInteger(projectId) ||
        projectId <= 0
      ) {
        return NextResponse.json(
          { error: "projectId must be a positive integer" },
          { status: 400 }
        );
      }

      const integrationProjectId = body?.integrationProjectId;
      if (!integrationProjectId || typeof integrationProjectId !== "string") {
        return NextResponse.json(
          { error: "integrationProjectId is required" },
          { status: 400 }
        );
      }

      const auth = await authorizeProjectAdminForProject(session, projectId);
      if (!auth.ok) {
        return NextResponse.json(
          { error: auth.error },
          { status: auth.status }
        );
      }

      // Binds the caller's OWN authorized projectId to the addressed
      // integrationId + integrationProjectId in one query, so a project
      // admin for project A can never aim this at project B's mapping.
      const mapping = await baseDb.integrationProject.findFirst({
        where: {
          id: integrationProjectId,
          isActive: true,
          projectIntegration: { projectId, integrationId, isActive: true },
        },
        select: { id: true, syncStatus: true },
      });
      if (!mapping) {
        return NextResponse.json(
          { error: "Integration project mapping not found" },
          { status: 404 }
        );
      }

      // Only a genuinely running import can be cancelled — refusing rather
      // than accepting a no-op cancel avoids overwriting a completed run's
      // terminal state (28-05 proved the service tolerates a late write, but
      // the route should not attempt one), and refusing a second cancel
      // while already cancel-requested avoids a redundant write.
      if (mapping.syncStatus !== SYNC_STATUS.syncing) {
        return NextResponse.json(
          { error: "No running import to cancel for this mapping" },
          { status: 409 }
        );
      }

      await baseDb.integrationProject.update({
        where: { id: mapping.id },
        data: { syncStatus: SYNC_STATUS.cancelRequested },
      });

      return NextResponse.json({ success: true });
    } catch (error: any) {
      console.error("Error cancelling requirements import:", error);
      return NextResponse.json(
        { error: error.message || "Internal server error" },
        { status: 500 }
      );
    }
  }
);
