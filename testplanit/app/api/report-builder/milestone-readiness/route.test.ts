// Route tests for the Milestone Readiness report. Harness mirrors the
// sibling report-builder suites (same session/db mocking style).
//
// The "% ready" rollup is the one number this report exists to publish, and
// the milestone page's Issues panel publishes the SAME number from the SAME
// helper. So the rollup itself is deliberately NOT stubbed: the fixture is
// fed through the route and through `aggregateMilestoneReadiness` directly,
// and the two are asserted equal — if the route ever grows its own copy of
// the math, this suite fails instead of the two surfaces quietly diverging.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/auth/utils", () => ({ getEnhancedDb: vi.fn() }));
vi.mock("~/lib/authContext", () => ({ resolveViewerProjectScope: vi.fn() }));
vi.mock("~/lib/db", () => ({
  baseDb: { milestoneIssue: { findMany: vi.fn() } },
}));
vi.mock("~/lib/services/milestoneMemberCoverage", () => ({
  getMemberCoverage: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { getEnhancedDb } from "~/lib/auth/utils";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { baseDb } from "~/lib/db";
import { getMemberCoverage } from "~/lib/services/milestoneMemberCoverage";
// The UI-side twin, unmocked on purpose — see the header comment.
import { aggregateMilestoneReadiness } from "~/app/[locale]/projects/milestones/[projectId]/[milestoneId]/milestoneReadiness";

import { GET, POST } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedEnhancedDb = getEnhancedDb as unknown as ReturnType<typeof vi.fn>;
const mockedViewerScope = resolveViewerProjectScope as unknown as ReturnType<
  typeof vi.fn
>;
const mockedMilestoneIssues = baseDb.milestoneIssue
  .findMany as unknown as ReturnType<typeof vi.fn>;
const mockedCoverage = getMemberCoverage as unknown as ReturnType<typeof vi.fn>;

const PROJECT_ID = 5;
const READY = "Ready (%)";

let mockedVisibleMilestones: ReturnType<typeof vi.fn>;

const milestoneRow = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Milestone ${id}`,
  startedAt: new Date("2026-06-01T00:00:00.000Z"),
  completedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  milestoneType: { icon: { name: "flag" } },
  integrationId: null,
  externalKind: null,
  detachedAt: null,
  ...overrides,
});

/** A `CoverageBreakdown` as `getMemberCoverage` returns it. */
const breakdown = (
  overrides: Partial<{
    linkedCaseCount: number;
    otherProjectCaseCount: number;
    passed: number;
    failed: number;
    inProgress: number;
    notRun: number;
    uncovered: boolean;
  }> = {}
) => ({
  linkedCaseCount: 1,
  otherProjectCaseCount: 0,
  passed: 0,
  failed: 0,
  inProgress: 0,
  notRun: 0,
  uncovered: false,
  statuses: [],
  untested: 0,
  ...overrides,
});

// Four member issues, one per readiness state: exactly one is fully passing,
// so "% ready" is 25 — a number that only comes out right if uncovered and
// not-run issues count AGAINST readiness.
const FIXTURE_COVERAGE = {
  101: breakdown({ linkedCaseCount: 2, passed: 2 }),
  102: breakdown({ linkedCaseCount: 2, passed: 1, failed: 1 }),
  103: breakdown({ linkedCaseCount: 0, uncovered: true }),
  104: breakdown({ linkedCaseCount: 1, notRun: 1 }),
};

function getRequest(query = `?projectId=${PROJECT_ID}`): NextRequest {
  return new NextRequest(
    `http://localhost/api/report-builder/milestone-readiness${query}`
  );
}

function postRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    "http://localhost/api/report-builder/milestone-readiness",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
}

const basePost = (overrides: Record<string, unknown> = {}) => ({
  projectId: PROJECT_ID,
  dimensions: ["milestone"],
  metrics: ["percentReady"],
  ...overrides,
});

describe("/api/report-builder/milestone-readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({ user: { id: "user-1", access: "USER" } });
    mockedVisibleMilestones = vi.fn().mockResolvedValue([milestoneRow(11)]);
    mockedEnhancedDb.mockResolvedValue({
      milestones: { findMany: mockedVisibleMilestones },
    });
    mockedViewerScope.mockResolvedValue([PROJECT_ID, 9]);
    mockedMilestoneIssues.mockResolvedValue([{ milestoneId: 11 }]);
    mockedCoverage.mockResolvedValue(FIXTURE_COVERAGE);
  });

  describe("auth and validation", () => {
    it("401s GET and POST without a session, before any read", async () => {
      mockedSession.mockResolvedValue(null);

      expect((await GET(getRequest())).status).toBe(401);
      expect((await POST(postRequest(basePost()))).status).toBe(401);
      expect(mockedEnhancedDb).not.toHaveBeenCalled();
      expect(mockedCoverage).not.toHaveBeenCalled();
    });

    it("400s GET and POST without a projectId", async () => {
      expect((await GET(getRequest(""))).status).toBe(400);
      expect(
        (await POST(postRequest(basePost({ projectId: undefined })))).status
      ).toBe(400);
      expect(mockedCoverage).not.toHaveBeenCalled();
    });

    it("reads milestones through the POLICY-SCOPED client, never the raw one", async () => {
      // The visibility gate for this report is the enhanced client's project
      // ACL — readiness is only ever computed for milestones it returns.
      await POST(postRequest(basePost()));

      expect(mockedEnhancedDb).toHaveBeenCalledWith(
        expect.objectContaining({ user: { id: "user-1", access: "USER" } })
      );
      expect(mockedVisibleMilestones).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: PROJECT_ID, isDeleted: false },
        })
      );
    });

    it("400s a request without the required Milestone dimension", async () => {
      const missing = await POST(
        postRequest(basePost({ dimensions: ["date"] }))
      );
      expect(missing.status).toBe(400);
      expect((await missing.json()).error).toMatch(/Milestone dimension/i);

      const notAnArray = await POST(
        postRequest(basePost({ dimensions: "milestone" }))
      );
      expect(notAnArray.status).toBe(400);
      expect(mockedCoverage).not.toHaveBeenCalled();
    });

    it("400s an unsupported dimension or metric, naming it", async () => {
      const badDim = await POST(
        postRequest(basePost({ dimensions: ["milestone", "sprint"] }))
      );
      expect(badDim.status).toBe(400);
      expect((await badDim.json()).error).toMatch(/sprint/);

      const badMetric = await POST(
        postRequest(basePost({ metrics: ["velocity"] }))
      );
      expect(badMetric.status).toBe(400);
      expect((await badMetric.json()).error).toMatch(/velocity/);
      expect(mockedCoverage).not.toHaveBeenCalled();
    });

    it("GET advertises the milestone/date dimensions and the seven metrics", async () => {
      const response = await GET(getRequest());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.dimensions.map((d: any) => d.id)).toEqual([
        "milestone",
        "date",
      ]);
      expect(body.metrics).toEqual([
        { id: "percentReady", label: READY },
        { id: "passed", label: "Passed" },
        { id: "failed", label: "Failed" },
        { id: "inProgress", label: "In Progress" },
        { id: "notRun", label: "Not Run" },
        { id: "uncovered", label: "Uncovered" },
        { id: "totalIssues", label: "Total Issues" },
      ]);
    });
  });

  describe("% ready rollup", () => {
    it("publishes the same number the milestone page's own rollup produces", async () => {
      const response = await POST(postRequest(basePost()));
      const body = await response.json();

      const twin = aggregateMilestoneReadiness(
        FIXTURE_COVERAGE as any,
        Object.keys(FIXTURE_COVERAGE).map(Number)
      );

      expect(response.status).toBe(200);
      expect(body.results).toHaveLength(1);
      // Both halves of the drift guard: the report agrees with the twin, and
      // the twin itself still says 25 (one passing issue of four).
      expect(body.results[0][READY]).toBe(twin.percentReady);
      expect(body.results[0][READY]).toBe(25);
    });

    it("breaks the rollup out into the same per-state counts, worst-wins per issue", async () => {
      const response = await POST(
        postRequest(
          basePost({
            metrics: [
              "percentReady",
              "passed",
              "failed",
              "inProgress",
              "notRun",
              "uncovered",
              "totalIssues",
            ],
          })
        )
      );
      const body = await response.json();

      // Issue 102 has a passing case AND a failing one — it counts once, as
      // failed, never as both.
      expect(body.results[0]).toMatchObject({
        [READY]: 25,
        Passed: 1,
        Failed: 1,
        "In Progress": 0,
        "Not Run": 1,
        Uncovered: 1,
        "Total Issues": 4,
      });
    });

    it("defaults to every metric when none is picked", async () => {
      const response = await POST(
        postRequest(basePost({ metrics: undefined }))
      );
      const body = await response.json();

      expect(Object.keys(body.results[0])).toEqual([
        "milestone",
        READY,
        "Passed",
        "Failed",
        "In Progress",
        "Not Run",
        "Uncovered",
        "Total Issues",
      ]);
    });

    it("counts a milestone whose issues are ALL unverified as 0% ready", async () => {
      mockedCoverage.mockResolvedValue({
        101: breakdown({ linkedCaseCount: 0, uncovered: true }),
        102: breakdown({ linkedCaseCount: 1, notRun: 1 }),
      });

      const response = await POST(postRequest(basePost()));
      const body = await response.json();

      expect(body.results[0][READY]).toBe(0);
    });

    it("renders the milestone cell with the fields the shared name component needs", async () => {
      const response = await POST(postRequest(basePost()));
      const body = await response.json();

      expect(body.results[0].milestone).toMatchObject({
        id: 11,
        name: "Milestone 11",
        milestoneType: { icon: { name: "flag" } },
        integrationId: null,
        externalKind: null,
        detachedAt: null,
      });
    });
  });

  describe("cross-project cases in the rollup", () => {
    it("hands the coverage query the viewer's project scope, so the bleed is viewer-limited", async () => {
      await POST(postRequest(basePost()));

      expect(mockedViewerScope).toHaveBeenCalledWith("user-1");
      expect(mockedCoverage).toHaveBeenCalledWith(11, {
        projectId: PROJECT_ID,
        accessibleProjectIds: [PROJECT_ID, 9],
      });
    });

    it("passes an unrestricted (ADMIN) scope through as null", async () => {
      mockedViewerScope.mockResolvedValue(null);

      await POST(postRequest(basePost()));

      expect(mockedCoverage.mock.calls[0][1].accessibleProjectIds).toBeNull();
    });

    it("counts a failure that lives in ANOTHER project against readiness", async () => {
      // Issue 102's only failing case is in a different project. Before the
      // cross-project blend it would have read as fully passing and the
      // milestone as 100% ready.
      const withBleed = {
        101: breakdown({ linkedCaseCount: 2, passed: 2 }),
        102: breakdown({
          linkedCaseCount: 2,
          otherProjectCaseCount: 1,
          passed: 1,
          failed: 1,
        }),
      };
      mockedCoverage.mockResolvedValue(withBleed);

      const response = await POST(
        postRequest(basePost({ metrics: ["percentReady", "failed"] }))
      );
      const body = await response.json();

      expect(body.results[0][READY]).toBe(50);
      expect(body.results[0].Failed).toBe(1);
      expect(body.results[0][READY]).toBe(
        aggregateMilestoneReadiness(
          withBleed as any,
          Object.keys(withBleed).map(Number)
        ).percentReady
      );
    });
  });

  describe("milestone selection", () => {
    it("skips the coverage query for milestones with no member issues", async () => {
      mockedVisibleMilestones.mockResolvedValue([
        milestoneRow(11),
        milestoneRow(12),
      ]);
      mockedMilestoneIssues.mockResolvedValue([{ milestoneId: 11 }]);

      const response = await POST(postRequest(basePost()));
      const body = await response.json();

      expect(mockedCoverage).toHaveBeenCalledTimes(1);
      expect(mockedCoverage).toHaveBeenCalledWith(11, expect.anything());
      expect(body.results.map((r: any) => r.milestone.id)).toEqual([11]);
    });

    it("asks for member issues only among the milestones the caller can see", async () => {
      mockedVisibleMilestones.mockResolvedValue([
        milestoneRow(11),
        milestoneRow(12),
      ]);

      await POST(postRequest(basePost()));

      expect(mockedMilestoneIssues).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { milestoneId: { in: [11, 12] } },
        })
      );
    });

    it("returns an empty result set — and runs no queries — when nothing is visible", async () => {
      mockedVisibleMilestones.mockResolvedValue([]);

      const response = await POST(postRequest(basePost()));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ results: [] });
      expect(mockedMilestoneIssues).not.toHaveBeenCalled();
      expect(mockedCoverage).not.toHaveBeenCalled();
    });

    it("filters on the milestone's plotted date, so the filter and the chart agree", async () => {
      mockedVisibleMilestones.mockResolvedValue([
        milestoneRow(11, { startedAt: new Date("2026-06-15T00:00:00.000Z") }),
        // No start or target date: plots at creation, which is out of range.
        milestoneRow(12, {
          startedAt: null,
          completedAt: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
      ]);

      const response = await POST(
        postRequest(
          basePost({ startDate: "2026-06-01", endDate: "2026-06-30" })
        )
      );
      const body = await response.json();

      expect(body.results.map((r: any) => r.milestone.id)).toEqual([11]);
    });

    it("adds a groupable date cell only when the Date dimension is picked", async () => {
      const withoutDate = await (await POST(postRequest(basePost()))).json();
      expect(withoutDate.results[0]).not.toHaveProperty("date");

      const withDate = await (
        await POST(postRequest(basePost({ dimensions: ["milestone", "date"] })))
      ).json();
      expect(withDate.results[0].date).toEqual({
        executedAt: "2026-06-01T00:00:00.000Z",
      });
    });
  });
});
