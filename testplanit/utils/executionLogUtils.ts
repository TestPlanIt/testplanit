import { baseDb } from "@/lib/db";
import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { authenticateRequest } from "~/lib/api-token-auth";
import { authOptions } from "~/server/auth";
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
  id: number;
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
  testRunCaseVersion: number;
  project?: { id: number; name: string; iconUrl?: string | null };
  steps?: ExecutionLogStepRow[];
}

export async function handleExecutionLogPOST(
  req: NextRequest,
  isCrossProject: boolean
) {
  try {
    if (isCrossProject) {
      const session = await getServerSession(authOptions);
      const auth = await authenticateRequest(req, session);
      if (!auth.authenticated) {
        return Response.json({ error: auth.error }, { status: auth.status });
      }
      if (auth.user.access !== "ADMIN") {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = await req.json();
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

    const testRunWhere: any = { isDeleted: false };
    if (!isCrossProject && projectIdNum) {
      testRunWhere.projectId = projectIdNum;
    }

    const where: any = {
      isDeleted: false,
      testRun: testRunWhere,
    };

    if (startDate || endDate) {
      where.executedAt = {};
      if (startDate) where.executedAt.gte = new Date(startDate);
      if (endDate) where.executedAt.lte = new Date(endDate);
    }

    const dir = sortDirection === "asc" ? "asc" : "desc";
    const orderByMap: Record<string, any> = {
      executedAt: { executedAt: dir },
      testRunCaseVersion: { testRunCaseVersion: dir },
      elapsed: { elapsed: dir },
      statusName: { status: { name: dir } },
      executedBy: { executedBy: { name: dir } },
      testRunName: { testRun: { name: dir } },
      testCaseName: { testRunCase: { repositoryCase: { name: dir } } },
      project: { testRun: { project: { name: dir } } },
    };
    // A stable secondary key (id) makes skip/take pagination deterministic.
    // Without it, ties on the primary key (e.g. many executions sharing an
    // executedAt) let rows shift between pages, so the infinite-scroll loader
    // sees overlaps/gaps and never reaches the true total.
    const orderBy: any = [
      orderByMap[sortColumn] ?? { executedAt: dir },
      { id: dir },
    ];

    const [rawResults, total, rawStatusBreakdown] = await Promise.all([
      baseDb.testRunResults.findMany({
        where,
        select: {
          id: true,
          testRunCaseVersion: true,
          executedAt: true,
          elapsed: true,
          status: {
            select: { name: true, color: { select: { value: true } } },
          },
          executedBy: { select: { id: true, name: true } },
          testRunCase: {
            select: {
              repositoryCase: {
                select: {
                  id: true,
                  name: true,
                  source: true,
                  hasParameters: true,
                },
              },
            },
          },
          testRun: {
            select: {
              id: true,
              name: true,
              isDeleted: true,
              project: { select: { id: true, name: true, iconUrl: true } },
            },
          },
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
        orderBy,
        skip,
        take: pageSizeNum,
      }),
      baseDb.testRunResults.count({ where }),
      baseDb.testRunResults.groupBy({
        by: ["statusId"],
        where,
        _count: { id: true },
      }),
    ]);

    const breakdownStatusIds = rawStatusBreakdown.map((s: any) => s.statusId);
    const breakdownStatuses = await baseDb.status.findMany({
      where: { id: { in: breakdownStatusIds } },
      include: { color: true },
    });
    const statusDetailMap = new Map(
      breakdownStatuses.map((s: any) => [s.id, s])
    );
    const statusBreakdown = rawStatusBreakdown.map((s: any) => ({
      statusId: s.statusId,
      statusName: statusDetailMap.get(s.statusId)?.name ?? "Unknown",
      color: statusDetailMap.get(s.statusId)?.color?.value ?? "#6b7280",
      count: s._count.id,
    }));

    // Materialise the full step list for every test case in the page so
    // sub-rows can include slots that have no TestRunStepResult yet (rendered
    // as Untested). Otherwise the report would silently drop unrecorded steps.
    const testCaseIds = new Set<number>();
    for (const r of rawResults as any[]) {
      testCaseIds.add(r.testRunCase.repositoryCase.id);
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
    for (const s of caseSteps) {
      if (s.sharedStepGroupId != null) sharedGroupIds.add(s.sharedStepGroupId);
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

    const data: ExecutionLogRow[] = rawResults.map((r: any) => {
      const caseId = r.testRunCase.repositoryCase.id;
      const expectedSlots = expectedSlotsByCaseId.get(caseId) ?? [];
      const steps = mergeResultsIntoSlots(
        expectedSlots,
        r.stepResults ?? [],
        r.id
      );

      return {
        id: r.id,
        testCaseId: r.testRunCase.repositoryCase.id,
        testCaseName: r.testRunCase.repositoryCase.name,
        testCaseSource: r.testRunCase.repositoryCase.source,
        testCaseHasParameters: r.testRunCase.repositoryCase.hasParameters,
        testRunId: r.testRun.id,
        testRunName: r.testRun.name,
        testRunIsDeleted: r.testRun.isDeleted,
        status: {
          name: r.status.name,
          color: r.status.color?.value ?? "#6b7280",
        },
        executedBy: {
          id: r.executedBy.id,
          name: r.executedBy.name,
        },
        executedAt: r.executedAt.toISOString(),
        elapsed: r.elapsed ?? null,
        testRunCaseVersion: r.testRunCaseVersion,
        project: r.testRun.project
          ? {
              id: r.testRun.project.id,
              name: r.testRun.project.name,
              iconUrl: r.testRun.project.iconUrl,
            }
          : undefined,
        steps: steps.length > 0 ? steps : undefined,
      };
    });

    return Response.json({ data, total, statusBreakdown });
  } catch (e: unknown) {
    console.error("Execution log report error:", e);
    const errorMessage = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
