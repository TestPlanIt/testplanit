import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/impactAnalysisReportUtils", () => ({
  handleImpactAnalysisReportPOST: vi.fn(),
}));

import { handleImpactAnalysisReportPOST } from "~/utils/impactAnalysisReportUtils";
import { GET, POST } from "./route";

describe("/api/report-builder/cross-project-impact-analysis", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET returns no dimensions or metrics", async () => {
    const data = await (await GET()).json();
    expect(data).toEqual({ dimensions: [], metrics: [] });
  });

  it("POST delegates with isCrossProject=true", async () => {
    (handleImpactAnalysisReportPOST as any).mockResolvedValue(
      Response.json({ data: [], total: 0 })
    );
    const req = new NextRequest(
      "http://localhost/api/report-builder/cross-project-impact-analysis",
      {
        method: "POST",
        body: JSON.stringify({ projectId: 1 }),
        headers: { "Content-Type": "application/json" },
      }
    );
    await POST(req);
    expect(handleImpactAnalysisReportPOST).toHaveBeenCalledWith(req, true);
  });
});
