import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { loadRequirementTraceability } from "~/lib/services/requirementTraceability";
import { authOptions } from "~/server/auth";

export type { RequirementTraceabilityData } from "~/lib/services/requirementTraceability";

/**
 * GET /api/projects/[projectId]/requirements/traceability
 *
 * COV-04's data layer, first production caller of
 * `loadRequirementTraceability` (26-08). The PDF exporter (26-10) and the
 * gaps/traceability reports (26-11/26-12) all read through this same
 * loader — this route is the transport for the PDF path; the reports
 * call the loader directly server-side.
 *
 * Gate order, fixed: 401 (no session) -> 400 (non-numeric project id) ->
 * 403 (viewer's project scope excludes the requested project) ->
 * 200/500. Deliberately NOT gated on `Projects.requirementsEnabled` —
 * that flag is a presentation opt-in, not an access-control boundary
 * (see 26-VALIDATION.md carve-out 4).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId: projectIdParam } = await params;
    const projectId = Number(projectIdParam);
    if (!Number.isInteger(projectId)) {
      return NextResponse.json(
        { error: "Invalid project ID" },
        { status: 400 }
      );
    }

    // The same resolved scope is used for this gate AND passed to the
    // loader as accessibleProjectIds below — one value, two uses, so the
    // gate and the loaded matrix can never disagree about what the
    // viewer may see. `null` means unrestricted (ADMIN).
    const scope = await resolveViewerProjectScope(session.user.id);
    if (scope !== null && !scope.includes(projectId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const data = await loadRequirementTraceability(projectId, {
      accessibleProjectIds: scope,
    });

    return NextResponse.json(data);
  } catch (error) {
    if (
      error instanceof RangeError ||
      (error instanceof Error &&
        error.message.includes("projectId must be an integer"))
    ) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    console.error("Requirement traceability error:", error);
    return NextResponse.json(
      { error: "Failed to load requirement traceability" },
      { status: 500 }
    );
  }
}
