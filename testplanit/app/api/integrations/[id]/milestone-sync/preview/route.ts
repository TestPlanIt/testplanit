import { baseDb } from "@/lib/db";
import { integrationManager } from "@/lib/integrations/IntegrationManager";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { authorizeProjectMilestoneSyncAdmin } from "~/lib/integrations/importAuthorization";
import { authOptions } from "~/server/auth";

const VALID_KINDS = new Set(["RELEASE", "ITERATION"]);

/**
 * Live preview of a tracker's external milestones (Jira Fix Versions /
 * Sprints, or the provider's equivalent) for a linked project. No DB write,
 * no queue — purely a pass-through to the credentialed adapter so the
 * import picker (17-06) can show what's available before anything is
 * imported. Project-ADMIN gated (T-17-05-01).
 */
export const GET = withAuditContext(
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

      const { searchParams } = req.nextUrl;
      const projectMappingId = searchParams.get("projectMappingId");
      if (!projectMappingId) {
        return NextResponse.json(
          { error: "projectMappingId is required" },
          { status: 400 }
        );
      }

      const kindParam = searchParams.get("kind");
      if (kindParam && !VALID_KINDS.has(kindParam)) {
        return NextResponse.json(
          { error: "kind must be RELEASE or ITERATION" },
          { status: 400 }
        );
      }
      let kind = (kindParam ?? undefined) as
        | "RELEASE"
        | "ITERATION"
        | undefined;

      const includeClosed = searchParams.get("includeClosed") === "true";
      const pageToken = searchParams.get("pageToken") ?? undefined;

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

      // When the caller doesn't ask for a specific kind, constrain the
      // preview to the kinds this project has enabled in its milestone-sync
      // settings — an admin who unchecked Sprints should not see (or pay
      // the board-discovery cost for) sprint fetches in the picker. Config
      // absent or both kinds enabled ⇒ unconstrained, matching old behavior.
      if (!kind) {
        const projectIntegration = await baseDb.projectIntegration.findFirst({
          where: {
            projectId: auth.projectId,
            integrationId,
            isActive: true,
          },
          select: { config: true },
        });
        const configuredKinds = (projectIntegration?.config as any)
          ?.milestoneSync?.kinds;
        if (
          Array.isArray(configuredKinds) &&
          configuredKinds.length === 1 &&
          VALID_KINDS.has(configuredKinds[0])
        ) {
          kind = configuredKinds[0] as "RELEASE" | "ITERATION";
        }
      }

      // The caller's mapping id anchors authorization; the preview itself
      // spans EVERY active mapping for this project+integration (a project
      // can map several Jira projects — import/auto-track already union
      // them, so the picker must show the same universe). Each item is
      // annotated with the mapping(s) whose fetch returned it so the
      // dialog can label rows and offer a per-project filter.
      const mappings = await baseDb.integrationProject.findMany({
        where: {
          projectIntegration: { integrationId, projectId: auth.projectId },
          isActive: true,
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          externalProjectKey: true,
          externalProjectName: true,
        },
      });
      if (mappings.length === 0) {
        return NextResponse.json(
          { error: "Integration mapping not found" },
          { status: 404 }
        );
      }

      const adapter = await integrationManager.getAdapter(
        String(integrationId)
      );
      if (!adapter) {
        return NextResponse.json(
          { error: "Integration adapter not available" },
          { status: 500 }
        );
      }
      if (!adapter.getExternalMilestones) {
        return NextResponse.json(
          { error: "This integration does not support milestone sync" },
          { status: 400 }
        );
      }

      const byId = new Map<string, any>();
      const fetchErrors: string[] = [];
      for (const mapping of mappings) {
        const sourceProject = {
          id: mapping.id,
          key: mapping.externalProjectKey,
          name: mapping.externalProjectName || mapping.externalProjectKey,
        };
        try {
          const result = await adapter.getExternalMilestones({
            projectKey: mapping.externalProjectKey,
            ...(kind ? { kind } : {}),
            includeClosed,
            ...(pageToken ? { pageToken } : {}),
          });
          for (const item of result.items) {
            const existing = byId.get(item.id);
            if (existing) {
              // Same artifact under multiple mappings (shared sprint
              // boards) — record every source so project filtering
              // matches either.
              existing.sourceProjects.push(sourceProject);
            } else {
              byId.set(item.id, { ...item, sourceProjects: [sourceProject] });
            }
          }
        } catch (error: any) {
          fetchErrors.push(
            `${sourceProject.key}: ${error?.message ?? "fetch failed"}`
          );
        }
      }

      // Every mapping failed ⇒ a real connectivity/credential problem the
      // admin must see; partial failure degrades gracefully.
      if (byId.size === 0 && fetchErrors.length === mappings.length) {
        return NextResponse.json({ error: fetchErrors[0] }, { status: 500 });
      }

      return NextResponse.json({
        items: Array.from(byId.values()),
        hasMore: false,
        ...(fetchErrors.length > 0 ? { warnings: fetchErrors } : {}),
      });
    } catch (error: any) {
      console.error("Error previewing milestone sync:", error);
      return NextResponse.json(
        { error: error.message || "Internal server error" },
        { status: 500 }
      );
    }
  }
);
