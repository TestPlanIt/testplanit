import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the utility module that handles the actual logic
vi.mock("~/utils/reportApiUtils", () => ({
  handleReportGET: vi.fn(),
  handleReportPOST: vi.fn(),
}));

vi.mock("~/utils/reportUtils", () => ({
  createTestExecutionDimensionRegistry: vi.fn(() => ({})),
  createTestExecutionMetricRegistry: vi.fn(() => ({})),
}));

import { handleReportGET, handleReportPOST } from "~/utils/reportApiUtils";
import { GET, POST } from "./route";

const createGETRequest = (params?: Record<string, string>): NextRequest => {
  const url = new URL("http://localhost/api/report-builder/test-execution");
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url.toString());
};

const createPOSTRequest = (body: Record<string, unknown>): NextRequest => {
  return new NextRequest("http://localhost/api/report-builder/test-execution", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
};

describe("GET /api/report-builder/test-execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to handleReportGET with correct config", async () => {
    (handleReportGET as any).mockResolvedValue(
      Response.json({ dimensions: [], metrics: [] })
    );

    await GET(createGETRequest());

    expect(handleReportGET).toHaveBeenCalledOnce();
    const [, config] = (handleReportGET as any).mock.calls[0];
    expect(config.reportType).toBe("test-execution");
    expect(config.requiresProjectId).toBe(true);
    expect(config.requiresAdmin).toBe(false);
  });

  it("returns dimensions and metrics from handleReportGET", async () => {
    (handleReportGET as any).mockResolvedValue(
      Response.json({
        dimensions: [{ id: "status", label: "Status" }],
        metrics: [{ id: "testResults", label: "Test Results" }],
      })
    );

    const response = await GET(createGETRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.dimensions).toHaveLength(1);
    expect(data.metrics).toHaveLength(1);
  });

  it("returns 400 when projectId is missing and required", async () => {
    (handleReportGET as any).mockResolvedValue(
      Response.json({ error: "Project ID is required" }, { status: 400 })
    );

    const response = await GET(createGETRequest());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Project ID is required");
  });
});

describe("POST /api/report-builder/test-execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to handleReportPOST with correct config", async () => {
    (handleReportPOST as any).mockResolvedValue(
      Response.json({ results: [], totalCount: 0 })
    );

    await POST(createPOSTRequest({ projectId: 1, dimensions: ["status"], metrics: ["testResults"] }));

    expect(handleReportPOST).toHaveBeenCalledOnce();
    const [, config] = (handleReportPOST as any).mock.calls[0];
    expect(config.reportType).toBe("test-execution");
    expect(config.requiresProjectId).toBe(true);
    expect(config.requiresAdmin).toBe(false);
  });

  it("returns 401 when unauthenticated (admin-required routes)", async () => {
    (handleReportPOST as any).mockResolvedValue(
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );

    const response = await POST(createPOSTRequest({}));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 400 when projectId is missing", async () => {
    (handleReportPOST as any).mockResolvedValue(
      Response.json({ error: "Project ID is required" }, { status: 400 })
    );

    const response = await POST(
      createPOSTRequest({ dimensions: ["status"], metrics: ["testResults"] })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Project ID is required");
  });

  it("returns execution metrics on successful POST", async () => {
    (handleReportPOST as any).mockResolvedValue(
      Response.json({
        results: [{ status: { name: "Passed" }, "Test Results Count": 10 }],
        totalCount: 1,
        page: 1,
      })
    );

    const response = await POST(
      createPOSTRequest({
        projectId: 1,
        dimensions: ["status"],
        metrics: ["testResults"],
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.results).toHaveLength(1);
    expect(data.totalCount).toBe(1);
  });
});
