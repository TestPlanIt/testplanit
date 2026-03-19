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
      findMany: vi.fn(),
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

describe("Test Run Summaries (Batch) API Route", () => {
  const mockSession = {
    user: {
      id: "user-123",
      name: "Test User",
      email: "test@example.com",
      access: "USER",
    },
  };

  const mockTestRuns = [
    {
      id: 1,
      testRunType: "REGULAR",
      forecastManual: null,
      projectId: 10,
      state: { workflowType: "IN_PROGRESS" },
      issues: [],
    },
    {
      id: 2,
      testRunType: "REGULAR",
      forecastManual: null,
      projectId: 10,
      state: { workflowType: "DONE" },
      issues: [],
    },
  ];

  const mockStatusCounts = [
    {
      testRunId: 1,
      statusId: 1,
      statusName: "Passed",
      colorValue: "#22c55e",
      count: BigInt(5),
      isCompleted: true,
    },
    {
      testRunId: 2,
      statusId: 2,
      statusName: "Failed",
      colorValue: "#ef4444",
      count: BigInt(2),
      isCompleted: false,
    },
  ];

  const createRequest = (
    searchParams: Record<string, string> = {}
  ): NextRequest => {
    const url = new URL("http://localhost/api/test-runs/summaries");
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
    return { nextUrl: url } as unknown as NextRequest;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue(mockSession);
    (isAutomatedTestRunType as any).mockReturnValue(false);
    (prisma.testRuns.findMany as any).mockResolvedValue(mockTestRuns);
    // $queryRaw called multiple times: comments, status counts, elapsed, estimates, forecasts, case details
    (prisma.$queryRaw as any).mockResolvedValue([]);
  });

  describe("Authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const request = createRequest({ testRunIds: "1,2" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user", async () => {
      (getServerSession as any).mockResolvedValue({});

      const request = createRequest({ testRunIds: "1,2" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Validation", () => {
    it("returns 400 when testRunIds param is missing", async () => {
      const request = createRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("testRunIds parameter is required");
    });

    it("returns 400 when testRunIds contains no valid IDs", async () => {
      const request = createRequest({ testRunIds: "abc,def" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("No valid test run IDs provided");
    });

    it("returns 400 when more than 100 test run IDs are provided", async () => {
      const ids = Array.from({ length: 101 }, (_, i) => i + 1).join(",");
      const request = createRequest({ testRunIds: ids });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Maximum 100 test runs per batch");
    });
  });

  describe("Successful GET", () => {
    it("returns empty summaries object when no test runs found", async () => {
      (prisma.testRuns.findMany as any).mockResolvedValue([]);

      const request = createRequest({ testRunIds: "999" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("summaries");
      expect(data.summaries).toEqual({});
    });

    it("returns summaries keyed by test run ID", async () => {
      // Set up more realistic mock data so summaries are built
      (prisma.$queryRaw as any)
        .mockResolvedValueOnce([]) // comments counts
        .mockResolvedValueOnce(mockStatusCounts) // status counts
        .mockResolvedValueOnce([
          { testRunId: 1, totalElapsed: BigInt(300) },
          { testRunId: 2, totalElapsed: BigInt(150) },
        ]) // elapsed
        .mockResolvedValueOnce([]) // estimates
        .mockResolvedValueOnce([]); // case details

      const request = createRequest({ testRunIds: "1,2" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("summaries");
      // summaries should have entries for both test run IDs
      expect(Object.keys(data.summaries).length).toBeGreaterThan(0);
    });

    it("parses comma-separated test run IDs correctly", async () => {
      const request = createRequest({ testRunIds: "1, 2, 3" });
      await GET(request);

      const findManyCall = (prisma.testRuns.findMany as any).mock.calls[0][0];
      expect(findManyCall.where.id.in).toEqual([1, 2, 3]);
    });

    it("ignores invalid IDs in the list and processes valid ones", async () => {
      const request = createRequest({ testRunIds: "1,abc,2" });
      await GET(request);

      const findManyCall = (prisma.testRuns.findMany as any).mock.calls[0][0];
      expect(findManyCall.where.id.in).toEqual([1, 2]);
    });
  });

  describe("Error Handling", () => {
    it("returns 500 when database query fails", async () => {
      (prisma.testRuns.findMany as any).mockRejectedValue(
        new Error("DB Error")
      );

      const request = createRequest({ testRunIds: "1,2" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch test run summaries");
    });
  });
});
