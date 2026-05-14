import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { authenticateRequest } from "~/lib/api-token-auth";
import { authOptions } from "~/server/auth";

export interface ExecutionLogRow {
  id: number;
  testCaseId: number;
  testCaseName: string;
  testCaseSource: string;
  testRunId: number;
  testRunName: string;
  testRunIsDeleted: boolean;
  status: { name: string; color: string };
  executedBy: { id: string; name: string };
  executedAt: string;
  elapsed: number | null;
  testRunCaseVersion: number;
  project?: { id: number; name: string; iconUrl?: string | null };
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
    const orderBy: any = orderByMap[sortColumn] ?? { executedAt: dir };

    const [rawResults, total, rawStatusBreakdown] = await Promise.all([
      prisma.testRunResults.findMany({
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
                select: { id: true, name: true, source: true },
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
        },
        orderBy,
        skip,
        take: pageSizeNum,
      }),
      prisma.testRunResults.count({ where }),
      prisma.testRunResults.groupBy({
        by: ["statusId"],
        where,
        _count: { id: true },
      }),
    ]);

    const breakdownStatusIds = rawStatusBreakdown.map((s: any) => s.statusId);
    const breakdownStatuses = await prisma.status.findMany({
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

    const data: ExecutionLogRow[] = rawResults.map((r: any) => ({
      id: r.id,
      testCaseId: r.testRunCase.repositoryCase.id,
      testCaseName: r.testRunCase.repositoryCase.name,
      testCaseSource: r.testRunCase.repositoryCase.source,
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
    }));

    return Response.json({ data, total, statusBreakdown });
  } catch (e: unknown) {
    console.error("Execution log report error:", e);
    const errorMessage = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
