import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ baseDb: {} }));

import {
  collectPanelSessionIds,
  collectPanelTestRunIds,
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
