import { baseDb } from "@/lib/db";
import {
  SYNC_STATUS,
  syncService,
} from "@/lib/integrations/services/SyncService";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
import {
  effectiveRequirementTypeIds,
  readRequirementTypeConfig,
} from "~/lib/integrations/requirementTypeConfig";
import { authOptions } from "~/server/auth";

/**
 * Start a background, typed, paged-to-completion import (D-07) of the
 * project's CONFIGURED requirement types from one linked external project.
 * Project-admin gated, mirroring requirements-config/route.ts's stricter
 * gate — never the weaker any-project-member tier the generic import
 * trigger route uses, since this action lives in the Requirement Types
 * section and moves the same class of mass, tracker-scale data as flipping
 * classification does.
 *
 * Gate order, fixed: 401 session -> 400 integration id -> 400 payload shape
 * -> 403 admin -> 404 mapping -> 409 (already running) -> 400 (nothing
 * configured) -> enqueue.
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
        select: {
          id: true,
          syncStatus: true,
          projectIntegration: { select: { config: true } },
        },
      });
      if (!mapping) {
        return NextResponse.json(
          { error: "Integration project mapping not found" },
          { status: 404 }
        );
      }

      // One import per mapping at a time: a second paged-to-completion walk
      // against the same tracker project would fight the first over the
      // same syncStatus cell and double the tracker request rate.
      if (
        mapping.syncStatus === SYNC_STATUS.syncing ||
        mapping.syncStatus === SYNC_STATUS.cancelRequested
      ) {
        return NextResponse.json(
          { error: "An import is already running for this mapping" },
          { status: 409 }
        );
      }

      const cfg = readRequirementTypeConfig(mapping.projectIntegration.config);
      const issueTypeIds = effectiveRequirementTypeIds(cfg);
      if (issueTypeIds.length === 0) {
        return NextResponse.json(
          {
            error:
              "No requirement types are configured for this project. Configure the Requirement Types section before importing.",
          },
          { status: 400 }
        );
      }

      const jobId = await syncService.queueProjectImport(
        session.user.id,
        integrationId,
        integrationProjectId,
        { issueTypeIds, pagedToCompletion: true }
      );

      if (!jobId) {
        return NextResponse.json(
          { error: "Failed to queue import job" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        jobId,
        message:
          "Import job queued. Issues will be imported in the background.",
      });
    } catch (error: any) {
      console.error("Error queuing requirements import:", error);
      return NextResponse.json(
        { error: error.message || "Internal server error" },
        { status: 500 }
      );
    }
  }
);
