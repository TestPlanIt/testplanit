import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";

// Flat row structure for grouping-based approach
export interface IssueTestCoverageRow {
  id: number; // Required by DataTable - unique per row

  // Issue dimension (for grouping)
  issueId: number;
  issueName: string;
  issueTitle: string;
  issueStatus: string | null;
  issuePriority: string | null;
  issueTypeName: string | null;
  externalKey: string | null;
  externalUrl: string | null;

  // Test case dimension (for grouping)
  testCaseId: number;
  testCaseName: string;
  testCaseSource: string;

  // Test case metrics
  lastStatusId: number | null;
  lastStatusName: string | null;
  lastStatusColor: string | null;
  lastStatusIsSuccess: boolean | null;
  lastStatusIsFailure: boolean | null;
  lastExecutedAt: string | null;

  // Issue-level summary metrics (duplicated across rows for same issue)
  linkedTestCases: number;
  passedTestCases: number;
  failedTestCases: number;
  untestedTestCases: number;
  passRate: number;

  project?: {
    id: number;
    name?: string;
  };
}

export interface IssueTestCaseDetailRow {
  issueId: number;
  issueName: string;
  issueTitle: string;
  issueStatus: string | null;
  externalKey: string | null;
  externalUrl: string | null;
  testCaseId: number;
  testCaseName: string;
  testCaseSource: string;
  lastStatusId: number | null;
  lastStatusName: string | null;
  lastStatusColor: string | null;
  lastStatusIsSuccess: boolean | null;
  lastStatusIsFailure: boolean | null;
  lastExecutedAt: string | null;
  project?: {
    id: number;
    name?: string;
  };
}

interface RawIssueTestCaseResult {
  issue_id: number;
  issue_name: string;
  issue_title: string;
  issue_status: string | null;
  issue_priority: string | null;
  issue_type_name: string | null;
  external_key: string | null;
  external_url: string | null;
  test_case_id: number;
  test_case_name: string;
  test_case_source: string;
  last_status_id: number | null;
  last_status_name: string | null;
  last_status_color: string | null;
  last_status_is_success: boolean | null;
  last_status_is_failure: boolean | null;
  last_executed_at: Date | null;
  project_id?: number;
  project_name?: string;
}

export async function handleIssueTestCoveragePOST(
  req: NextRequest,
  isCrossProject: boolean
) {
  try {
    // Check admin access for cross-project
    if (isCrossProject) {
      const session = await getServerSession(authOptions);
      if (!session || session.user.access !== "ADMIN") {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = await req.json();
    const {
      projectId,
      dimensions = [],
    } = body;

    // Check if project dimension is requested
    const includeProject = isCrossProject && dimensions.includes("project");

    // For project-specific, require projectId
    if (!isCrossProject && !projectId) {
      return Response.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }

    const projectIdNum = projectId ? Number(projectId) : null;

    // Build project filter
    const projectFilterSql =
      !isCrossProject && projectIdNum
        ? Prisma.sql`AND i."projectId" = ${projectIdNum}`
        : Prisma.empty;

    // Build project fields for cross-project queries
    const projectSelectFields = includeProject
      ? Prisma.sql`, p.id as project_id, p.name as project_name`
      : Prisma.empty;
    const projectJoin = includeProject
      ? Prisma.sql`INNER JOIN "Projects" p ON p.id = i."projectId"`
      : Prisma.empty;

    // Query to get issues with their linked test cases and latest status
    // We need to find the most recent execution for each test case
    const rawResults = await prisma.$queryRaw<RawIssueTestCaseResult[]>`
      WITH latest_manual_results AS (
        -- Get the latest manual test result for each repository case
        SELECT DISTINCT ON (rc.id)
          rc.id as test_case_id,
          trr."executedAt" as executed_at,
          s.id as status_id,
          s.name as status_name,
          c.value as status_color,
          s."isSuccess" as is_success,
          s."isFailure" as is_failure
        FROM "RepositoryCases" rc
        INNER JOIN "TestRunCases" trc ON trc."repositoryCaseId" = rc.id
        INNER JOIN "TestRuns" tr ON tr.id = trc."testRunId" AND tr."isDeleted" = false
        INNER JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id
        INNER JOIN "Status" s ON s.id = trr."statusId"
        LEFT JOIN "Color" c ON c.id = s."colorId"
        WHERE rc."isDeleted" = false
          AND rc."isArchived" = false
          AND trr."executedAt" IS NOT NULL
        ORDER BY rc.id, trr."executedAt" DESC
      ),
      latest_junit_results AS (
        -- Get the latest JUnit result for each repository case
        SELECT DISTINCT ON (rc.id)
          rc.id as test_case_id,
          jr."executedAt" as executed_at,
          COALESCE(s.id,
            CASE jr.type
              WHEN 'PASSED' THEN -1
              WHEN 'FAILURE' THEN -2
              WHEN 'ERROR' THEN -3
              ELSE NULL
            END
          ) as status_id,
          COALESCE(s.name, jr.type::text) as status_name,
          COALESCE(c.value,
            CASE jr.type
              WHEN 'PASSED' THEN '#22c55e'
              WHEN 'FAILURE' THEN '#ef4444'
              WHEN 'ERROR' THEN '#ef4444'
              ELSE '#6b7280'
            END
          ) as status_color,
          COALESCE(s."isSuccess", jr.type = 'PASSED') as is_success,
          COALESCE(s."isFailure", jr.type IN ('FAILURE', 'ERROR')) as is_failure
        FROM "RepositoryCases" rc
        INNER JOIN "JUnitTestResult" jr ON jr."repositoryCaseId" = rc.id
        INNER JOIN "JUnitTestSuite" jts ON jts.id = jr."testSuiteId"
        INNER JOIN "TestRuns" tr ON tr.id = jts."testRunId" AND tr."isDeleted" = false
        LEFT JOIN "Status" s ON s.id = jr."statusId"
        LEFT JOIN "Color" c ON c.id = s."colorId"
        WHERE rc."isDeleted" = false
          AND rc."isArchived" = false
          AND jr."executedAt" IS NOT NULL
          AND jr.type != 'SKIPPED'
        ORDER BY rc.id, jr."executedAt" DESC
      ),
      latest_results AS (
        -- Combine and get the most recent result for each test case
        SELECT DISTINCT ON (test_case_id)
          test_case_id,
          executed_at,
          status_id,
          status_name,
          status_color,
          is_success,
          is_failure
        FROM (
          SELECT * FROM latest_manual_results
          UNION ALL
          SELECT * FROM latest_junit_results
        ) all_results
        ORDER BY test_case_id, executed_at DESC
      )
      SELECT
        i.id as issue_id,
        i.name as issue_name,
        i.title as issue_title,
        i.status as issue_status,
        i.priority as issue_priority,
        i."issueTypeName" as issue_type_name,
        i."externalKey" as external_key,
        i."externalUrl" as external_url,
        rc.id as test_case_id,
        rc.name as test_case_name,
        rc.source::text as test_case_source,
        lr.status_id as last_status_id,
        lr.status_name as last_status_name,
        lr.status_color as last_status_color,
        lr.is_success as last_status_is_success,
        lr.is_failure as last_status_is_failure,
        lr.executed_at as last_executed_at
        ${projectSelectFields}
      FROM "Issue" i
      ${projectJoin}
      INNER JOIN "_IssueToRepositoryCases" irc ON irc."A" = i.id
      INNER JOIN "RepositoryCases" rc ON rc.id = irc."B"
        AND rc."isDeleted" = false
        AND rc."isArchived" = false
      LEFT JOIN latest_results lr ON lr.test_case_id = rc.id
      WHERE i."isDeleted" = false
        ${projectFilterSql}
      ORDER BY i.id, rc.id
    `;

    // First pass: Calculate issue-level summary metrics
    interface IssueSummary {
      linkedTestCases: number;
      passedTestCases: number;
      failedTestCases: number;
      untestedTestCases: number;
      passRate: number;
    }
    const issueSummaryMap = new Map<number, IssueSummary>();

    for (const row of rawResults) {
      let summary = issueSummaryMap.get(row.issue_id);

      if (!summary) {
        summary = {
          linkedTestCases: 0,
          passedTestCases: 0,
          failedTestCases: 0,
          untestedTestCases: 0,
          passRate: 0,
        };
        issueSummaryMap.set(row.issue_id, summary);
      }

      summary.linkedTestCases++;

      if (row.last_status_is_success === true) {
        summary.passedTestCases++;
      } else if (row.last_status_is_failure === true) {
        summary.failedTestCases++;
      } else {
        summary.untestedTestCases++;
      }
    }

    // Calculate pass rates
    for (const summary of issueSummaryMap.values()) {
      const testedCount = summary.passedTestCases + summary.failedTestCases;
      summary.passRate =
        testedCount > 0
          ? Math.round((summary.passedTestCases / testedCount) * 100)
          : 0;
    }

    // Second pass: Create flat rows with issue summary duplicated
    const flatResults: IssueTestCoverageRow[] = [];
    let uniqueId = 0;

    for (const row of rawResults) {
      const summary = issueSummaryMap.get(row.issue_id)!;

      flatResults.push({
        id: uniqueId++, // Unique ID per row

        // Issue dimension
        issueId: row.issue_id,
        issueName: row.issue_name,
        issueTitle: row.issue_title,
        issueStatus: row.issue_status,
        issuePriority: row.issue_priority,
        issueTypeName: row.issue_type_name,
        externalKey: row.external_key,
        externalUrl: row.external_url,

        // Test case dimension
        testCaseId: row.test_case_id,
        testCaseName: row.test_case_name,
        testCaseSource: row.test_case_source,

        // Test case metrics
        lastStatusId: row.last_status_id,
        lastStatusName: row.last_status_name,
        lastStatusColor: row.last_status_color,
        lastStatusIsSuccess: row.last_status_is_success,
        lastStatusIsFailure: row.last_status_is_failure,
        lastExecutedAt: row.last_executed_at
          ? row.last_executed_at.toISOString()
          : null,

        // Issue-level summary (duplicated across rows for same issue)
        linkedTestCases: summary.linkedTestCases,
        passedTestCases: summary.passedTestCases,
        failedTestCases: summary.failedTestCases,
        untestedTestCases: summary.untestedTestCases,
        passRate: summary.passRate,

        project:
          includeProject && row.project_id
            ? {
                id: row.project_id,
                name: row.project_name,
              }
            : undefined,
      });
    }

    // Sort by number of failed tests (most failures first), then by pass rate
    flatResults.sort((a, b) => {
      // Primary: more failed tests first
      if (b.failedTestCases !== a.failedTestCases) {
        return b.failedTestCases - a.failedTestCases;
      }
      // Secondary: lower pass rate first
      if (a.passRate !== b.passRate) {
        return a.passRate - b.passRate;
      }
      // Tertiary: more linked tests first
      return b.linkedTestCases - a.linkedTestCases;
    });

    return Response.json({
      data: flatResults,
      total: flatResults.length,
    });
  } catch (e: unknown) {
    console.error("Issue test coverage report error:", e);
    const errorMessage = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
