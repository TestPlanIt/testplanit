import { baseDb } from "~/lib/db";
import { getAllDescendantMilestoneIds } from "~/lib/services/milestoneDescendants";

/**
 * Per-member-issue coverage computation for a milestone's Issues section
 * (MLINK-04, D-04/D-05/D-06/D-15) — extracted from the members/coverage
 * route so the milestone PDF export can reuse the identical semantics.
 *
 * Classification follows the NAMED convention in
 * lib/services/testRunSummary.ts (Status.isSuccess/isFailure/isCompleted).
 * `statuses` carries per-COMPLETED-status counts (matrix display model);
 * everything without a completed outcome — missing results, no-status
 * results, non-completed statuses, the system 'untested' status —
 * aggregates into the explicit `untested` total.
 *
 * Result scope is descendant-inclusive (D-06); membership itself is NOT
 * descendant-scoped (D-15).
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
  statuses: CoverageStatusCount[];
  untested: number;
};

export type MemberCoverageResponse = Record<number, CoverageBreakdown>;

export async function getMemberCoverage(
  milestoneId: number
): Promise<MemberCoverageResponse> {
  // Result scope: this milestone + all descendants (D-06).
  const descendantIds = await getAllDescendantMilestoneIds(milestoneId);
  const scopedMilestoneIds = [milestoneId, ...descendantIds];

  // Membership scope: MilestoneIssue rows on THIS milestone only (D-15).
  const memberRows = await baseDb.milestoneIssue.findMany({
    where: { milestoneId },
    select: { issueId: true },
  });

  const memberIssueIds = memberRows.map((row) => row.issueId);

  if (memberIssueIds.length === 0) {
    return {};
  }

  // Single raw-SQL composition rather than N per-issue queries: for each
  // member issue, count linked RepositoryCases and classify each case's
  // latest in-scope TestRunCases result via the named Status convention.
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
  // model): COMPLETED statuses only; the rest folds into `untested`.
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
      AND s."isCompleted" = true
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

  return response;
}
