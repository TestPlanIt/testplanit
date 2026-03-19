import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    testRuns: {
      findUnique: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("~/utils/testResultTypes", () => ({
  isAutomatedTestRunType: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { prisma } from "~/lib/prisma";
import { isAutomatedTestRunType } from "~/utils/testResultTypes";

describe("Test Run Summary API Route", () => {
  const mockSession = {
    user: {
      id: "user-123",
      name: "Test User",
      email: "test@example.com",
      access: "USER",
    },
  };

  const mockTestRun = {
    id: 1,
    testRunType: "REGULAR",
    forecastManual: null,
    projectId: 10,
    state: { workflowType: "IN_PROGRESS" },
    issues: [],
  };

  const mockStatusCounts = [
    {
      statusId: 1,
      statusName: "Passed",
      colorValue: "#22c55e",
      count: BigInt(5),
      isCompleted: true,
    },
    {
      statusId: null,
      statusName: "Pending",
      colorValue: "#9ca3af",
      count: BigInt(3),
      isCompleted: null,
    },
  ];

  const mockElapsedResult = [{ totalElapsed: BigInt(1200) }];
  const mockEstimateResult = [{ totalEstimate: BigInt(600) }];
  const mockCommentsCount = [{ count: BigInt(2) }];

  const createRequest = (
    testRunId: string = "1",
    searchParams: Record<string, string> = {}
  ): [NextRequest, { params: Promise<{ testRunId: string }> }] => {
    const url = new URL(
      `http://localhost/api/test-runs/${testRunId}/summary`
    );
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
    const request = { nextUrl: url } as unknown as NextRequest;
    return [request, { params: Promise.resolve({ testRunId }) }];
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue(mockSession);
    (prisma.testRuns.findUnique as any).mockResolvedValue(mockTestRun);
    (isAutomatedTestRunType as any).mockReturnValue(false);
    (prisma.$queryRaw as any)
      .mockResolvedValueOnce(mockCommentsCount) // comments count
      .mockResolvedValueOnce(mockStatusCounts) // status counts
      .mockResolvedValueOnce(mockElapsedResult) // elapsed
      .mockResolvedValueOnce(mockEstimateResult); // estimate
  });

  describe("Authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user", async () => {
      (getServerSession as any).mockResolvedValue({});

      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Validation", () => {
    it("returns 400 for invalid (non-numeric) test run ID", async () => {
      const [request, context] = createRequest("not-a-number");
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid test run ID");
    });
  });

  describe("Not Found", () => {
    it("returns 404 when test run does not exist", async () => {
      (prisma.testRuns.findUnique as any).mockResolvedValue(null);

      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Test run not found");
    });
  });

  describe("Successful GET - Regular Run", () => {
    it("returns TestRunSummaryData shape for regular run", async () => {
      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("testRunType", "REGULAR");
      expect(data).toHaveProperty("statusCounts");
      expect(data).toHaveProperty("completionRate");
      expect(data).toHaveProperty("totalElapsed");
      expect(data).toHaveProperty("totalEstimate");
      expect(data).toHaveProperty("commentsCount");
      expect(data).toHaveProperty("issues");
    });

    it("returns workflowType from test run state", async () => {
      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workflowType).toBe("IN_PROGRESS");
    });

    it("calculates completionRate correctly", async () => {
      // 5 completed out of 8 total = 62.5%
      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.completionRate).toBeCloseTo(62.5, 1);
    });

    it("converts BigInt elapsed to number", async () => {
      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.totalElapsed).toBe(1200);
      expect(typeof data.totalElapsed).toBe("number");
    });

    it("converts BigInt commentsCount to number", async () => {
      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.commentsCount).toBe(2);
      expect(typeof data.commentsCount).toBe("number");
    });

    it("includes issues with projectIds array", async () => {
      const testRunWithIssues = {
        ...mockTestRun,
        issues: [
          {
            id: 5,
            name: "BUG-001",
            title: "Test bug",
            externalId: null,
            externalKey: null,
            externalUrl: null,
            externalStatus: null,
            data: null,
            integrationId: null,
            lastSyncedAt: null,
            issueTypeName: null,
            issueTypeIconUrl: null,
            integration: null,
          },
        ],
      };
      (prisma.testRuns.findUnique as any).mockResolvedValue(testRunWithIssues);

      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.issues).toHaveLength(1);
      expect(data.issues[0].projectIds).toEqual([10]);
    });

    it("uses forecastManual when set instead of computed estimate", async () => {
      const testRunWithForecast = {
        ...mockTestRun,
        forecastManual: 9999,
      };
      (prisma.testRuns.findUnique as any).mockResolvedValue(testRunWithForecast);

      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.totalEstimate).toBe(9999);
    });
  });

  describe("JUnit Run", () => {
    const mockJUnitAggregates = [
      {
        statusId: null,
        statusName: null,
        colorValue: null,
        type: "PASSED",
        count: BigInt(10),
      },
      {
        statusId: null,
        statusName: null,
        colorValue: null,
        type: "FAILURE",
        count: BigInt(3),
      },
      {
        statusId: null,
        statusName: null,
        colorValue: null,
        type: "SKIPPED",
        count: BigInt(2),
      },
    ];

    const mockJUnitTime = [{ totalTime: 45.5 }];

    beforeEach(() => {
      (isAutomatedTestRunType as any).mockReturnValue(true);
      (prisma.testRuns.findUnique as any).mockResolvedValue({
        ...mockTestRun,
        testRunType: "JUNIT",
      });
      // Reset and re-mock for JUnit queries
      (prisma.$queryRaw as any)
        .mockReset()
        .mockResolvedValueOnce(mockCommentsCount) // comments count
        .mockResolvedValueOnce(mockJUnitAggregates) // result aggregates
        .mockResolvedValueOnce(mockJUnitTime); // total time
    });

    it("returns junitSummary for automated test runs", async () => {
      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("junitSummary");
      expect(data.junitSummary).toHaveProperty("totalTests");
      expect(data.junitSummary).toHaveProperty("totalFailures");
      expect(data.junitSummary).toHaveProperty("totalErrors");
      expect(data.junitSummary).toHaveProperty("totalSkipped");
      expect(data.junitSummary).toHaveProperty("totalTime");
      expect(data.junitSummary).toHaveProperty("resultSegments");
    });

    it("calculates junit totals correctly", async () => {
      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.junitSummary.totalTests).toBe(15); // 10+3+2
      expect(data.junitSummary.totalFailures).toBe(3);
      expect(data.junitSummary.totalSkipped).toBe(2);
      expect(data.junitSummary.totalErrors).toBe(0);
    });
  });

  describe("Error Handling", () => {
    it("returns 500 when database query fails", async () => {
      (prisma.testRuns.findUnique as any).mockRejectedValue(
        new Error("DB Error")
      );

      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch test run summary");
    });
  });
});
