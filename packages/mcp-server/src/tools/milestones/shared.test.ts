import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestPlanItHttpError } from "../../http.js";
import {
  computeStatusRollup,
  fetchDescendantCounts,
  mapMilestoneRow,
  mergeMilestoneStatusGroups,
  MILESTONE_LINKED_TEST_RUNS_CAP,
  MILESTONE_LINKED_SESSIONS_CAP,
  MILESTONE_CHILDREN_CAP,
  type RawMilestoneRow,
} from "./shared.js";

const env = {
  apiUrl: "https://testplanit.example.com",
  apiToken: "tpi_testtoken",
};

function rawRow(overrides: Partial<RawMilestoneRow> = {}): RawMilestoneRow {
  return {
    id: 1,
    name: "Sprint 1",
    isStarted: true,
    isCompleted: false,
    automaticCompletion: false,
    startedAt: null,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    parentId: null,
    milestoneType: { id: 5, name: "Sprint" },
    creator: { id: "u1", name: "Alice", email: "a@b" },
    _count: { children: 0, comments: 0 },
    testRuns: [],
    sessions: [],
    ...overrides,
  };
}

describe("milestones shared helpers", () => {
  describe("constants", () => {
    it("inline caps match the documented ceilings (250 / 100 / 100)", () => {
      expect(MILESTONE_LINKED_TEST_RUNS_CAP).toBe(250);
      expect(MILESTONE_LINKED_SESSIONS_CAP).toBe(100);
      expect(MILESTONE_CHILDREN_CAP).toBe(100);
    });
  });

  describe("mapMilestoneRow", () => {
    it("maps _count.children to directChildrenCount and _count.comments to commentCount", () => {
      const out = mapMilestoneRow(
        rawRow({ _count: { children: 3, comments: 2 } }),
        { totalDescendants: 7, rollup: { statusCounts: [], untested: 0, total: 0 } },
      );
      expect(out.directChildrenCount).toBe(3);
      expect(out.commentCount).toBe(2);
      expect(out.totalDescendants).toBe(7);
    });

    it("returns milestoneType as exactly {id,name} with no icon key on the milestoneType object", () => {
      const out = mapMilestoneRow(
        rawRow({ milestoneType: { id: 5, name: "Release" } }),
        { totalDescendants: 0, rollup: { statusCounts: [], untested: 0, total: 0 } },
      );
      expect(out.milestoneType).toEqual({ id: 5, name: "Release" });
      // Defensive ABSENCE assertion — schema-only icon fields must not leak.
      expect(out.milestoneType).not.toHaveProperty("iconName");
      expect(out.milestoneType).not.toHaveProperty("iconUrl");
      expect(out.milestoneType).not.toHaveProperty("icon");
    });

    it("returns creator as {id,name,email} and falls back to null when raw.creator is null", () => {
      const out = mapMilestoneRow(rawRow(), {
        totalDescendants: 0,
        rollup: { statusCounts: [], untested: 0, total: 0 },
      });
      expect(out.creator).toEqual({ id: "u1", name: "Alice", email: "a@b" });

      const orphan = mapMilestoneRow(rawRow({ creator: null }), {
        totalDescendants: 0,
        rollup: { statusCounts: [], untested: 0, total: 0 },
      });
      expect(orphan.creator).toBeNull();
    });

    it("inlines rollup statusCounts + untested + total straight from the StatusRollup", () => {
      const rollup = {
        statusCounts: [
          { id: 1, name: "Passed", count: 4 },
          { id: 2, name: "Failed", count: 1 },
        ],
        untested: 2,
        total: 7,
      };
      const out = mapMilestoneRow(rawRow(), { totalDescendants: 3, rollup });
      expect(out.statusCounts).toEqual(rollup.statusCounts);
      expect(out.untested).toBe(2);
      expect(out.total).toBe(7);
    });
  });

  describe("mergeMilestoneStatusGroups", () => {
    it("sums the same statusId across run + session groups into one StatusGroup per milestone", () => {
      const merged = mergeMilestoneStatusGroups({
        runGroups: [
          { testRunId: 10, statusId: 1, _count: { id: 5 } },
          { testRunId: 11, statusId: 1, _count: { id: 3 } },
        ],
        sessionGroups: [
          { sessionId: 50, statusId: 1, _count: { id: 2 } },
        ],
        runIdToMilestoneId: new Map([
          [10, 100],
          [11, 100],
        ]),
        sessionIdToMilestoneId: new Map([[50, 100]]),
      });
      const groups = merged.get(100) ?? [];
      // After merge: milestone 100 has statusId=1 → 5 + 3 + 2 = 10
      expect(groups).toHaveLength(1);
      expect(groups[0]).toEqual({
        statusId: 1,
        _count: { id: 10 },
      });
    });

    it("preserves null statusId entries from run groups so they contribute to untested via computeStatusRollup", () => {
      const merged = mergeMilestoneStatusGroups({
        runGroups: [
          { testRunId: 10, statusId: null, _count: { id: 4 } },
          { testRunId: 10, statusId: 1, _count: { id: 6 } },
        ],
        sessionGroups: [],
        runIdToMilestoneId: new Map([[10, 100]]),
        sessionIdToMilestoneId: new Map(),
      });
      const groups = merged.get(100) ?? [];
      const nullEntry = groups.find((g) => g.statusId === null);
      expect(nullEntry?._count.id).toBe(4);

      const rollup = computeStatusRollup(
        groups,
        new Map([[1, "Passed"]]),
      );
      expect(rollup.untested).toBe(4);
    });

    it("merged groups satisfy the SUM-to-total invariant via computeStatusRollup (Sigma counts + untested === total)", () => {
      const merged = mergeMilestoneStatusGroups({
        runGroups: [
          { testRunId: 10, statusId: 1, _count: { id: 5 } },
          { testRunId: 10, statusId: 2, _count: { id: 2 } },
          { testRunId: 10, statusId: null, _count: { id: 1 } },
        ],
        sessionGroups: [
          { sessionId: 50, statusId: 1, _count: { id: 3 } },
          { sessionId: 50, statusId: 2, _count: { id: 1 } },
        ],
        runIdToMilestoneId: new Map([[10, 100]]),
        sessionIdToMilestoneId: new Map([[50, 100]]),
      });
      const rollup = computeStatusRollup(
        merged.get(100) ?? [],
        new Map([
          [1, "Passed"],
          [2, "Failed"],
        ]),
      );
      const sumCounts = rollup.statusCounts.reduce(
        (s, c) => s + c.count,
        0,
      );
      expect(sumCounts + rollup.untested).toBe(rollup.total);
      // Specifically: 5+3 + 2+1 = 11 status counts; untested=1; total=12
      expect(rollup.total).toBe(12);
      expect(rollup.untested).toBe(1);
    });

    it("ignores groups whose parent id is not in the milestone lookup map", () => {
      const merged = mergeMilestoneStatusGroups({
        runGroups: [
          { testRunId: 999, statusId: 1, _count: { id: 99 } },
        ],
        sessionGroups: [],
        runIdToMilestoneId: new Map(),
        sessionIdToMilestoneId: new Map(),
      });
      expect(merged.size).toBe(0);
    });
  });

  describe("fetchDescendantCounts", () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, "fetch") as never;
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it("returns an empty map and never calls fetch when given an empty array", async () => {
      const map = await fetchDescendantCounts([], env);
      expect(map.size).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns a milestoneId-to-count map and defaults missing input ids to 0", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { "1": 5, "2": 12 } }), {
          status: 200,
        }) as never,
      );
      const map = await fetchDescendantCounts([1, 2, 3], env);
      expect(map.get(1)).toBe(5);
      expect(map.get(2)).toBe(12);
      // id 3 was in input but not in response → defaults to 0
      expect(map.get(3)).toBe(0);
    });

    it("encodes the milestoneIds payload into the q= query param so the host endpoint can decode it", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: {} }), { status: 200 }) as never,
      );
      await fetchDescendantCounts([7, 8], env);
      const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain("/api/mcp/milestones-descendants?q=");
      const qIndex = calledUrl.indexOf("?q=");
      const encoded = decodeURIComponent(calledUrl.slice(qIndex + 3));
      expect(JSON.parse(encoded)).toEqual({ milestoneIds: [7, 8] });
    });

    it("throws TestPlanItHttpError with the upstream statusCode on a 401 response", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401 },
        ) as never,
      );
      try {
        await fetchDescendantCounts([1], env);
        expect.fail("expected throw");
      } catch (e) {
        expect(e).toBeInstanceOf(TestPlanItHttpError);
        expect((e as TestPlanItHttpError).statusCode).toBe(401);
      }
    });

    it("throws TestPlanItHttpError with statusCode 500 on an upstream server error", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: "boom" } }),
          { status: 500 },
        ) as never,
      );
      try {
        await fetchDescendantCounts([1, 2], env);
        expect.fail("expected throw");
      } catch (e) {
        expect(e).toBeInstanceOf(TestPlanItHttpError);
        expect((e as TestPlanItHttpError).statusCode).toBe(500);
      }
    });
  });
});
