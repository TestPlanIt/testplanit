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

    // Optional scoping: `?requirementIds=1,2,3` returns the rollup for just
    // those requirements (each still computed over its OWN whole subtree, so
    // a scoped breakdown is identical to the one the whole-project response
    // carries for the same id). Without it the response stays exactly what
    // it has always been -- every requirement in the project.
    //
    // This is the drill-down caller `getRequirementCoverage`'s own `rootIds`
    // option was built for. It exists because the whole-project rollup is
    // genuinely large: on an 11,000-requirement project it is ~2.4MB and
    // ~2s, which is the right cost for a list that renders a chip per row
    // and entirely the wrong one for a single requirement's detail page.
    const requirementIdsParam = request.nextUrl.searchParams.get(
      "requirementIds"
    );
    let rootIds: number[] | undefined;
    if (requirementIdsParam !== null) {
      const parsed = requirementIdsParam
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value !== "")
        .map(Number);
      if (parsed.some((id) => !Number.isInteger(id) || id <= 0)) {
        return NextResponse.json(
          { error: "requirementIds must be positive integers" },
          { status: 400 }
        );
      }
      // An explicitly empty list is not the same as an absent parameter:
      // absent means "the whole project", empty means "nothing was asked
      // for". Kept as `[]` so the service's own short-circuit answers it,
      // rather than silently widening to a whole-project scan.
      rootIds = parsed;
    }

    const coverage = await getRequirementCoverage(
      projectId,
      { accessibleProjectIds: scope },
      rootIds === undefined ? undefined : { rootIds }
    );

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
