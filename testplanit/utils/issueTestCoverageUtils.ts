import { baseDb } from "@/lib/db";
import { sql } from "kysely";
import { NextRequest } from "next/server";
import { latestCaseResultsCte } from "~/lib/services/latestCaseResults";
import { authorizeReportRequest } from "~/utils/reportApiUtils";

// Flat row structure for grouping-based approach
export interface IssueTestCoverageRow {
  id: number; // Required by DataTable - unique per row

  // Issue dimension (for grouping)
  issueId: number;
  issueName: string;
  issueTitle: string;
  issueStatus: string | null;
  issueExternalStatus: string | null;
  issuePriority: string | null;
  issueTypeName: string | null;
  issueTypeIconUrl: string | null;
  issueData: any;
  externalId: string | null;
  externalKey: string | null;
  externalUrl: string | null;
  lastSyncedAt: string | null;
  integrationId: number | null;
  integrationProvider: string | null;

  // Test case dimension (for grouping)
  testCaseId: number;
  testCaseName: string;
  testCaseSource: string;
  testCaseHasParameters: boolean;

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
  testCaseHasParameters: boolean;
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
  issue_external_status: string | null;
  issue_priority: string | null;
  issue_type_name: string | null;
  issue_type_icon_url: string | null;
  issue_data: any;
  external_id: string | null;
  external_key: string | null;
  external_url: string | null;
  last_synced_at: Date | null;
  integration_id: number | null;
  integration_provider: string | null;
  test_case_id: number;
  test_case_name: string;
  test_case_source: string;
  test_case_has_parameters: boolean;
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
    const body = await req.json();

    const authz = await authorizeReportRequest(req, {
      requiresAdmin: isCrossProject,
      projectId: body?.projectId ? Number(body.projectId) : undefined,
    });
    if (!authz.ok) return authz.response;
    const { projectId, dimensions = [] } = body;

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
        ? sql`AND i."projectId" = ${projectIdNum}`
        : sql``;

    // Build project fields for cross-project queries
    const projectSelectFields = includeProject
      ? sql`, p.id as project_id, p.name as project_name`
      : sql``;
    const projectJoin = includeProject
      ? sql`INNER JOIN "Projects" p ON p.id = i."projectId"`
      : sql``;

    // Query to get issues with their linked test cases and latest status
    // We need to find the most recent execution for each test case. The
    // "latest result per case" CTEs live in lib/services/latestCaseResults.ts
    // and are shared with the requirement coverage rollup, so both reports
    // agree on what "latest" means for a case.
    const rawResults = (
      await sql<RawIssueTestCaseResult>`
      WITH ${latestCaseResultsCte()}
      SELECT
        i.id as issue_id,
        i.name as issue_name,
        i.title as issue_title,
        i.status as issue_status,
        i."externalStatus" as issue_external_status,
        i.priority as issue_priority,
        i."issueTypeName" as issue_type_name,
        i."issueTypeIconUrl" as issue_type_icon_url,
        i.data as issue_data,
        i."externalId" as external_id,
        i."externalKey" as external_key,
        i."externalUrl" as external_url,
        i."lastSyncedAt" as last_synced_at,
        i."integrationId" as integration_id,
        ig.provider as integration_provider,
        rc.id as test_case_id,
        rc.name as test_case_name,
        rc.source::text as test_case_source,
        rc."hasParameters" as test_case_has_parameters,
        lr.status_id as last_status_id,
        lr.status_name as last_status_name,
        lr.status_color as last_status_color,
        lr.is_success as last_status_is_success,
        lr.is_failure as last_status_is_failure,
        lr.executed_at as last_executed_at
        ${projectSelectFields}
      FROM "Issue" i
      ${projectJoin}
      LEFT JOIN "Integration" ig ON ig.id = i."integrationId"
      INNER JOIN "RepositoryCaseIssue" irc ON irc."issueId" = i.id
      INNER JOIN "RepositoryCases" rc ON rc.id = irc."caseId"
        AND rc."isDeleted" = false
        AND rc."isArchived" = false
      LEFT JOIN latest_results lr ON lr.test_case_id = rc.id
      -- Defect-only scope: mirrors the object predicate exported by
      -- lib/services/issueRoleScope.ts. The raw-SQL form here and that
      -- module's TypeScript form are one contract — keep both in sync if
      -- the discriminator column is ever renamed.
      WHERE i."isDeleted" = false
        AND i."isRequirement" = false
        ${projectFilterSql}
      ORDER BY i.id, rc.id
    `.execute(baseDb.$qb)
    ).rows;

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
        issueExternalStatus: row.issue_external_status,
        issuePriority: row.issue_priority,
        issueTypeName: row.issue_type_name,
        issueTypeIconUrl: row.issue_type_icon_url,
        issueData: row.issue_data,
        externalId: row.external_id,
        externalKey: row.external_key,
        externalUrl: row.external_url,
        lastSyncedAt: row.last_synced_at
          ? row.last_synced_at.toISOString()
          : null,
        integrationId: row.integration_id,
        integrationProvider: row.integration_provider,

        // Test case dimension
        testCaseId: row.test_case_id,
        testCaseName: row.test_case_name,
        testCaseSource: row.test_case_source,
        testCaseHasParameters: row.test_case_has_parameters,

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
