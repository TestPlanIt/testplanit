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
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("~/utils/testResultTypes", () => ({
  AUTOMATED_TEST_RUN_TYPES: ["JUNIT", "TESTNG", "XUNIT", "NUNIT", "MOCHA", "CUCUMBER"],
}));

import { getServerSession } from "next-auth";
import { prisma } from "~/lib/prisma";

describe("Completed Test Runs API Route", () => {
  const mockSession = {
    user: {
      id: "user-123",
      name: "Test User",
      email: "test@example.com",
      access: "USER",
    },
  };

  const mockRun = {
    id: 1,
    name: "Sprint 1 Regression",
    isCompleted: true,
    testRunType: "REGULAR",
    completedAt: new Date("2024-01-15"),
    createdAt: new Date("2024-01-10"),
    note: null,
    docs: null,
    projectId: 1,
    configId: null,
    milestoneId: null,
    stateId: 1,
    forecastManual: null,
    forecastAutomated: null,
    configuration: null,
    milestone: null,
    state: { id: 1, name: "Done", icon: null, color: { id: 1, value: "#22c55e" } },
    createdBy: { id: "user-123", name: "Test User", email: "test@example.com", image: null },
    project: { id: 1, name: "Test Project", note: null, iconUrl: null },
    tags: [],
    issues: [],
    _count: { testCases: 10, results: 8 },
  };

  const createRequest = (
    searchParams: Record<string, string> = {}
  ): NextRequest => {
    const url = new URL("http://localhost/api/test-runs/completed");
    url.searchParams.set("projectId", searchParams.projectId || "1");
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
    return { nextUrl: url } as unknown as NextRequest;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue(mockSession);
    (prisma.testRuns.count as any).mockResolvedValue(1);
    (prisma.testRuns.findMany as any).mockResolvedValue([mockRun]);
  });

  describe("Authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const request = createRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user", async () => {
      (getServerSession as any).mockResolvedValue({});

      const request = createRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Successful GET", () => {
    it("returns CompletedTestRunsResponse shape", async () => {
      const request = createRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("runs");
      expect(data).toHaveProperty("totalCount");
      expect(data).toHaveProperty("pageCount");
    });

    it("returns correct totalCount and pageCount", async () => {
      (prisma.testRuns.count as any).mockResolvedValue(50);

      const request = createRequest({ projectId: "1", pageSize: "25" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.totalCount).toBe(50);
      expect(data.pageCount).toBe(2);
    });

    it("filters only completed test runs", async () => {
      const request = createRequest({ projectId: "1" });
      await GET(request);

      expect(prisma.testRuns.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isCompleted: true,
            isDeleted: false,
          }),
        })
      );
    });

    it("applies search filter when search param is provided", async () => {
      const request = createRequest({ projectId: "1", search: "sprint" });
      await GET(request);

      const countCall = (prisma.testRuns.count as any).mock.calls[0][0];
      expect(countCall.where).toHaveProperty("name");
      expect(countCall.where.name).toHaveProperty("contains", "sprint");
    });

    it("filters by manual run type when runType=manual", async () => {
      const request = createRequest({ projectId: "1", runType: "manual" });
      await GET(request);

      const countCall = (prisma.testRuns.count as any).mock.calls[0][0];
      expect(countCall.where).toHaveProperty("testRunType", "REGULAR");
    });

    it("filters by automated run types when runType=automated", async () => {
      const request = createRequest({ projectId: "1", runType: "automated" });
      await GET(request);

      const countCall = (prisma.testRuns.count as any).mock.calls[0][0];
      expect(countCall.where.testRunType).toHaveProperty("in");
    });

    it("applies default pagination when not specified", async () => {
      const request = createRequest({ projectId: "1" });
      await GET(request);

      const findCall = (prisma.testRuns.findMany as any).mock.calls[0][0];
      expect(findCall).toHaveProperty("skip", 0);
      expect(findCall).toHaveProperty("take", 25); // default pageSize
    });

    it("applies correct skip for page 2", async () => {
      (prisma.testRuns.count as any).mockResolvedValue(50);

      const request = createRequest({ projectId: "1", page: "2", pageSize: "10" });
      await GET(request);

      const findCall = (prisma.testRuns.findMany as any).mock.calls[0][0];
      expect(findCall).toHaveProperty("skip", 10);
    });

    it("returns runs ordered by completedAt descending", async () => {
      const request = createRequest();
      await GET(request);

      const findCall = (prisma.testRuns.findMany as any).mock.calls[0][0];
      expect(findCall.orderBy).toContainEqual({ completedAt: "desc" });
    });
  });

  describe("Error Handling", () => {
    it("returns 500 when database query fails", async () => {
      (prisma.testRuns.count as any).mockRejectedValue(new Error("DB Error"));

      const request = createRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch completed test runs");
    });
  });
});
