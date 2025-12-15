import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { AUTOMATED_TEST_RUN_TYPES } from "~/utils/testResultTypes";

const prisma = new PrismaClient();

export type CompletedTestRunsResponse = {
  runs: Array<{
    id: number;
    name: string;
    isCompleted: boolean;
    testRunType: string;
    completedAt: Date | null;
    createdAt: Date;
    note: Prisma.JsonValue | null;
    docs: Prisma.JsonValue | null;
    projectId: number;
    configId: number | null;
    milestoneId: number | null;
    stateId: number | null;
    forecastManual: number | null;
    forecastAutomated: number | null;
    configuration: {
      id: number;
      name: string;
    } | null;
    milestone: {
      id: number;
      name: string;
      milestoneType: {
        id: number;
        name: string;
        icon: {
          id: number;
          name: string;
        } | null;
      } | null;
      children: Array<{
        id: number;
        name: string;
        milestoneType: {
          id: number;
          name: string;
        } | null;
      }>;
    } | null;
    state: {
      id: number;
      name: string;
      icon: {
        id: number;
        name: string;
      } | null;
      color: {
        id: number;
        value: string;
      } | null;
    } | null;
    createdBy: {
      id: string;
      name: string;
      email: string;
      image: string | null;
    } | null;
    project: {
      id: number;
      name: string;
      note: string | null;
      iconUrl: string | null;
    };
    tags: Array<{
      id: number;
      name: string;
    }>;
    issues: Array<{
      id: number;
      name: string;
      externalId: string | null;
    }>;
    _count: {
      testCases: number;
      results: number;
    };
  }>;
  totalCount: number;
  pageCount: number;
};

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = req.nextUrl.searchParams;
    const projectId = Number(searchParams.get("projectId"));
    const page = Number(searchParams.get("page")) || 1;
    const pageSize = Number(searchParams.get("pageSize")) || 25;
    const search = searchParams.get("search") || "";
    const runType = searchParams.get("runType") || "both"; // both, manual, automated

    if (isNaN(projectId)) {
      return NextResponse.json(
        { error: "Invalid project ID" },
        { status: 400 }
      );
    }

    // Build where clause
    const where: any = {
      projectId,
      isCompleted: true,
      isDeleted: false,
    };

    // Add search filter
    if (search.trim()) {
      where.name = {
        contains: search,
        mode: "insensitive",
      };
    }

    // Add run type filter
    if (runType === "manual") {
      where.testRunType = "REGULAR";
    } else if (runType === "automated") {
      where.testRunType = { in: AUTOMATED_TEST_RUN_TYPES };
    }

    // Get total count for pagination
    const totalCount = await prisma.testRuns.count({ where });

    // Calculate pagination
    const skip = (page - 1) * pageSize;
    const pageCount = Math.ceil(totalCount / pageSize);

    // Fetch paginated runs with optimized select
    const runs = await prisma.testRuns.findMany({
      where,
      orderBy: [{ completedAt: "desc" }],
      skip,
      take: pageSize,
      select: {
        id: true,
        name: true,
        isCompleted: true,
        testRunType: true,
        completedAt: true,
        createdAt: true,
        note: true,
        docs: true,
        projectId: true,
        configId: true,
        milestoneId: true,
        stateId: true,
        forecastManual: true,
        forecastAutomated: true,
        configuration: {
          select: {
            id: true,
            name: true,
          },
        },
        milestone: {
          select: {
            id: true,
            name: true,
            milestoneType: {
              select: {
                id: true,
                name: true,
                icon: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
            children: {
              select: {
                id: true,
                name: true,
                milestoneType: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
        state: {
          select: {
            id: true,
            name: true,
            icon: {
              select: {
                id: true,
                name: true,
              },
            },
            color: {
              select: {
                id: true,
                value: true,
              },
            },
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
            note: true,
            iconUrl: true,
          },
        },
        tags: {
          select: {
            id: true,
            name: true,
          },
        },
        issues: {
          select: {
            id: true,
            name: true,
            externalId: true,
          },
        },
        _count: {
          select: {
            testCases: true,
            results: true,
          },
        },
      },
    });

    const response: CompletedTestRunsResponse = {
      runs,
      totalCount,
      pageCount,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Completed test runs error:", error);
    return NextResponse.json(
      { error: "Failed to fetch completed test runs" },
      { status: 500 }
    );
  }
}
