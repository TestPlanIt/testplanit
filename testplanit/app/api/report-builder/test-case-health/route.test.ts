import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the utility module that handles the actual logic
vi.mock("~/utils/testCaseHealthUtils", () => ({
  handleTestCaseHealthPOST: vi.fn(),
  calculateHealthStatus: vi.fn(),
  calculateIsStale: vi.fn(),
  calculateHealthScore: vi.fn(),
}));

import { handleTestCaseHealthPOST } from "~/utils/testCaseHealthUtils";
import { GET, POST } from "./route";

const _createGETRequest = (): NextRequest => {
  return new NextRequest("http://localhost/api/report-builder/test-case-health");
};

const createPOSTRequest = (body: Record<string, unknown>): NextRequest => {
  return new NextRequest("http://localhost/api/report-builder/test-case-health", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
};

describe("GET /api/report-builder/test-case-health", () => {
  it("returns empty dimensions and metrics arrays", async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.dimensions).toEqual([]);
    expect(data.metrics).toEqual([]);
  });
});

describe("POST /api/report-builder/test-case-health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to handleTestCaseHealthPOST with isCrossProject=false", async () => {
    (handleTestCaseHealthPOST as any).mockResolvedValue(
      Response.json({ data: [], total: 0, page: 1, pageSize: 10, totalCount: 0 })
    );

    await POST(createPOSTRequest({ projectId: 1 }));

    expect(handleTestCaseHealthPOST).toHaveBeenCalledOnce();
    const [, isCrossProject] = (handleTestCaseHealthPOST as any).mock.calls[0];
    expect(isCrossProject).toBe(false);
  });

  it("returns 401 when unauthenticated (cross-project restricted)", async () => {
    (handleTestCaseHealthPOST as any).mockResolvedValue(
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );

    const response = await POST(createPOSTRequest({}));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 400 when projectId is missing", async () => {
    (handleTestCaseHealthPOST as any).mockResolvedValue(
      Response.json({ error: "Project ID is required" }, { status: 400 })
    );

    const response = await POST(createPOSTRequest({}));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Project ID is required");
  });

  it("returns health metric data per test case on successful POST", async () => {
    const mockHealthData = [
      {
        testCaseId: 1,
        testCaseName: "Login Test",
        testCaseSource: "MANUAL",
        createdAt: "2024-01-01T00:00:00Z",
        lastExecutedAt: "2024-02-01T00:00:00Z",
        daysSinceLastExecution: 30,
        totalExecutions: 10,
        passCount: 8,
        failCount: 2,
        passRate: 80,
        healthStatus: "healthy",
        isStale: false,
        healthScore: 85,
      },
    ];

    (handleTestCaseHealthPOST as any).mockResolvedValue(
      Response.json({
        data: mockHealthData,
        total: 1,
        page: 1,
        pageSize: 10,
        totalCount: 1,
      })
    );

    const response = await POST(
      createPOSTRequest({
        projectId: 1,
        staleDaysThreshold: 30,
        minExecutionsForRate: 5,
        lookbackDays: 90,
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data).toHaveLength(1);
    expect(data.total).toBe(1);
    expect(data.data[0].testCaseName).toBe("Login Test");
    expect(data.data[0]).toHaveProperty("healthStatus");
    expect(data.data[0]).toHaveProperty("passRate");
    expect(data.data[0]).toHaveProperty("healthScore");
    expect(data.data[0]).toHaveProperty("isStale");
    expect(data.data[0]).toHaveProperty("daysSinceLastExecution");
  });
});
