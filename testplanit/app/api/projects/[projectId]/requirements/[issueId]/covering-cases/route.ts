import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { baseDb } from "~/lib/db";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import {
  getRequirementCoveringCases,
  type RequirementCoveringCase,
} from "~/lib/services/requirementCoverage";
import { authOptions } from "~/server/auth";

export type RequirementCoveringCaseRow = RequirementCoveringCase & {
  direct: boolean;
};

export type RequirementCoveringCasesResponse = {
  requirementId: number;
  cases: RequirementCoveringCaseRow[];
};

/**
 * GET /api/projects/[projectId]/requirements/[issueId]/covering-cases
 *
 * 26-03 extended `getRequirementCoveringCases` to carry each covering
 * case's latest result — this route is that extension's first production
 * caller, mirroring the path shape of Phase 25's four sibling requirement
 * routes (reparent, delete-subtree, restore, detach).
 *
 * Read-only, so it is gated with `resolveViewerProjectScope` rather than
 * `authorizeProjectAdminForProject` — a project-admin gate on a read would
 * hide the drill-down from every regular member. One requirement per
 * request, by deliberate scope decision: no batch endpoint, no client-
 * supplied `rootIds` list.
 *
 * Gate order, fixed: 401 (no session) -> 400 (non-integer project or
 * issue id) -> 403 (viewer's project scope excludes the project) -> 404
 * (addressed id is not a live requirement in this project) -> 200/500.
 * Deliberately NOT gated on `Projects.requirementsEnabled` — see
 * 26-VALIDATION.md carve-out 4.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; issueId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId: projectIdParam, issueId: issueIdParam } = await params;
    const projectId = Number(projectIdParam);
    const issueId = Number(issueIdParam);
    if (!Number.isInteger(projectId) || !Number.isInteger(issueId)) {
      return NextResponse.json(
        { error: "Invalid project or issue ID" },
        { status: 400 }
      );
    }

    // The same resolved scope is used for this gate AND passed to the
    // service below as accessibleProjectIds — one value, two uses, so the
    // gate and the drill-down can never disagree about what the viewer
    // may see. `null` means unrestricted (ADMIN).
    const scope = await resolveViewerProjectScope(session.user.id);
    if (scope !== null && !scope.includes(projectId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // `Issue`'s model policy has no project scoping at all, so this
    // pre-check — bound to projectId, isDeleted: false, and spread with
    // REQUIREMENT_SCOPE_WHERE — is the only thing stopping a crafted
    // issueId from aiming this route at a defect row or at another
    // project's requirement. Run after the 403 gate above so a caller who
    // cannot reach the project at all never learns whether a given id
    // exists.
    const existing = await baseDb.issue.findFirst({
      where: {
        id: issueId,
        projectId,
        isDeleted: false,
        ...REQUIREMENT_SCOPE_WHERE,
      },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Requirement not found" },
        { status: 404 }
      );
    }

    const covering = await getRequirementCoveringCases(projectId, [issueId], {
      accessibleProjectIds: scope,
    });
    // Absence is the normal, expected result for a requirement with no
    // covering cases — not an error, not "still loading."
    const cases = covering.get(issueId) ?? [];

    // The panel that sits above this drill-down in the UI lists DIRECT
    // `RepositoryCaseIssue` links only, and offers unlink on each one.
    // `getRequirementCoveringCases` returns the SUBTREE superset — every
    // case reachable through this requirement or any descendant beneath
    // it. Those are two different sets: a row that reaches this
    // requirement only through a descendant is not in the direct-links
    // set at all, and cannot be unlinked from here. Decorating every row
    // with `direct` is what lets a read-only consumer of the superset
    // tell the two sets apart, instead of rendering an unlink control
    // that either does nothing or unlinks from the wrong requirement.
    const direct = await baseDb.repositoryCaseIssue.findMany({
      where: { issueId },
      select: { caseId: true },
    });
    const directCaseIds = new Set(direct.map((row) => row.caseId));

    const response: RequirementCoveringCasesResponse = {
      requirementId: issueId,
      cases: cases.map((row) => ({
        ...row,
        direct: directCaseIds.has(row.caseId),
      })),
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
    console.error("Requirement covering-cases error:", error);
    return NextResponse.json(
      { error: "Failed to fetch requirement covering cases" },
      { status: 500 }
    );
  }
}
