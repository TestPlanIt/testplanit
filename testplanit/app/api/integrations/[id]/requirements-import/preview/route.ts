import { baseDb } from "@/lib/db";
import { getEnhancedDb } from "@/lib/auth/utils";
import { syncService } from "@/lib/integrations/services/SyncService";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
import {
  effectiveRequirementTypeIds,
  readRequirementTypeConfig,
} from "~/lib/integrations/requirementTypeConfig";
import { authOptions } from "~/server/auth";

/**
 * Windowless, type-scoped count probe (D-07's consent prompt). Approximates
 * how many tracker issues of the project's CONFIGURED requirement types
 * exist, before importing anything. Project-admin gated — this action lives
 * in the Requirement Types section, not the generic Import Issues surface,
 * so it uses that section's stricter admin gate
 * (`authorizeProjectAdminForProject`), never the weaker any-project-member
 * tier the generic import trigger/preview routes use.
 *
 * Gate order, fixed (copied from requirements-config/route.ts, not
 * re-derived): 401 session -> 400 integration id -> 400 payload shape -> 403
 * admin -> 404 mapping. Payload validation deliberately precedes the admin
 * check so a malformed body can't be used to probe project-admin status;
 * the mapping lookup deliberately follows the admin check so a 404 never
 * discloses a mapping's existence to a caller who failed the 403.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // Binds the caller's OWN authorized projectId to the addressed
    // integrationId + integrationProjectId in one query, so a project admin
    // for project A can never aim this at project B's mapping.
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

    const cfg = readRequirementTypeConfig(mapping.projectIntegration.config);
    const issueTypeIds = effectiveRequirementTypeIds(cfg);
    if (issueTypeIds.length === 0) {
      // Distinguishes "nothing configured" from "nothing matches" for
      // 28-07's offer-on-save caller — no tracker round trip either way.
      return NextResponse.json({ matched: 0, hasMore: false, enabled: false });
    }

    // Enhanced (policy) client so the adapter resolves the acting user's own
    // integration auth token for the live search, mirroring the generic
    // import preview.
    const db = await getEnhancedDb(session);
    const preview = await syncService.previewProjectImport(
      integrationId,
      integrationProjectId,
      { issueTypeIds },
      { dbClient: db }
    );

    return NextResponse.json(preview);
  } catch (error: any) {
    console.error("Error previewing requirements import:", error);
    return NextResponse.json(
      { error: error.message || "Failed to preview requirements import" },
      { status: 500 }
    );
  }
}
