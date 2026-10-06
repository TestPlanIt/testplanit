import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/resultsTrendUtils", () => ({
  handleResultsTrendPOST: vi.fn(),
}));

import { handleResultsTrendPOST } from "~/utils/resultsTrendUtils";
import { GET, POST } from "./route";

describe("/api/report-builder/cross-project-results-trend", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET returns no dimensions or metrics", async () => {
    expect(await (await GET()).json()).toEqual({ dimensions: [], metrics: [] });
  });

  it("POST delegates with isCrossProject=true", async () => {
    (handleResultsTrendPOST as any).mockResolvedValue(
      Response.json({ data: [], total: 0 })
    );
    const req = new NextRequest(
      "http://localhost/api/report-builder/cross-project-results-trend",
      {
        method: "POST",
        body: JSON.stringify({ projectId: 1 }),
        headers: { "Content-Type": "application/json" },
      }
    );
    await POST(req);
    expect(handleResultsTrendPOST).toHaveBeenCalledWith(req, true);
  });
});
