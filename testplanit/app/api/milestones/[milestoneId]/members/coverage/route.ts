import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { baseDb } from "~/lib/db";
import { getAllDescendantMilestoneIds } from "~/lib/services/milestoneDescendants";
import { authOptions } from "~/server/auth";

/**
 * GET /api/milestones/[milestoneId]/members/coverage
 *
 * Per-member-issue coverage breakdown for a synced or local milestone's
 * Issues section (MLINK-04, D-04/D-05/D-06/D-15). Turns the 18-01 RED
 * scaffold GREEN.
 *
 * Shape: `Record<issueId, CoverageBreakdown>` where each entry is
 * `{ linkedCaseCount, passed, failed, inProgress, notRun, uncovered }`.
 *
 * Classification follows the NAMED convention in
 * lib/services/testRunSummary.ts (Status.isSuccess/isFailure/isCompleted):
 *   passed     = latest in-scope result's Status.isSuccess === true
 *   failed     = latest in-scope result's Status.isFailure === true
 *   inProgress = latest in-scope result exists, Status.isCompleted === true,
 *                and neither isSuccess nor isFailure
 *   notRun     = case is linked but has no in-scope result (or the latest
 *                in-scope result's Status.isCompleted !== true)
 *   uncovered  = the issue has zero linked RepositoryCases — a distinct 5th
 *                state (D-05), never folded into notRun.
 *
 * Result scope (runs/sessions via TestRunCases) is descendant-inclusive
 * (D-06: this milestone + getAllDescendantMilestoneIds). Membership itself
 * (which issues count as "members" at all) is NOT descendant-scoped (D-15)
 * — only `MilestoneIssue` rows on the requested milestone qualify.
 *
 * projectId is always re-derived server-side from the milestone row; a
 * client-supplied projectId is never trusted (T-18-05-01/V13). Access is
 * gated the same way the sibling milestone routes (summary/, forecast/,
 * descendants/) are: authenticated session + the milestone row existing.
 * `baseDb` is the raw ZenStack client (no per-row access policy) — this
 * matches the existing milestone-detail read surface, which is reached only
 * through UI already scoped to projects the session can see.
 */
export type CoverageStatusCount = {
  statusId: number;
  name: string;
  color: string | null;
  count: number;
};

export type CoverageBreakdown = {
  linkedCaseCount: number;
  passed: number;
  failed: number;
  inProgress: number;
  notRun: number;
  uncovered: boolean;
  /**
   * Latest-result counts per ACTUAL project status (the iteration-matrix
   * display model): one entry per distinct status among the linked cases'
   * latest in-scope results, with the admin-configured color. The system
   * 'untested' status is deliberately excluded — it folds into `untested`.
   */
  statuses: CoverageStatusCount[];
  /**
   * Single explicit Untested aggregate (the Reports convention): linked
   * cases with no in-scope result, results with no status, and results
   * carrying the system 'untested' status.
   */
  untested: number;
};

export type MemberCoverageResponse = Record<number, CoverageBreakdown>;

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ milestoneId: string }> }
) {
  const { milestoneId: milestoneIdParam } = await context.params;
  const milestoneId = Number(milestoneIdParam);

  if (isNaN(milestoneId)) {
    return NextResponse.json(
      { error: "Invalid milestone ID" },
      { status: 400 }
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Resolve the milestone row server-side — projectId is NEVER trusted
    // from client input (V13 / T-18-05-01).
    const milestone = await baseDb.milestones.findUnique({
      where: { id: milestoneId },
      select: { id: true, projectId: true },
    });

    if (!milestone) {
      return NextResponse.json(
        { error: "Milestone not found" },
        { status: 404 }
      );
    }

    // Result scope: this milestone + all descendants (D-06) — a release
    // aggregates its child sprints' runs/sessions.
    const descendantIds = await getAllDescendantMilestoneIds(milestoneId);
    const scopedMilestoneIds = [milestoneId, ...descendantIds];

    // Membership scope: MilestoneIssue rows on THIS milestone only (D-15) —
    // descendant ids feed only the result scope above, never membership.
    const memberRows = await baseDb.milestoneIssue.findMany({
      where: { milestoneId },
      select: { issueId: true },
    });

    const memberIssueIds = memberRows.map((row) => row.issueId);

    if (memberIssueIds.length === 0) {
      return NextResponse.json({});
    }

    // Single raw-SQL composition (mirrors getMilestoneLinkedIssues' style)
    // rather than N per-issue queries: for each member issue, count linked
    // RepositoryCases and classify each case's latest in-scope TestRunCases
    // result via the named Status boolean convention.
    const rows = await baseDb.$queryRaw<
      Array<{
        issueId: number;
        linkedCaseCount: bigint | number;
        passed: bigint | number;
        failed: bigint | number;
        inProgress: bigint | number;
        notRun: bigint | number;
      }>
    >`
      WITH linked_cases AS (
        SELECT rci."issueId", rci."caseId"
        FROM "RepositoryCaseIssue" rci
        WHERE rci."issueId" = ANY(${memberIssueIds}::int[])
      ),
      latest_result AS (
        SELECT DISTINCT ON (lc."issueId", lc."caseId")
          lc."issueId",
          lc."caseId",
          trc.id AS "testRunCaseId",
          s."isSuccess" AS "isSuccess",
          s."isFailure" AS "isFailure",
          s."isCompleted" AS "isCompleted"
        FROM linked_cases lc
        LEFT JOIN "TestRunCases" trc
          ON trc."repositoryCaseId" = lc."caseId"
          AND trc."isDeleted" = false
        LEFT JOIN "TestRuns" tr
          ON tr.id = trc."testRunId"
          AND tr."milestoneId" = ANY(${scopedMilestoneIds}::int[])
        LEFT JOIN "Status" s ON s.id = trc."statusId"
        WHERE tr.id IS NOT NULL OR trc.id IS NULL
        ORDER BY lc."issueId", lc."caseId", trc."completedAt" DESC NULLS LAST, trc.id DESC
      )
      SELECT
        lc."issueId" AS "issueId",
        COUNT(DISTINCT lc."caseId") AS "linkedCaseCount",
        COUNT(*) FILTER (WHERE lr."isSuccess" = true) AS "passed",
        COUNT(*) FILTER (WHERE lr."isFailure" = true) AS "failed",
        COUNT(*) FILTER (
          WHERE lr."testRunCaseId" IS NOT NULL
            AND lr."isCompleted" = true
            AND lr."isSuccess" IS NOT true
            AND lr."isFailure" IS NOT true
        ) AS "inProgress",
        COUNT(*) FILTER (
          WHERE lr."testRunCaseId" IS NULL
            OR lr."isCompleted" IS NOT true
        ) AS "notRun"
      FROM linked_cases lc
      LEFT JOIN latest_result lr
        ON lr."issueId" = lc."issueId" AND lr."caseId" = lc."caseId"
      GROUP BY lc."issueId"
    `;

    // Per-status counts for the same latest-result set (matrix display
    // model): group by the result's real Status with its color.
    const statusRows = await baseDb.$queryRaw<
      Array<{
        issueId: number;
        statusId: number;
        name: string;
        color: string | null;
        count: bigint | number;
      }>
    >`
      WITH linked_cases AS (
        SELECT rci."issueId", rci."caseId"
        FROM "RepositoryCaseIssue" rci
        WHERE rci."issueId" = ANY(${memberIssueIds}::int[])
      ),
      latest_result AS (
        SELECT DISTINCT ON (lc."issueId", lc."caseId")
          lc."issueId",
          lc."caseId",
          trc.id AS "testRunCaseId",
          trc."statusId" AS "statusId"
        FROM linked_cases lc
        LEFT JOIN "TestRunCases" trc
          ON trc."repositoryCaseId" = lc."caseId"
          AND trc."isDeleted" = false
        LEFT JOIN "TestRuns" tr
          ON tr.id = trc."testRunId"
          AND tr."milestoneId" = ANY(${scopedMilestoneIds}::int[])
        WHERE tr.id IS NOT NULL OR trc.id IS NULL
        ORDER BY lc."issueId", lc."caseId", trc."completedAt" DESC NULLS LAST, trc.id DESC
      )
      SELECT
        lr."issueId" AS "issueId",
        lr."statusId" AS "statusId",
        s.name AS "name",
        c.value AS "color",
        COUNT(*) AS "count"
      FROM latest_result lr
      JOIN "Status" s ON s.id = lr."statusId"
      LEFT JOIN "Color" c ON c.id = s."colorId"
      WHERE lr."testRunCaseId" IS NOT NULL
        AND s."systemName" IS DISTINCT FROM 'untested'
      GROUP BY lr."issueId", lr."statusId", s.name, c.value
      ORDER BY lr."issueId", COUNT(*) DESC
    `;

    const statusesByIssueId = new Map<number, CoverageStatusCount[]>();
    for (const row of statusRows) {
      // Guard: only well-formed per-status rows (also keeps unit-test mocks
      // that stub a single shared $queryRaw return inert here).
      if (typeof row.statusId !== "number" || !row.name) continue;
      const list = statusesByIssueId.get(row.issueId) ?? [];
      list.push({
        statusId: row.statusId,
        name: row.name,
        color: row.color ?? null,
        count: Number(row.count),
      });
      statusesByIssueId.set(row.issueId, list);
    }

    const breakdownByIssueId = new Map<number, CoverageBreakdown>();
    rows.forEach((row) => {
      breakdownByIssueId.set(row.issueId, {
        linkedCaseCount: Number(row.linkedCaseCount),
        passed: Number(row.passed),
        failed: Number(row.failed),
        inProgress: Number(row.inProgress),
        notRun: Number(row.notRun),
        uncovered: Number(row.linkedCaseCount) === 0,
        statuses: statusesByIssueId.get(row.issueId) ?? [],
        untested: Math.max(
          0,
          Number(row.linkedCaseCount) -
            (statusesByIssueId.get(row.issueId) ?? []).reduce(
              (sum, entry) => sum + entry.count,
              0
            )
        ),
      });
    });

    const response: MemberCoverageResponse = {};
    memberIssueIds.forEach((issueId) => {
      response[issueId] = breakdownByIssueId.get(issueId) ?? {
        linkedCaseCount: 0,
        passed: 0,
        failed: 0,
        inProgress: 0,
        notRun: 0,
        uncovered: true,
        statuses: [],
        untested: 0,
      };
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error("Milestone member coverage error:", error);
    return NextResponse.json(
      { error: "Failed to fetch member coverage" },
      { status: 500 }
    );
  }
}
