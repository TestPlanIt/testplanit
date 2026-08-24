import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { resolveViewerProjectScope } from "~/lib/authContext";
import type { RequirementCoverageStatus } from "~/lib/services/requirementCoverage";
import { loadRequirementTraceability } from "~/lib/services/requirementTraceability";
import { toGapRows } from "~/lib/services/requirementTraceabilityExport";
import { authOptions } from "~/server/auth";
import { authorizeReportRequest } from "~/utils/reportApiUtils";

/**
 * Server handler for two report-builder pre-built report types: the
 * requirement coverage gap report (D-2) and the requirement traceability
 * matrix report (D-3/COV-04). Both are the SAME data, viewed twice, via
 * ONE handler and ONE traceability load per request.
 *
 * 1. No SQL lives in this file. The requirement-side raw recursive closure
 *    exists exactly once, in `lib/services/requirementCoverage.ts`'s
 *    `buildClosureFragment`, pinned to a single occurrence by
 *    `issueRoleScope.containment.test.ts`'s role-predicate count. A second
 *    copy here would be a third, independently-drifting definition of
 *    "latest result" — exactly what `lib/services/requirementTraceability.ts`'s
 *    own header comment warns the next caller away from. This module
 *    composes that loader; it does not touch a db client or a query
 *    builder directly.
 * 2. Both variants derive from the ONE `loadRequirementTraceability` call
 *    below. `toGapRows(data.rows)` is literally the null-case subset of
 *    the same matrix rows the traceability variant returns unfiltered —
 *    so the gap report and the matrix can never disagree about what is
 *    uncovered. Calling the loader once per variant (twice total) would
 *    reopen exactly the drift this design exists to remove.
 * 3. No cross-project variant exists here — a deliberate, recorded carve-out
 *    (26-VALIDATION.md carve-out 3), not an oversight. `getRequirementCoverage`
 *    anchors its recursive closure on a single `projectId`; a cross-project
 *    rollup would be a change to that service, not a change to this report
 *    layer, and the phase's binding constraint is to consume the service
 *    as shipped. The accepted cost of adding a cross-project variant later
 *    is touching all six report-registration sites again.
 */

export type RequirementCoverageReportVariant = "gaps" | "traceability";

export interface RequirementCoverageGapReportRow {
  id: number; // Required by DataTable - unique per row
  requirementId: number;
  requirementKey: string;
  requirementTitle: string | null;
  requirementPath: string;
  linkedCases: number; // always 0 for a gap — kept so the column set is uniform
}

export interface RequirementTraceabilityReportRow {
  id: number; // Required by DataTable - unique per row
  requirementId: number;
  requirementKey: string;
  requirementTitle: string | null;
  requirementPath: string;
  testCaseId: number | null; // null => coverage gap row
  testCaseName: string | null;
  caseProjectId: number | null;
  caseProjectName: string | null;
  lastStatusName: string | null; // null => not run
  lastStatusColor: string | null;
  lastExecutedAt: string | null;
  coverageStatus: RequirementCoverageStatus;
}

export async function handleRequirementCoverageReportPOST(
  req: NextRequest,
  variant: RequirementCoverageReportVariant
): Promise<Response> {
  try {
    const body = await req.json();
    const projectId = body?.projectId ? Number(body.projectId) : undefined;

    const authz = await authorizeReportRequest(req, {
      requiresAdmin: false,
      projectId,
    });
    if (!authz.ok) return authz.response;

    if (!projectId) {
      return Response.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }

    // One resolved scope, fed into the one loader call below — never a
    // second, independently-scoped read.
    let accessibleProjectIds: number[] | null;
    if (authz.bypass) {
      // The share-link bypass token IS the authorization for this request
      // — already validated inside authorizeReportRequest before it
      // returned ok, matching every shipped bypass consumer's convention
      // (see app/api/report-builder/iteration-matrix/route.ts). There is
      // no session on this path to resolve a per-user scope from, so
      // cross-project visibility is unrestricted for the request, the
      // same way the share link itself is the sole read grant there.
      accessibleProjectIds = null;
    } else {
      const session = await getServerSession(authOptions);
      accessibleProjectIds = await resolveViewerProjectScope(session!.user.id);
    }

    const data = await loadRequirementTraceability(projectId, {
      accessibleProjectIds,
    });

    if (variant === "gaps") {
      const rows: RequirementCoverageGapReportRow[] = toGapRows(data.rows).map(
        (row, index) => ({
          id: index,
          requirementId: row.requirementId,
          requirementKey: row.requirementKey,
          requirementTitle: row.requirementTitle,
          requirementPath: row.requirementPath,
          linkedCases: row.linkedCaseCount,
        })
      );
      return Response.json({ data: rows, total: rows.length });
    }

    const rows: RequirementTraceabilityReportRow[] = data.rows.map(
      (row, index) => ({
        id: index,
        requirementId: row.requirementId,
        requirementKey: row.requirementKey,
        requirementTitle: row.requirementTitle,
        requirementPath: row.requirementPath,
        testCaseId: row.caseId,
        testCaseName: row.caseName,
        caseProjectId: row.caseProjectId,
        caseProjectName: row.caseProjectName,
        lastStatusName: row.statusName,
        lastStatusColor: row.statusColor,
        lastExecutedAt: row.executedAt,
        coverageStatus: row.coverageStatus,
      })
    );
    return Response.json({ data: rows, total: rows.length });
  } catch (e: unknown) {
    // Deliberately stricter than the shipped issue-test-coverage analog,
    // which echoes `e.message` into the response body: this handler logs
    // the internal error server-side only and returns a generic message,
    // so an unexpected DB/service error never leaks implementation detail
    // to the client.
    console.error("Requirement coverage report error:", e);
    return Response.json(
      { error: "Failed to build requirement coverage report" },
      { status: 500 }
    );
  }
}
