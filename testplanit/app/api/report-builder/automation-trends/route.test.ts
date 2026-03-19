import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the utility modules that handle the actual logic
vi.mock("~/utils/automationTrendsUtils", () => ({
  handleAutomationTrendsPOST: vi.fn(),
}));

vi.mock("~/utils/reportApiUtils", () => ({
  handleReportGET: vi.fn(),
  handleReportPOST: vi.fn(),
}));

vi.mock("~/utils/reportUtils", () => ({
  createAutomationTrendsDimensionRegistry: vi.fn(() => ({})),
  createAutomationTrendsMetricRegistry: vi.fn(() => ({})),
}));

import { handleAutomationTrendsPOST } from "~/utils/automationTrendsUtils";
import { handleReportGET } from "~/utils/reportApiUtils";
import { GET, POST } from "./route";

const createGETRequest = (params?: Record<string, string>): NextRequest => {
  const url = new URL("http://localhost/api/report-builder/automation-trends");
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url.toString());
};

const createPOSTRequest = (body: Record<string, unknown>): NextRequest => {
  return new NextRequest("http://localhost/api/report-builder/automation-trends", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
};

describe("GET /api/report-builder/automation-trends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to handleReportGET with automation-trends config", async () => {
    (handleReportGET as any).mockResolvedValue(
      Response.json({ dimensions: [], metrics: [] })
    );

    await GET(createGETRequest());

    expect(handleReportGET).toHaveBeenCalledOnce();
    const [, config] = (handleReportGET as any).mock.calls[0];
    expect(config.reportType).toBe("automation-trends");
    expect(config.requiresProjectId).toBe(true);
    expect(config.requiresAdmin).toBe(false);
  });

  it("returns dimension and metric metadata", async () => {
    (handleReportGET as any).mockResolvedValue(
      Response.json({
        dimensions: [{ id: "date", label: "Date" }],
        metrics: [{ id: "automated", label: "Automated" }],
      })
    );

    const response = await GET(createGETRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty("dimensions");
    expect(data).toHaveProperty("metrics");
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

describe("POST /api/report-builder/automation-trends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to handleAutomationTrendsPOST with isCrossProject=false", async () => {
    (handleAutomationTrendsPOST as any).mockResolvedValue(
      Response.json({ data: [], periods: [] })
    );

    await POST(createPOSTRequest({ projectId: 1 }));

    expect(handleAutomationTrendsPOST).toHaveBeenCalledOnce();
    const [, isCrossProject] = (handleAutomationTrendsPOST as any).mock.calls[0];
    expect(isCrossProject).toBe(false);
  });

  it("returns 401 when unauthenticated (cross-project mode requires admin)", async () => {
    (handleAutomationTrendsPOST as any).mockResolvedValue(
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );

    const response = await POST(createPOSTRequest({}));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 400 when projectId is missing", async () => {
    (handleAutomationTrendsPOST as any).mockResolvedValue(
      Response.json({ error: "Project ID is required" }, { status: 400 })
    );

    const response = await POST(createPOSTRequest({}));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Project ID is required");
  });

  it("returns automation trend data over time periods on successful POST", async () => {
    const mockTrendData = {
      data: [
        {
          periodStart: "2024-01-01T00:00:00Z",
          periodEnd: "2024-01-07T23:59:59Z",
          "Project A": 15,
          "Project A - Manual": 5,
          "Project A - Automated": 10,
        },
        {
          periodStart: "2024-01-08T00:00:00Z",
          periodEnd: "2024-01-14T23:59:59Z",
          "Project A": 20,
          "Project A - Manual": 8,
          "Project A - Automated": 12,
        },
      ],
      periods: ["2024-01-01T00:00:00Z", "2024-01-08T00:00:00Z"],
      projects: [{ id: 1, name: "Project A" }],
    };

    (handleAutomationTrendsPOST as any).mockResolvedValue(
      Response.json(mockTrendData)
    );

    const response = await POST(
      createPOSTRequest({
        projectId: 1,
        dateGrouping: "weekly",
        startDate: "2024-01-01T00:00:00Z",
        endDate: "2024-01-31T23:59:59Z",
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data).toHaveLength(2);
    expect(data.data[0]).toHaveProperty("periodStart");
    expect(data.data[0]).toHaveProperty("periodEnd");
    expect(data).toHaveProperty("periods");
  });
});
