import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";

const prisma = new PrismaClient();

export type UserDashboardData = {
  untestedStatusId: number | null;
  testRunCasesAssigned: Array<{
    id: number;
    repositoryCaseId: number;
    testRunId: number;
    latestResultStatusId: number | null;
    latestResultIsCompleted: boolean | null;
    caseName: string;
    caseEstimate: number | null;
    caseForecastManual: number | null;
    caseForecastAutomated: number | null;
    runName: string;
    runIsCompleted: boolean;
    runForecastManual: number | null;
    runForecastAutomated: number | null;
    projectId: number;
    projectName: string;
  }>;
  assignedSessions: Array<{
    id: number;
    name: string;
    estimate: number | null;
    forecastManual: number | null;
    forecastAutomated: number | null;
    projectId: number;
    projectName: string;
    totalElapsed: number;
  }>;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only allow users to fetch their own dashboard
    if (session.user.id !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get untested status ID
    const untestedStatus = await prisma.status.findFirst({
      where: {
        systemName: "untested",
        isDeleted: false,
      },
      select: { id: true },
    });

    // Get assigned test run cases with optimized query
    const testRunCases = await prisma.$queryRaw<
      Array<{
        id: number;
        repositoryCaseId: number;
        testRunId: number;
        latestResultStatusId: number | null;
        latestResultIsCompleted: boolean | null;
        caseName: string;
        caseEstimate: number | null;
        caseForecastManual: number | null;
        caseForecastAutomated: number | null;
        runName: string;
        runIsCompleted: boolean;
        runForecastManual: number | null;
        runForecastAutomated: number | null;
        projectId: number;
        projectName: string;
      }>
    >`
      SELECT
        trc.id,
        trc."repositoryCaseId",
        trc."testRunId",
        latest_result."statusId" as "latestResultStatusId",
        latest_result_status."isCompleted" as "latestResultIsCompleted",
        rc.name as "caseName",
        rc.estimate as "caseEstimate",
        rc."forecastManual" as "caseForecastManual",
        rc."forecastAutomated" as "caseForecastAutomated",
        tr.name as "runName",
        tr."isCompleted" as "runIsCompleted",
        tr."forecastManual" as "runForecastManual",
        tr."forecastAutomated" as "runForecastAutomated",
        p.id as "projectId",
        p.name as "projectName"
      FROM "TestRunCases" trc
      JOIN "RepositoryCases" rc ON trc."repositoryCaseId" = rc.id
      JOIN "TestRuns" tr ON trc."testRunId" = tr.id
      JOIN "Projects" p ON tr."projectId" = p.id
      LEFT JOIN LATERAL (
        SELECT trr."statusId"
        FROM "TestRunResults" trr
        WHERE trr."testRunCaseId" = trc.id
          AND trr."isDeleted" = false
        ORDER BY trr."executedAt" DESC
        LIMIT 1
      ) latest_result ON true
      LEFT JOIN "Status" latest_result_status ON latest_result."statusId" = latest_result_status.id
      WHERE trc."assignedToId" = ${userId}
        AND trc."isCompleted" = false
        AND tr."isDeleted" = false
        AND p."isDeleted" = false
      ORDER BY tr.id, trc.id
    `;

    // Get assigned sessions with aggregated elapsed time
    const sessions = await prisma.$queryRaw<
      Array<{
        id: number;
        name: string;
        estimate: number | null;
        forecastManual: number | null;
        forecastAutomated: number | null;
        projectId: number;
        projectName: string;
        totalElapsed: number | null;
      }>
    >`
      SELECT
        s.id,
        s.name,
        s.estimate,
        s."forecastManual",
        s."forecastAutomated",
        p.id as "projectId",
        p.name as "projectName",
        COALESCE(elapsed_sum.total, 0) as "totalElapsed"
      FROM "Sessions" s
      JOIN "Projects" p ON s."projectId" = p.id
      LEFT JOIN LATERAL (
        SELECT SUM(COALESCE(sr.elapsed, 0)) as total
        FROM "SessionResults" sr
        WHERE sr."sessionId" = s.id
          AND sr."isDeleted" = false
      ) elapsed_sum ON true
      WHERE s."assignedToId" = ${userId}
        AND s."isCompleted" = false
        AND s."isDeleted" = false
        AND p."isDeleted" = false
      ORDER BY s.id
    `;

    const response: UserDashboardData = {
      untestedStatusId: untestedStatus?.id || null,
      testRunCasesAssigned: testRunCases,
      assignedSessions: sessions.map((s) => ({
        ...s,
        totalElapsed: Number(s.totalElapsed || 0),
      })),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("User dashboard error:", error);
    return NextResponse.json(
      { error: "Failed to fetch user dashboard data" },
      { status: 500 }
    );
  }
}
