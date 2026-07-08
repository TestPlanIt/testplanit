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
      const kind = kindParam as "RELEASE" | "ITERATION" | undefined;

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

      const mapping = await baseDb.integrationProject.findFirst({
        where: { id: projectMappingId, isActive: true },
        select: { externalProjectKey: true },
      });
      if (!mapping) {
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

      const result = await adapter.getExternalMilestones({
        projectKey: mapping.externalProjectKey,
        ...(kind ? { kind } : {}),
        includeClosed,
        ...(pageToken ? { pageToken } : {}),
      });

      return NextResponse.json(result);
    } catch (error: any) {
      console.error("Error previewing milestone sync:", error);
      return NextResponse.json(
        { error: error.message || "Internal server error" },
        { status: 500 }
      );
    }
  }
);
