import { baseDb } from "@/lib/db";
import { sql, type RawBuilder } from "kysely";
import { NextRequest } from "next/server";
import { authorizeReportRequest } from "~/utils/reportApiUtils";
import {
  buildExpectedSlotsByCaseId,
  mergeResultsIntoSlots,
  type ExecutionLogStepRow,
  type SharedGroupRow,
  type SharedItemRow,
  type StepRow,
} from "./executionLogSlots";

export type { ExecutionLogStepRow } from "./executionLogSlots";

export interface ExecutionLogRow {
  /** Manual rows keep their TestRunResults id; automated (JUnit) rows use
   *  the negated JUnitTestResult id so keys never collide across sources. */
  id: number;
  origin: "manual" | "automated";
  testCaseId: number;
  testCaseName: string;
  testCaseSource: string;
  testCaseHasParameters: boolean;
  testRunId: number;
  testRunName: string;
  testRunIsDeleted: boolean;
  status: { name: string; color: string };
  executedBy: { id: string; name: string };
  executedAt: string;
  elapsed: number | null;
  /** Null for automated rows — versioning applies to manual run cases. */
  testRunCaseVersion: number | null;
  project?: { id: number; name: string; iconUrl?: string | null };
  steps?: ExecutionLogStepRow[];
}

/** Raw row shape of the manual ∪ automated union query below. */
interface CombinedExecutionRow {
  origin: "manual" | "junit";
  id: number;
  executed_at: Date;
  elapsed: number | null;
  test_run_case_version: number | null;
  status_name: string;
  status_color: string | null;
  executed_by_id: string;
  executed_by_name: string;
  case_id: number;
  case_name: string;
  case_source: string;
  case_has_parameters: boolean;
  run_id: number;
  run_name: string;
  run_is_deleted: boolean;
  project_id: number;
  project_name: string;
  project_icon: string | null;
}

export async function handleExecutionLogPOST(
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
      startDate,
      endDate,
      page = 1,
      pageSize = 25,
      sortColumn = "executedAt",
      sortDirection = "desc",
    } = body;

    if (!isCrossProject && !projectId) {
      return Response.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }

    const projectIdNum = projectId ? Number(projectId) : null;
    const pageNum = Math.max(1, Number(page));
    const pageSizeNum =
      pageSize === "All" ? 1000 : Math.min(Math.max(Number(pageSize), 1), 200);
    const skip = (pageNum - 1) * pageSizeNum;

    // ---- shared filters -------------------------------------------------
    // The log lists executions from BOTH sources: manual results
    // (TestRunResults) and automated results (JUnitTestResult). Untested
    // rows are placeholders, not executions (null JUnit statusId counts as
    // Untested), and rows without an executedAt cannot be placed on the log.
    const projectScopedManual =
      !isCrossProject && projectIdNum
        ? sql`AND tr."projectId" = ${projectIdNum}`
        : sql``;
    const projectScopedJunit =
      !isCrossProject && projectIdNum
        ? sql`AND tr."projectId" = ${projectIdNum}`
        : sql``;
    const startDateVal = startDate ? new Date(startDate) : null;
    const endDateVal = endDate ? new Date(endDate) : null;
    const manualDateFilter = sql`${
      startDateVal ? sql`AND trr."executedAt" >= ${startDateVal}` : sql``
    } ${endDateVal ? sql`AND trr."executedAt" <= ${endDateVal}` : sql``}`;
    const junitDateFilter = sql`${
      startDateVal ? sql`AND jr."executedAt" >= ${startDateVal}` : sql``
    } ${endDateVal ? sql`AND jr."executedAt" <= ${endDateVal}` : sql``}`;

    const dir = sortDirection === "asc" ? sql`asc` : sql`desc`;
    const sortColumnSql: Record<string, RawBuilder<unknown>> = {
      executedAt: sql`executed_at`,
      testRunCaseVersion: sql`test_run_case_version`,
      elapsed: sql`elapsed`,
      statusName: sql`status_name`,
      executedBy: sql`executed_by_name`,
      testRunName: sql`run_name`,
      testCaseName: sql`case_name`,
      project: sql`project_name`,
    };
    const orderExpr = sortColumnSql[sortColumn] ?? sql`executed_at`;
    // "All" serves the complete set (product ruling) — no page window.
    const pageWindow =
      pageSize === "All" ? sql`` : sql`LIMIT ${pageSizeNum} OFFSET ${skip}`;

    const rawRows = (
      await sql<CombinedExecutionRow>`
        WITH combined AS (
          SELECT
            'manual' as origin,
            trr.id as id,
            trr."executedAt" as executed_at,
            trr.elapsed as elapsed,
            trr."testRunCaseVersion" as test_run_case_version,
            s.name as status_name,
            c.value as status_color,
            u.id as executed_by_id,
            u.name as executed_by_name,
            rc.id as case_id,
            rc.name as case_name,
            rc.source::text as case_source,
            rc."hasParameters" as case_has_parameters,
            tr.id as run_id,
            tr.name as run_name,
            tr."isDeleted" as run_is_deleted,
            p.id as project_id,
            p.name as project_name,
            p."iconUrl" as project_icon
          FROM "TestRunResults" trr
          INNER JOIN "TestRuns" tr ON tr.id = trr."testRunId" AND tr."isDeleted" = false
          INNER JOIN "Status" s ON s.id = trr."statusId" AND s."systemName" <> 'untested'
          LEFT JOIN "Color" c ON c.id = s."colorId"
          INNER JOIN "User" u ON u.id = trr."executedById"
          INNER JOIN "TestRunCases" trc ON trc.id = trr."testRunCaseId"
          INNER JOIN "RepositoryCases" rc ON rc.id = trc."repositoryCaseId"
          INNER JOIN "Projects" p ON p.id = tr."projectId"
          WHERE trr."isDeleted" = false
            ${projectScopedManual}
            ${manualDateFilter}

          UNION ALL

          SELECT
            'junit' as origin,
            jr.id as id,
            jr."executedAt" as executed_at,
            jr.time as elapsed,
            NULL as test_run_case_version,
            s.name as status_name,
            c.value as status_color,
            u.id as executed_by_id,
            u.name as executed_by_name,
            rc.id as case_id,
            rc.name as case_name,
            rc.source::text as case_source,
            rc."hasParameters" as case_has_parameters,
            tr.id as run_id,
            tr.name as run_name,
            tr."isDeleted" as run_is_deleted,
            p.id as project_id,
            p.name as project_name,
            p."iconUrl" as project_icon
          FROM "JUnitTestResult" jr
          INNER JOIN "JUnitTestSuite" jts ON jts.id = jr."testSuiteId"
          INNER JOIN "TestRuns" tr ON tr.id = jts."testRunId" AND tr."isDeleted" = false
          INNER JOIN "Status" s ON s.id = jr."statusId" AND s."systemName" <> 'untested'
          LEFT JOIN "Color" c ON c.id = s."colorId"
          INNER JOIN "User" u ON u.id = jr."createdById"
          INNER JOIN "RepositoryCases" rc ON rc.id = jr."repositoryCaseId"
          INNER JOIN "Projects" p ON p.id = tr."projectId"
          WHERE jr."executedAt" IS NOT NULL
            ${projectScopedJunit}
            ${junitDateFilter}
        )
        SELECT * FROM combined
        ORDER BY ${orderExpr} ${dir} NULLS LAST, origin, id
        ${pageWindow}
      `.execute(baseDb.$qb)
    ).rows;

    // ---- totals + status breakdown (Prisma, mirrored filters) -----------
    const manualWhere: any = {
      isDeleted: false,
      status: { systemName: { not: "untested" } },
      testRun: {
        isDeleted: false,
        ...(!isCrossProject && projectIdNum ? { projectId: projectIdNum } : {}),
      },
    };
    if (startDateVal || endDateVal) {
      manualWhere.executedAt = {
        ...(startDateVal ? { gte: startDateVal } : {}),
        ...(endDateVal ? { lte: endDateVal } : {}),
      };
    }
    const junitWhere: any = {
      statusId: { not: null },
      status: { systemName: { not: "untested" } },
      executedAt:
        startDateVal || endDateVal
          ? {
              ...(startDateVal ? { gte: startDateVal } : {}),
              ...(endDateVal ? { lte: endDateVal } : {}),
            }
          : { not: null },
      testSuite: {
        testRun: {
          isDeleted: false,
          ...(!isCrossProject && projectIdNum
            ? { projectId: projectIdNum }
            : {}),
        },
      },
    };

    const [manualTotal, junitTotal, manualBreakdown, junitBreakdown] =
      await Promise.all([
        baseDb.testRunResults.count({ where: manualWhere }),
        baseDb.jUnitTestResult.count({ where: junitWhere }),
        baseDb.testRunResults.groupBy({
          by: ["statusId"],
          where: manualWhere,
          _count: { id: true },
        }),
        baseDb.jUnitTestResult.groupBy({
          by: ["statusId"],
          where: junitWhere,
          _count: { id: true },
        }),
      ]);
    const total = manualTotal + junitTotal;

    const countByStatus = new Map<number, number>();
    [...manualBreakdown, ...junitBreakdown].forEach((row: any) => {
      if (row.statusId == null) return;
      countByStatus.set(
        row.statusId,
        (countByStatus.get(row.statusId) ?? 0) + row._count.id
      );
    });
    const breakdownStatuses = await baseDb.status.findMany({
      where: { id: { in: [...countByStatus.keys()] } },
      include: { color: true },
    });
    const statusDetailMap = new Map(
      breakdownStatuses.map((s: any) => [s.id, s])
    );
    const statusBreakdown = [...countByStatus.entries()].map(
      ([statusId, count]) => ({
        statusId,
        statusName: statusDetailMap.get(statusId)?.name ?? "Unknown",
        color: statusDetailMap.get(statusId)?.color?.value ?? "#6b7280",
        count,
      })
    );

    // ---- step sub-rows for the page's MANUAL rows -----------------------
    // Steps are recorded against manual results only; automated rows have
    // no step evidence, so they render without an expansion.
    const manualIds = rawRows
      .filter((r) => r.origin === "manual")
      .map((r) => Number(r.id));
    const stepResultsByResultId = new Map<number, any[]>();
    if (manualIds.length > 0) {
      const manualStepRows = await baseDb.testRunResults.findMany({
        where: { id: { in: manualIds } },
        select: {
          id: true,
          stepResults: {
            where: { isDeleted: false },
            select: {
              id: true,
              executedAt: true,
              elapsed: true,
              stepId: true,
              sharedStepItemId: true,
              stepStatus: {
                select: { name: true, color: { select: { value: true } } },
              },
            },
          },
        },
      });
      manualStepRows.forEach((r: any) =>
        stepResultsByResultId.set(r.id, r.stepResults ?? [])
      );
    }

    // Materialise the full step list for every MANUAL test case in the page
    // so sub-rows can include slots that have no TestRunStepResult yet
    // (rendered as Untested). Otherwise the report would silently drop
    // unrecorded steps.
    const testCaseIds = new Set<number>();
    for (const r of rawRows) {
      if (r.origin === "manual") testCaseIds.add(Number(r.case_id));
    }

    const caseSteps: StepRow[] =
      testCaseIds.size > 0
        ? ((await baseDb.steps.findMany({
            where: {
              testCaseId: { in: [...testCaseIds] },
              isDeleted: false,
            },
            select: {
              id: true,
              order: true,
              testCaseId: true,
              sharedStepGroupId: true,
              step: true,
              expectedResult: true,
            },
            orderBy: [{ order: "asc" }, { id: "asc" }],
          })) as StepRow[])
        : [];

    const sharedGroupIds = new Set<number>();
    for (const st of caseSteps) {
      if (st.sharedStepGroupId != null)
        sharedGroupIds.add(st.sharedStepGroupId);
    }

    const [sharedItems, sharedGroups] = await Promise.all([
      sharedGroupIds.size > 0
        ? (baseDb.sharedStepItem.findMany({
            where: { sharedStepGroupId: { in: [...sharedGroupIds] } },
            select: {
              id: true,
              order: true,
              sharedStepGroupId: true,
              step: true,
              expectedResult: true,
            },
            orderBy: [{ order: "asc" }, { id: "asc" }],
          }) as Promise<SharedItemRow[]>)
        : Promise.resolve<SharedItemRow[]>([]),
      sharedGroupIds.size > 0
        ? baseDb.sharedStepGroup.findMany({
            where: { id: { in: [...sharedGroupIds] } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const expectedSlotsByCaseId = buildExpectedSlotsByCaseId(
      caseSteps,
      sharedItems,
      sharedGroups as SharedGroupRow[]
    );

    const data: ExecutionLogRow[] = rawRows.map((r) => {
      const isManual = r.origin === "manual";
      const resultId = Number(r.id);
      let steps: ExecutionLogStepRow[] | undefined;
      if (isManual) {
        const expectedSlots =
          expectedSlotsByCaseId.get(Number(r.case_id)) ?? [];
        const merged = mergeResultsIntoSlots(
          expectedSlots,
          stepResultsByResultId.get(resultId) ?? [],
          resultId
        );
        steps = merged.length > 0 ? merged : undefined;
      }

      return {
        id: isManual ? resultId : -resultId,
        origin: isManual ? "manual" : "automated",
        testCaseId: Number(r.case_id),
        testCaseName: r.case_name,
        testCaseSource: r.case_source,
        testCaseHasParameters: r.case_has_parameters,
        testRunId: Number(r.run_id),
        testRunName: r.run_name,
        testRunIsDeleted: r.run_is_deleted,
        status: {
          name: r.status_name,
          color: r.status_color ?? "#6b7280",
        },
        executedBy: {
          id: r.executed_by_id,
          name: r.executed_by_name,
        },
        executedAt: new Date(r.executed_at).toISOString(),
        elapsed: r.elapsed ?? null,
        testRunCaseVersion: r.test_run_case_version ?? null,
        project: {
          id: Number(r.project_id),
          name: r.project_name,
          iconUrl: r.project_icon,
        },
        steps,
      };
    });

    return Response.json({ data, total, statusBreakdown });
  } catch (e: unknown) {
    console.error("Execution log report error:", e);
    const errorMessage = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
