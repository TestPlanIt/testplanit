import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the utility module that handles the actual logic
vi.mock("~/utils/flakyTestsUtils", () => ({
  handleFlakyTestsPOST: vi.fn(),
}));

import { handleFlakyTestsPOST } from "~/utils/flakyTestsUtils";
import { GET, POST } from "./route";

const _createGETRequest = (): NextRequest => {
  return new NextRequest("http://localhost/api/report-builder/flaky-tests");
};

const createPOSTRequest = (body: Record<string, unknown>): NextRequest => {
  return new NextRequest("http://localhost/api/report-builder/flaky-tests", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
};

describe("GET /api/report-builder/flaky-tests", () => {
  it("returns empty dimensions and metrics arrays", async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.dimensions).toEqual([]);
    expect(data.metrics).toEqual([]);
  });
});

describe("POST /api/report-builder/flaky-tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to handleFlakyTestsPOST with isCrossProject=false", async () => {
    (handleFlakyTestsPOST as any).mockResolvedValue(
      Response.json({ data: [], total: 0, consecutiveRuns: 10, flipThreshold: 5 })
    );

    await POST(createPOSTRequest({ projectId: 1 }));

    expect(handleFlakyTestsPOST).toHaveBeenCalledOnce();
    const [, isCrossProject] = (handleFlakyTestsPOST as any).mock.calls[0];
    expect(isCrossProject).toBe(false);
  });

  it("returns 401 when unauthenticated for cross-project (via utility)", async () => {
    (handleFlakyTestsPOST as any).mockResolvedValue(
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );

    const response = await POST(createPOSTRequest({}));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 400 when projectId is missing", async () => {
    (handleFlakyTestsPOST as any).mockResolvedValue(
      Response.json({ error: "Project ID is required" }, { status: 400 })
    );

    const response = await POST(createPOSTRequest({}));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Project ID is required");
  });

  it("returns flaky test data on successful POST", async () => {
    const mockFlakyData = [
      {
        testCaseId: 1,
        testCaseName: "Login Test",
        testCaseSource: "MANUAL",
        flipCount: 3,
        executions: [
          { resultId: 1, testRunId: 1, statusName: "Passed", statusColor: "#22c55e", isSuccess: true, isFailure: false, executedAt: "2024-01-01T00:00:00Z" },
          { resultId: 2, testRunId: 1, statusName: "Failed", statusColor: "#ef4444", isSuccess: false, isFailure: true, executedAt: "2024-01-02T00:00:00Z" },
        ],
      },
    ];

    (handleFlakyTestsPOST as any).mockResolvedValue(
      Response.json({
        data: mockFlakyData,
        total: 1,
        consecutiveRuns: 10,
        flipThreshold: 2,
      })
    );

    const response = await POST(
      createPOSTRequest({ projectId: 1, consecutiveRuns: 10, flipThreshold: 2 })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data).toHaveLength(1);
    expect(data.total).toBe(1);
    expect(data.data[0].testCaseName).toBe("Login Test");
    expect(data.data[0].flipCount).toBe(3);
    expect(data.data[0].executions).toHaveLength(2);
    expect(data).toHaveProperty("consecutiveRuns");
    expect(data).toHaveProperty("flipThreshold");
  });
});
