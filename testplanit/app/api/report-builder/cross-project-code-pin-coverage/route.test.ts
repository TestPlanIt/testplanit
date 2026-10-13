import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/codePinCoverageReportUtils", () => ({
  handleCodePinCoverageReportPOST: vi.fn(),
}));

import { handleCodePinCoverageReportPOST } from "~/utils/codePinCoverageReportUtils";
import { GET, POST } from "./route";

describe("/api/report-builder/cross-project-code-pin-coverage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET returns no dimensions or metrics", async () => {
    expect(await (await GET()).json()).toEqual({ dimensions: [], metrics: [] });
  });

  it("POST delegates with isCrossProject=true", async () => {
    (handleCodePinCoverageReportPOST as any).mockResolvedValue(
      Response.json({ data: [], total: 0 })
    );
    const req = new NextRequest(
      "http://localhost/api/report-builder/cross-project-code-pin-coverage",
      {
        method: "POST",
        body: JSON.stringify({ projectId: 1 }),
        headers: { "Content-Type": "application/json" },
      }
    );
    await POST(req);
    expect(handleCodePinCoverageReportPOST).toHaveBeenCalledWith(req, true);
  });
});
