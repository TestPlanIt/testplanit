import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock("~/lib/db", () => ({ baseDb: { $queryRaw: queryRaw } }));

import { getProjectCardStats } from "./projectCardStats";

/** The three queries run in a fixed order: issues, activity, pending. */
function answer(
  rows: {
    issues?: unknown[];
    activity?: unknown[];
    pending?: unknown[];
  } = {}
) {
  queryRaw
    .mockResolvedValueOnce(rows.issues ?? [])
    .mockResolvedValueOnce(rows.activity ?? [])
    .mockResolvedValueOnce(rows.pending ?? []);
}

beforeEach(() => {
  queryRaw.mockReset();
});

describe("getProjectCardStats", () => {
  it("runs nothing for an empty list", async () => {
    expect(await getProjectCardStats([], "user-1")).toEqual({});
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("gives every requested project an entry, even with nothing to report", async () => {
    answer();

    expect(await getProjectCardStats([1, 2], "user-1")).toEqual({
      1: { issues: 0, lastActivityAt: null, myPending: 0 },
      2: { issues: 0, lastActivityAt: null, myPending: 0 },
    });
  });

  it("folds the rows of each query into its project", async () => {
    answer({
      issues: [{ projectId: 1, issueCount: 38n }],
      activity: [
        { projectId: 1, lastActivityAt: new Date("2026-06-15T09:30:00Z") },
      ],
      pending: [{ projectId: 2, pending: 4n }],
    });

    const stats = await getProjectCardStats([1, 2], "user-1");

    expect(stats[1]).toEqual({
      issues: 38,
      lastActivityAt: "2026-06-15T09:30:00.000Z",
      myPending: 0,
    });
    expect(stats[2]).toEqual({
      issues: 0,
      lastActivityAt: null,
      myPending: 4,
    });
  });

  it("ignores a row for a project that was not asked for", async () => {
    answer({
      issues: [{ projectId: 9, issueCount: 5n }],
      pending: [{ projectId: 9, pending: 2n }],
    });

    expect(Object.keys(await getProjectCardStats([1], "user-1"))).toEqual([
      "1",
    ]);
  });

  it("asks for the viewer's own pending cases", async () => {
    answer();

    await getProjectCardStats([1], "viewer-7");

    const pendingCall = queryRaw.mock.calls[2];
    expect(pendingCall.slice(1)).toEqual(["viewer-7", [1]]);
  });
});
