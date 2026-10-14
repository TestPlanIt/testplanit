import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ baseDb: {} }));

vi.mock("~/lib/services/testRunSummary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/services/testRunSummary")>()),
  getTestRunSummary: vi.fn(),
}));

import { getTestRunSummary } from "~/lib/services/testRunSummary";

import {
  collectPanelSessionIds,
  collectPanelTestRunIds,
  loadPanelRunSummaries,
} from "./jiraForgePanel";

const issue = (links: Record<string, unknown>) => ({
  testRuns: [],
  testRunResults: [],
  testRunStepResults: [],
  sessions: [],
  sessionResults: [],
  ...links,
});

describe("collectPanelTestRunIds", () => {
  it("dedupes runs across link paths and duplicate issues, direct links first", () => {
    expect(
      collectPanelTestRunIds([
        issue({
          testRuns: [{ id: 3 }],
          testRunResults: [{ testRunId: 5 }, { testRunId: 3 }],
          testRunStepResults: [
            { testRunResult: { testRunId: 9 } },
            { testRunResult: null },
          ],
        }),
        issue({
          testRuns: [{ id: 4 }],
          testRunResults: [{ testRunId: 5 }],
        }),
      ] as any)
    ).toEqual([3, 4, 5, 9]);
  });
});

describe("collectPanelSessionIds", () => {
  it("dedupes sessions, direct links before result links", () => {
    expect(
      collectPanelSessionIds([
        issue({
          sessions: [{ id: 2 }],
          sessionResults: [{ sessionId: 6 }, { sessionId: 2 }],
        }),
        issue({ sessions: [{ id: 6 }, { id: 1 }] }),
      ] as any)
    ).toEqual([2, 6, 1]);
  });
});

describe("loadPanelRunSummaries", () => {
  it("counts a hybrid run by the statuses its automated results set", async () => {
    // Automation wrote every status; nobody recorded a manual result, so the
    // service's isPending (no manual result) is true for every case.
    vi.mocked(getTestRunSummary).mockResolvedValue({
      totalCases: 3,
      statusCounts: [
        {
          statusId: 2,
          statusName: "Passed",
          colorValue: "#0f0",
          count: 2,
          isSuccess: true,
        },
        {
          statusId: 3,
          statusName: "Failed",
          colorValue: "#f00",
          count: 1,
          isFailure: true,
        },
      ],
      caseDetails: [1, 2, 3].map((id) => ({
        id,
        repositoryCaseId: id * 10,
        caseName: `Case ${id}`,
        statusId: id === 3 ? 3 : 2,
        statusName: id === 3 ? "Failed" : "Passed",
        colorValue: id === 3 ? "#f00" : "#0f0",
        isPending: true,
      })),
    } as any);

    const run = (await loadPanelRunSummaries([7], true)).get(7)!;

    expect(run).toMatchObject({
      total: 3,
      passedCount: 2,
      summaryText: "2 Passed, 1 Failed",
    });
    expect(run.displayItems!.map((item) => item.status.name)).toEqual([
      "Passed",
      "Passed",
      "Failed",
    ]);
    expect(run.displayItems!.every((item) => !item.isPending)).toBe(true);
  });

  it("draws a pure automated run's bar from its result counts, capped", async () => {
    vi.mocked(getTestRunSummary).mockResolvedValue({
      totalCases: 4000,
      statusCounts: [
        {
          statusId: 2,
          statusName: "Passed",
          colorValue: "#0f0",
          count: 3998,
          isSuccess: true,
        },
        { statusId: 3, statusName: "Failed", colorValue: "#f00", count: 2 },
      ],
    } as any);

    const run = (await loadPanelRunSummaries([9], true)).get(9)!;
    const failed = run.displayItems!.filter((i) => i.status.name === "Failed");

    expect(run).toMatchObject({ total: 4000, passedCount: 3998 });
    expect(run.displayItems!.length).toBeLessThanOrEqual(1001);
    // A status too small to round to a segment still gets one.
    expect(failed).toHaveLength(1);
  });
});
