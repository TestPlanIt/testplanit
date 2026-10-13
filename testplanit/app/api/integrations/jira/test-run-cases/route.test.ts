import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  baseDb: {
    integration: { findMany: vi.fn() },
    issue: { findMany: vi.fn() },
    testRunCases: { findMany: vi.fn() },
  },
}));

import { baseDb } from "@/lib/db";

import { GET } from "./route";

const FORGE_API_KEY = "test-forge-key";

const buildRequest = (query: string, key = FORGE_API_KEY): NextRequest =>
  new NextRequest(
    `http://localhost/api/integrations/jira/test-run-cases?${query}`,
    { headers: { "X-Forge-Api-Key": key } }
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(baseDb.integration.findMany).mockResolvedValue([
    { id: 1, settings: { forgeApiKey: FORGE_API_KEY } },
  ] as any);
  // Run 7 reaches the issue only through a linked step result.
  vi.mocked(baseDb.issue.findMany).mockResolvedValue([
    {
      testRuns: [],
      testRunResults: [],
      testRunStepResults: [{ testRunResult: { testRunId: 7 } }],
      sessions: [],
      sessionResults: [],
    },
  ] as any);
  vi.mocked(baseDb.testRunCases.findMany).mockResolvedValue([
    {
      id: 70,
      testRunId: 7,
      repositoryCase: { id: 1, name: "A" },
      results: [{ status: { name: "Failed", color: { value: "#f00" } } }],
    },
  ] as any);
});

describe("jira test-run-cases", () => {
  it("returns a linked run's per-case status bar", async () => {
    const response = await GET(
      buildRequest("issueKey=PROJ-1&issueId=1000&testRunId=7")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      displayItems: [
        {
          id: 70,
          testCaseId: 1,
          testCaseName: "A",
          status: { name: "Failed", color: { value: "#f00" } },
          isPending: false,
        },
      ],
    });
    expect(baseDb.testRunCases.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { testRunId: { in: [7] }, isDeleted: false },
      })
    );
  });

  it("refuses a run that is not linked to the issue", async () => {
    const response = await GET(buildRequest("issueKey=PROJ-1&testRunId=8"));

    expect(response.status).toBe(404);
    expect(baseDb.testRunCases.findMany).not.toHaveBeenCalled();
  });

  it("rejects requests without a valid Forge API key", async () => {
    const response = await GET(
      buildRequest("issueKey=PROJ-1&testRunId=7", "wrong-key")
    );

    expect(response.status).toBe(401);
    expect(baseDb.issue.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ["no issue", "testRunId=7"],
    ["no run id", "issueKey=PROJ-1"],
    ["a non-numeric run id", "issueKey=PROJ-1&testRunId=abc"],
  ])("rejects %s", async (_label, query) => {
    const response = await GET(buildRequest(query));

    expect(response.status).toBe(400);
    expect(baseDb.integration.findMany).not.toHaveBeenCalled();
  });
});
