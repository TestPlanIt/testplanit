import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { resolveViewerProjectScope } from "~/lib/authContext";
import {
  getRequirementCoverage,
  type RequirementCoverageBreakdown,
} from "~/lib/services/requirementCoverage";
import { authOptions } from "~/server/auth";

export type RequirementCoverageResponse = {
  projectId: number;
  coverage: Record<string, RequirementCoverageBreakdown>;
};

/**
 * GET /api/projects/[projectId]/requirements/coverage
 *
 * First production caller of `getRequirementCoverage` (shipped Phase 24,
 * zero callers until now). Whole-project, read-only, by deliberate scope
 * decision — no `rootIds` query parameter. The tree already loads every
 * requirement in one query, and a per-node request would be strictly
 * worse while introducing the `MAX_ROOT_IDS` failure mode for no gain.
 *
 * This project prefers ZenStack generated hooks and permits a route for
 * server-side logic beyond CRUD; `getRequirementCoverage` is a `WITH
 * RECURSIVE` kysely CTE over `baseDb` with no model to generate a hook
 * from, and the whole Milestone family (`summary`, `burndown`,
 * `members/coverage`, `export`) made the identical call for the
 * identical reason.
 *
 * Gate order, fixed: 401 (no session) -> 400 (non-numeric project id) ->
 * 403 (viewer's project scope excludes the requested project) ->
 * 200/500. Deliberately NOT gated on `Projects.requirementsEnabled` —
 * that flag is a presentation opt-in, not an access-control boundary
 * (see 26-VALIDATION.md carve-out 4); the security boundary here is the
 * session check plus the project-scope check below.
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
    // service as accessibleProjectIds below — one value, two uses, so the
    // gate and the aggregation can never disagree about what the viewer
    // may see. `null` means unrestricted (ADMIN).
    const scope = await resolveViewerProjectScope(session.user.id);
    if (scope !== null && !scope.includes(projectId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const coverage = await getRequirementCoverage(projectId, {
      accessibleProjectIds: scope,
    });

    // `NextResponse.json` on a raw `Map` produces `{}` with a 200 and no
    // error anywhere — the Milestone analogue this route was modelled on
    // returns a `Record`, so copying it without noticing the difference
    // ships a silently empty response. `Object.fromEntries` is what
    // defends against that. The keys become STRINGS in the process, so
    // the client indexes with `String(id)`. Each breakdown now also
    // carries `statuses[]` / `untested` (the same shape CoverageChip
    // reads) and `directCaseCount` / `directCrossProjectCaseCount` — all
    // four ride this same `Object.fromEntries` with no route change.
    const response: RequirementCoverageResponse = {
      projectId,
      coverage: Object.fromEntries(coverage),
    };

    return NextResponse.json(response);
  } catch (error) {
    if (
      error instanceof RangeError ||
      (error instanceof Error &&
        error.message.includes("projectId must be an integer"))
    ) {
      return NextResponse.json(
        { error: "Invalid request" },
        { status: 400 }
      );
    }
    console.error("Requirement coverage error:", error);
    return NextResponse.json(
      { error: "Failed to fetch requirement coverage" },
      { status: 500 }
    );
  }
}
