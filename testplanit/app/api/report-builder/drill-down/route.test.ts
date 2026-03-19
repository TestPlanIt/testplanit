import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing route handler
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    status: { findMany: vi.fn() },
  },
}));

vi.mock("~/utils/drillDownQueryBuilders", () => ({
  getModelForMetric: vi.fn(),
  getQueryBuilderForMetric: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { getModelForMetric, getQueryBuilderForMetric } from "~/utils/drillDownQueryBuilders";
import { POST } from "./route";

const createRequest = (body: Record<string, unknown>): NextRequest => {
  return new NextRequest("http://localhost/api/report-builder/drill-down", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
};

const mockSession = {
  user: { id: "user-1", name: "Test User", access: "USER" },
};

const mockAdminSession = {
  user: { id: "admin-1", name: "Admin User", access: "ADMIN" },
};

const validDrillDownContext = {
  metricId: "testResults",
  reportType: "test-execution",
  projectId: 1,
};

describe("POST /api/report-builder/drill-down", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: mock a model with findMany, count, groupBy
    const mockModel = {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 1,
          testRunCase: { repositoryCase: { name: "Login Test" } },
          executedAt: "2024-01-01T00:00:00Z",
        },
      ]),
      count: vi.fn().mockResolvedValue(1),
      groupBy: vi.fn().mockResolvedValue([]),
    };

    (getModelForMetric as any).mockReturnValue("testRunResults");
    (getQueryBuilderForMetric as any).mockReturnValue(() => ({
      where: { testRun: { projectId: 1 } },
      include: { testRunCase: true },
    }));

    // Inject mockModel by mocking prisma as dynamic
    (prisma as any).testRunResults = mockModel;

    (prisma.status.findMany as any).mockResolvedValue([]);
  });

  describe("Authentication", () => {
    it("returns 401 when no session", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const response = await POST(createRequest({ context: validDrillDownContext }));
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Validation", () => {
    it("returns 400 when context is missing", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(createRequest({}));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("drill-down context");
    });

    it("returns 400 when context.metricId is missing", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(
        createRequest({ context: { reportType: "test-execution" } })
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("drill-down context");
    });

    it("returns 400 when context.reportType is missing", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(
        createRequest({ context: { metricId: "testResults" } })
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("drill-down context");
    });

    it("returns 403 when cross-project mode and user is not admin", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(
        createRequest({
          context: {
            ...validDrillDownContext,
            mode: "cross-project",
          },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain("Admin access required");
    });
  });

  describe("Successful drill-down", () => {
    it("returns drill-down data with correct shape", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(
        createRequest({ context: validDrillDownContext })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("data");
      expect(data).toHaveProperty("total");
      expect(data).toHaveProperty("hasMore");
      expect(data).toHaveProperty("context");
      expect(Array.isArray(data.data)).toBe(true);
    });

    it("returns correct total and hasMore=false when all records fit", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(
        createRequest({ context: validDrillDownContext, offset: 0, limit: 50 })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.total).toBe(1);
      expect(data.hasMore).toBe(false);
    });

    it("returns hasMore=true when more records exist beyond limit", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      // Mock: 10 items returned, total is 100
      const mockModel = (prisma as any).testRunResults;
      mockModel.findMany.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({ id: i + 1, testRunCase: null }))
      );
      mockModel.count.mockResolvedValue(100);

      const response = await POST(
        createRequest({ context: validDrillDownContext, offset: 0, limit: 10 })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.total).toBe(100);
      expect(data.hasMore).toBe(true);
    });

    it("transforms test result records to include name field from repositoryCase", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(
        createRequest({ context: validDrillDownContext })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data[0].name).toBe("Login Test");
    });

    it("allows admin user to perform cross-project drill-down", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const response = await POST(
        createRequest({
          context: {
            ...validDrillDownContext,
            mode: "cross-project",
          },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("data");
    });

    it("returns 400 when model name is invalid", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (getModelForMetric as any).mockReturnValue("nonExistentModel");

      const response = await POST(
        createRequest({ context: validDrillDownContext })
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid model");
    });

    it("includes passRate aggregates when metricId is passRate", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const mockModel = (prisma as any).testRunResults;
      mockModel.groupBy = vi.fn().mockResolvedValue([
        { statusId: 1, _count: { id: 3 } },
        { statusId: 2, _count: { id: 1 } },
      ]);

      (prisma.status.findMany as any).mockResolvedValue([
        { id: 1, name: "Passed", color: { value: "#22c55e" } },
        { id: 2, name: "Failed", color: { value: "#ef4444" } },
      ]);

      const response = await POST(
        createRequest({
          context: {
            metricId: "passRate",
            reportType: "test-execution",
            projectId: 1,
          },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("aggregates");
      expect(data.aggregates).toHaveProperty("passRate");
      expect(data.aggregates).toHaveProperty("statusCounts");
    });
  });
});
