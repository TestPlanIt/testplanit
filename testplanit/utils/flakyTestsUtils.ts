import { baseDb } from "~/lib/db";
import { DbNull } from "@zenstackhq/orm";
import { sql } from "kysely";
import { NextRequest } from "next/server";
import { getExecutionScopeFilterOptions } from "~/lib/services/executionScopeFilterOptions";
import { parseExecutionScopeBody } from "~/lib/services/executionScopeParam";
import {
  queryLatestTestResults,
  type RawExecutionResult,
} from "~/lib/services/latestTestResults";
import { authorizeReportRequest } from "~/utils/reportApiUtils";
import { automatedFlagFilter } from "~/utils/reportFilterParams";
import { resolveReportFolderFilter } from "~/utils/reportGrouping";

interface ExecutionStatus {
  resultId: number;
  testRunId: number | null;
  statusName: string;
  statusColor: string;
  isSuccess: boolean;
  isFailure: boolean;
  executedAt: string;
}

interface FlakyTestRow {
  testCaseId: number;
  testCaseName: string;
  testCaseSource: string;
  testCaseHasParameters: boolean;
  testCaseAutomated: boolean;
  flipCount: number;
  executions: ExecutionStatus[];
  project?: {
    id: number;
    name?: string;
  };
}

/**
 * Count the number of status flips (transitions between different status types) in a sequence of executions.
 * Counts transitions between:
 * - Success (isSuccess = true) and any non-success (isSuccess = false)
 * - This includes transitions to Failed, Blocked, Retest, Skipped, etc.
 * Results are compared based on whether they are success or not, capturing all status changes.
 */
export function countStatusFlips(executions: ExecutionStatus[]): number {
  let flips = 0;
  let lastIsSuccess: boolean | null = null;

  for (const execution of executions) {
    const currentIsSuccess = execution.isSuccess;

    // If we have a previous result and it differs from current (success <-> non-success), count as flip
    if (lastIsSuccess !== null && currentIsSuccess !== lastIsSuccess) {
      flips++;
    }

    lastIsSuccess = currentIsSuccess;
  }

  return flips;
}

/**
 * Check if a test case qualifies as flaky based on its execution history.
 * A test is flaky if it has:
 * 1. Both success and failure results (traditional flakiness), OR
 * 2. Any non-success results (including Blocked, Retest, Skipped, etc.) - to show tests with other statuses
 */
function hasRequiredFlakiness(executions: ExecutionStatus[]): boolean {
  let hasSuccess = false;
  let hasFailure = false;
  let hasNonSuccess = false;

  for (const execution of executions) {
    if (execution.isSuccess) {
      hasSuccess = true;
    } else {
      // Any result that is not a success (including failures, blocked, retest, skipped, etc.)
      hasNonSuccess = true;
    }
    if (execution.isFailure) hasFailure = true;

    // Return true if we have both success and failure (traditional flakiness)
    if (hasSuccess && hasFailure) return true;
  }

  // Also return true if we have both success and any non-success result
  // This includes tests with Blocked, Retest, Skipped, etc. statuses
  return hasSuccess && hasNonSuccess;
}

const MAX_FILTER_IDS = 500;

/**
 * An optional id-list body filter: absent/null/[] is inactive (undefined),
 * a bounded list of positive integers is active, anything else is invalid.
 */
function parseIdFilter(
  raw: unknown
): { ok: true; ids: number[] | undefined } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, ids: undefined };
  if (!Array.isArray(raw) || raw.length > MAX_FILTER_IDS) return { ok: false };
  const ids = raw.map(Number);
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) return { ok: false };
  return { ok: true, ids: ids.length > 0 ? ids : undefined };
}

/**
 * Custom field filters (field id -> accepted values), in the same shape the
 * automation trends filter sends. Absent/null/{} is inactive.
 */
function parseDynamicFieldFilters(
  raw: unknown
):
  | { ok: true; filters: Map<number, Array<string | number>> | undefined }
  | { ok: false } {
  if (raw === undefined || raw === null)
    return { ok: true, filters: undefined };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false };
  const filters = new Map<number, Array<string | number>>();
  for (const [key, values] of Object.entries(raw)) {
    const fieldId = Number(key);
    if (!Number.isInteger(fieldId) || fieldId <= 0 || !Array.isArray(values)) {
      return { ok: false };
    }
    const scalars = values.filter(
      (value): value is string | number =>
        typeof value === "string" || typeof value === "number"
    );
    if (scalars.length !== values.length) return { ok: false };
    if (scalars.length > 0) filters.set(fieldId, scalars);
  }
  return { ok: true, filters: filters.size > 0 ? filters : undefined };
}

/**
 * The ids of the cases whose custom field values match EVERY filter. Within
 * one field any listed value matches; a multi-select value matches when it
 * contains any listed value. Values live in JSON, which Prisma cannot `in`
 * over, so matching happens here.
 */
async function resolveDynamicFieldCaseIds(
  filters: Map<number, Array<string | number>>,
  projectIds: number[] | undefined
): Promise<number[]> {
  const rows = await baseDb.caseFieldValues.findMany({
    where: {
      fieldId: { in: [...filters.keys()] },
      value: { not: DbNull },
      testCase: {
        isDeleted: false,
        ...(projectIds ? { projectId: { in: projectIds } } : {}),
      },
    },
    select: { testCaseId: true, fieldId: true, value: true },
  });

  const matchedFieldsByCase = new Map<number, Set<number>>();
  for (const row of rows) {
    const accepted = filters.get(row.fieldId)!;
    const value = row.value;
    const matches = Array.isArray(value)
      ? accepted.some((candidate) => value.includes(candidate))
      : accepted.includes(value as string | number);
    if (!matches) continue;
    const matched = matchedFieldsByCase.get(row.testCaseId) ?? new Set();
    matched.add(row.fieldId);
    matchedFieldsByCase.set(row.testCaseId, matched);
  }

  return [...matchedFieldsByCase.entries()]
    .filter(([, matched]) => matched.size === filters.size)
    .map(([caseId]) => caseId);
}

/**
 * Filter options the view-options endpoint does not supply: case tags, run
 * tags, and (project-scoped only) the execution-scope milestones and
 * configurations. Also serves the report's empty dimension/metric metadata.
 */
export async function handleFlakyTestsOptionsGET(
  req: NextRequest,
  isCrossProject: boolean
) {
  const projectIdParam =
    Number(new URL(req.url).searchParams.get("projectId")) || undefined;
  const authz = await authorizeReportRequest(req, {
    requiresAdmin: isCrossProject,
    projectId: isCrossProject ? undefined : projectIdParam,
  });
  if (!authz.ok) return authz.response;

  if (!isCrossProject && !projectIdParam) {
    return Response.json({ error: "Project ID is required" }, { status: 400 });
  }

  const caseWhere = {
    isDeleted: false,
    ...(isCrossProject ? {} : { projectId: projectIdParam }),
  };
  const [caseTags, runTags, scopeOptions] = await Promise.all([
    baseDb.tags.findMany({
      where: { isDeleted: false, caseTags: { some: { case: caseWhere } } },
      select: {
        id: true,
        name: true,
        _count: { select: { caseTags: { where: { case: caseWhere } } } },
      },
      orderBy: { name: "asc" },
    }),
    // Raw SQL: the ORM's relation filter and count over the implicit
    // _TagsToTestRuns table (A = Tags.id, B = TestRuns.id) took over a
    // minute on a project with ~20k tagged runs.
    sql<{ id: number; name: string; count: number }>`
      SELECT t.id, t.name, count(*)::int AS count
      FROM "_TagsToTestRuns" ttr
      JOIN "TestRuns" tr ON tr.id = ttr."B" AND tr."isDeleted" = false
      JOIN "Tags" t ON t.id = ttr."A" AND t."isDeleted" = false
      ${isCrossProject ? sql`` : sql`WHERE tr."projectId" = ${projectIdParam}`}
      GROUP BY t.id, t.name
      ORDER BY t.name
    `
      .execute(baseDb.$qb)
      .then((result) => result.rows),
    isCrossProject
      ? { milestones: [], configurations: [] }
      : getExecutionScopeFilterOptions(projectIdParam!),
  ]);

  return Response.json({
    dimensions: [],
    metrics: [],
    caseTags: caseTags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      count: tag._count.caseTags,
    })),
    runTags,
    milestones: scopeOptions.milestones,
    configurations: scopeOptions.configurations,
  });
}

export async function handleFlakyTestsPOST(
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
    const {
      projectId,
      consecutiveRuns = 10,
      flipThreshold = 5,
      startDate,
      endDate,
      automatedFilter, // ("automated" | "manual")[]; a single value or "all" also accepted
      dimensions = [], // Array of dimension IDs
    } = body;

    // Check if project dimension is requested
    const includeProject = isCrossProject && dimensions.includes("project");

    // Validate parameters
    const runs = Math.min(Math.max(Number(consecutiveRuns), 5), 30);
    const threshold = Math.min(Math.max(Number(flipThreshold), 2), runs - 1);

    // For project-specific, require projectId
    if (!isCrossProject && !projectId) {
      return Response.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }

    const projectIds = parseIdFilter(body.projectIds);
    const templateIds = parseIdFilter(body.templateIds);
    const stateIds = parseIdFilter(body.stateIds);
    const caseTagIds = parseIdFilter(body.caseTagIds);
    const runTagIds = parseIdFilter(body.runTagIds);
    const dynamicFieldFilters = parseDynamicFieldFilters(
      body.dynamicFieldFilters
    );
    const executionScope = parseExecutionScopeBody(
      body.milestoneIds,
      body.configIds
    );
    if (
      !projectIds.ok ||
      !templateIds.ok ||
      !stateIds.ok ||
      !caseTagIds.ok ||
      !runTagIds.ok ||
      !dynamicFieldFilters.ok ||
      !executionScope.ok
    ) {
      return Response.json({ error: "Invalid filters" }, { status: 400 });
    }

    // Parse dates
    const startDateParsed = startDate ? new Date(startDate) : null;
    const endDateParsed = endDate ? new Date(endDate) : null;
    const projectIdNum = projectId ? Number(projectId) : null;

    // "Automated" means the case's `automated` flag — the definitive
    // marker (reporters flip it) — not the source enum, which records where
    // the case came from.
    const automatedFlag = automatedFlagFilter(automatedFilter);

    // The project filter only narrows the cross-project report; a
    // project-scoped one is already a single project.
    const scopedProjectIds = isCrossProject
      ? projectIds.ids
      : [projectIdNum as number];
    const folderIds = await resolveReportFolderFilter(
      baseDb,
      body.folderIds,
      body.folderIncludeDescendants
    );
    const caseIds = dynamicFieldFilters.filters
      ? await resolveDynamicFieldCaseIds(
          dynamicFieldFilters.filters,
          scopedProjectIds
        )
      : undefined;

    // Ranked executions come from the shared service, which composes every
    // filter into one statement.
    const rawResults: RawExecutionResult[] = await queryLatestTestResults({
      limit: runs,
      caseIds,
      projectId: isCrossProject ? null : projectIdNum,
      projectIds: isCrossProject ? projectIds.ids : undefined,
      startDate: startDateParsed,
      endDate: endDateParsed,
      automatedFlag,
      includeProject,
      templateIds: templateIds.ids,
      stateIds: stateIds.ids,
      folderIds,
      caseTagIds: caseTagIds.ids,
      runTagIds: runTagIds.ids,
      milestoneIds: executionScope.scope?.milestoneIds,
      configIds: executionScope.scope?.configIds,
    });

    // Group results by test case (and project if included)
    const testCaseMap = new Map<
      string,
      {
        testCaseId: number;
        testCaseName: string;
        testCaseSource: string;
        testCaseHasParameters: boolean;
        testCaseAutomated: boolean;
        projectId?: number;
        projectName?: string;
        executions: ExecutionStatus[];
      }
    >();

    for (const row of rawResults) {
      const testCaseId = row.test_case_id;
      // Create a unique key that includes project if it's included
      const key =
        includeProject && row.project_id
          ? `${testCaseId}-${row.project_id}`
          : `${testCaseId}`;

      if (!testCaseMap.has(key)) {
        testCaseMap.set(key, {
          testCaseId,
          testCaseName: row.test_case_name,
          testCaseSource: row.test_case_source,
          testCaseHasParameters: row.test_case_has_parameters,
          testCaseAutomated: row.test_case_automated,
          projectId: includeProject ? row.project_id : undefined,
          projectName: includeProject ? row.project_name : undefined,
          executions: [],
        });
      }

      testCaseMap.get(key)!.executions.push({
        resultId: row.result_id,
        testRunId: row.test_run_id,
        statusName: row.status_name,
        statusColor: row.status_color,
        isSuccess: row.is_success,
        isFailure: row.is_failure,
        executedAt: row.executed_at.toISOString(),
      });
    }

    // Process each test case to find flaky ones
    const flakyTests: FlakyTestRow[] = [];

    for (const testCase of testCaseMap.values()) {
      // Skip if not enough results
      if (testCase.executions.length < 2) {
        continue;
      }

      // Check if test has both success and failure results
      if (!hasRequiredFlakiness(testCase.executions)) {
        continue;
      }

      // Count flips
      const flipCount = countStatusFlips(testCase.executions);

      // Include if flip count meets threshold
      if (flipCount >= threshold) {
        flakyTests.push({
          testCaseId: testCase.testCaseId,
          testCaseName: testCase.testCaseName,
          testCaseSource: testCase.testCaseSource,
          testCaseHasParameters: testCase.testCaseHasParameters,
          testCaseAutomated: testCase.testCaseAutomated,
          flipCount,
          executions: testCase.executions,
          project:
            includeProject && testCase.projectId
              ? {
                  id: testCase.projectId,
                  name: testCase.projectName,
                }
              : undefined,
        });
      }
    }

    // Sort by flip count descending
    flakyTests.sort((a, b) => b.flipCount - a.flipCount);

    return Response.json({
      data: flakyTests,
      total: flakyTests.length,
      consecutiveRuns: runs,
      flipThreshold: threshold,
    });
  } catch (e: unknown) {
    console.error("Flaky tests report error:", e);
    const errorMessage = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
