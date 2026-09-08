import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * RED scaffold (18-01) for GET /api/milestones/[milestoneId]/members/coverage
 * — the route file does not exist yet (18-05 implements it GREEN).
 *
 * HTTP verb locked in 18-01-PLAN.md <interfaces>: GET. The route derives its
 * member issue set + projectId server-side from the milestoneId path param
 * only — no client-supplied issue-id list, no client-supplied projectId.
 *
 * Pins:
 *  - per-issue breakdown keyed by issueId: { linkedCaseCount, passed, failed,
 *    inProgress, notRun } plus uncovered: boolean (D-05, a distinct 5th
 *    state — zero linked cases, NOT folded into notRun).
 *  - classification boundary from the NAMED source
 *    lib/services/testRunSummary.ts (Status.isSuccess/isFailure/isCompleted):
 *      passed      = latest in-scope result Status.isSuccess === true
 *      failed      = latest in-scope result Status.isFailure === true
 *      inProgress  = latest in-scope result exists AND isCompleted === true
 *                    AND neither isSuccess nor isFailure
 *      notRun      = linked case has NO in-scope result (or latest result's
 *                    isCompleted !== true) — NOT inProgress, NOT uncovered
 *  - descendant-inclusive result scope (D-06): consults
 *    getAllDescendantMilestoneIds for the runs/sessions scope.
 *  - membership itself is NOT descendant-scoped (D-15): only MilestoneIssue
 *    rows on the requested milestone are members.
 *  - projectId is re-derived server-side from the milestone row; unauthorized
 *    sessions get 401/403.
 *
 * This file MUST fail at authoring time — the route module does not exist.
 */

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/services/milestoneDescendants", () => ({
  getAllDescendantMilestoneIds: vi.fn(),
}));

const mockGetVisibleMilestone = vi.fn();
vi.mock("~/lib/services/milestoneAccess", () => ({
  getVisibleMilestone: (...args: any[]) => mockGetVisibleMilestone(...args),
}));

const mockResolveViewerProjectScope = vi.fn();
vi.mock("~/lib/authContext", () => ({
  resolveViewerProjectScope: (...args: any[]) =>
    mockResolveViewerProjectScope(...args),
}));

const mockMilestonesFindUnique = vi.fn();
const mockMilestoneIssueFindMany = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock("~/lib/db", () => ({
  baseDb: {
    milestones: {
      findUnique: (...args: any[]) => mockMilestonesFindUnique(...args),
    },
    milestoneIssue: {
      findMany: (...args: any[]) => mockMilestoneIssueFindMany(...args),
    },
    $queryRaw: (...args: any[]) => mockQueryRaw(...args),
  },
}));

import { getServerSession } from "next-auth";
import { getAllDescendantMilestoneIds } from "~/lib/services/milestoneDescendants";

const mockSession = {
  user: { id: "user-1", name: "Test User" },
};

const createRequest = (
  milestoneId: string
): [NextRequest, { params: Promise<{ milestoneId: string }> }] => {
  const req = new NextRequest(
    `http://localhost/api/milestones/${milestoneId}/members/coverage`
  );
  const params = { params: Promise.resolve({ milestoneId }) };
  return [req, params];
};

beforeEach(() => {
  vi.clearAllMocks();
  (getServerSession as any).mockResolvedValue(mockSession);
  (getAllDescendantMilestoneIds as any).mockResolvedValue([]);
  mockGetVisibleMilestone.mockResolvedValue({ id: 1, projectId: 100 });
  mockResolveViewerProjectScope.mockResolvedValue(null);
  mockMilestonesFindUnique.mockResolvedValue({ id: 1, projectId: 100 });
  mockMilestoneIssueFindMany.mockResolvedValue([]);
  mockQueryRaw.mockResolvedValue([]);
});

describe("GET /api/milestones/[milestoneId]/members/coverage — auth (T-18-01-02)", () => {
  it("returns 401 when unauthenticated", async () => {
    (getServerSession as any).mockResolvedValue(null);

    const { GET } = await import("./route");
    const [req, ctx] = createRequest("1");
    const response = await GET(req, ctx);

    expect(response.status).toBe(401);
  });

  it("re-derives projectId from the milestone row server-side — never trusts a client-supplied projectId", async () => {
    mockGetVisibleMilestone.mockResolvedValue({ id: 1, projectId: 100 });

    const { GET } = await import("./route");
    const [req, ctx] = createRequest("1");
    await GET(req, ctx);

    // The route must resolve the milestone through the policy-scoped
    // visibility gate (which carries projectId) rather than accept
    // ?projectId= from the query string.
    expect(mockGetVisibleMilestone).toHaveBeenCalledWith(expect.anything(), 1);
  });

  it("returns 404 when the policy-scoped lookup can't see the milestone (unauthorized project or missing row)", async () => {
    mockGetVisibleMilestone.mockResolvedValue(null);

    const { GET } = await import("./route");
    const [req, ctx] = createRequest("1");
    const response = await GET(req, ctx);

    expect(response.status).toBe(404);
    // The coverage computation must never run for an invisible milestone.
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });
});

describe("GET /api/milestones/[milestoneId]/members/coverage — per-issue breakdown shape (D-04)", () => {
  it("returns a breakdown keyed by issueId with linkedCaseCount, passed, failed, inProgress, notRun, uncovered", async () => {
    mockMilestoneIssueFindMany.mockResolvedValue([
      { issueId: 501, source: "SYNCED" },
    ]);
    // Two linked cases for issue 501: one with zero linked test-run
    // results (notRun), and we assert the shape overall.
    mockQueryRaw.mockResolvedValue([
      {
        issueId: 501,
        linkedCaseCount: 2,
        passed: 1,
        failed: 0,
        inProgress: 0,
        notRun: 1,
      },
    ]);

    const { GET } = await import("./route");
    const [req, ctx] = createRequest("1");
    const response = await GET(req, ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body[501]).toMatchObject({
      linkedCaseCount: 2,
      passed: 1,
      failed: 0,
      inProgress: 0,
      notRun: 1,
      uncovered: false,
    });
  });

  it("marks an issue with zero linked cases as uncovered: true — a distinct 5th state, not folded into notRun", async () => {
    mockMilestoneIssueFindMany.mockResolvedValue([
      { issueId: 502, source: "SYNCED" },
    ]);
    mockQueryRaw.mockResolvedValue([
      {
        issueId: 502,
        linkedCaseCount: 0,
        passed: 0,
        failed: 0,
        inProgress: 0,
        notRun: 0,
      },
    ]);

    const { GET } = await import("./route");
    const [req, ctx] = createRequest("1");
    const response = await GET(req, ctx);
    const body = await response.json();

    expect(body[502].uncovered).toBe(true);
    // Uncovered is distinct from notRun — a zero-case issue's notRun count
    // stays 0, it does not inherit a phantom "not run" count.
    expect(body[502].notRun).toBe(0);
  });
});

describe("GET /api/milestones/[milestoneId]/members/coverage — classification boundary (testRunSummary.ts isSuccess/isFailure/isCompleted)", () => {
  it("counts a case whose latest in-scope result is isCompleted-but-not-success/failure as inProgress", async () => {
    mockMilestoneIssueFindMany.mockResolvedValue([
      { issueId: 503, source: "SYNCED" },
    ]);
    mockQueryRaw.mockResolvedValue([
      {
        issueId: 503,
        linkedCaseCount: 1,
        passed: 0,
        failed: 0,
        inProgress: 1,
        notRun: 0,
      },
    ]);

    const { GET } = await import("./route");
    const [req, ctx] = createRequest("1");
    const response = await GET(req, ctx);
    const body = await response.json();

    expect(body[503].inProgress).toBe(1);
    expect(body[503].passed).toBe(0);
    expect(body[503].failed).toBe(0);
  });

  it("counts a linked case with NO in-scope result as notRun — NOT inProgress, NOT uncovered", async () => {
    mockMilestoneIssueFindMany.mockResolvedValue([
      { issueId: 504, source: "SYNCED" },
    ]);
    mockQueryRaw.mockResolvedValue([
      {
        issueId: 504,
        linkedCaseCount: 1,
        passed: 0,
        failed: 0,
        inProgress: 0,
        notRun: 1,
      },
    ]);

    const { GET } = await import("./route");
    const [req, ctx] = createRequest("1");
    const response = await GET(req, ctx);
    const body = await response.json();

    expect(body[504].notRun).toBe(1);
    expect(body[504].inProgress).toBe(0);
    expect(body[504].uncovered).toBe(false);
  });
});

describe("GET /api/milestones/[milestoneId]/members/coverage — descendant-inclusive result scope (D-06)", () => {
  it("consults getAllDescendantMilestoneIds and feeds the descendant ids into the run/session scope", async () => {
    (getAllDescendantMilestoneIds as any).mockResolvedValue([2, 3]);
    mockMilestoneIssueFindMany.mockResolvedValue([
      { issueId: 501, source: "SYNCED" },
    ]);

    const { GET } = await import("./route");
    const [req, ctx] = createRequest("1");
    await GET(req, ctx);

    expect(getAllDescendantMilestoneIds).toHaveBeenCalledWith(
      1,
      expect.anything()
    );
    // The descendant ids (plus the milestone's own id) must feed the
    // raw-SQL scope used to compute the breakdown.
    const rawCall = mockQueryRaw.mock.calls[0];
    expect(rawCall).toBeTruthy();
    const rawCallText = JSON.stringify(rawCall);
    expect(rawCallText).toContain("2");
    expect(rawCallText).toContain("3");
  });
});

describe("GET /api/milestones/[milestoneId]/members/coverage — cross-project blend is viewer-scoped", () => {
  it("resolves the viewer's project scope and feeds it into the raw-SQL case filter", async () => {
    mockResolveViewerProjectScope.mockResolvedValue([100, 200]);
    mockMilestoneIssueFindMany.mockResolvedValue([
      { issueId: 501, source: "SYNCED" },
    ]);

    const { GET } = await import("./route");
    const [req, ctx] = createRequest("1");
    await GET(req, ctx);

    expect(mockResolveViewerProjectScope).toHaveBeenCalledWith("user-1");
    // The accessible project ids must parameterize the linked-cases filter
    // so no case (or result) from an unreadable project can bleed in.
    const rawCallText = JSON.stringify(mockQueryRaw.mock.calls[0]);
    expect(rawCallText).toContain("200");
  });

  it("returns otherProjectCaseCount per breakdown — the cross-project share of linkedCaseCount", async () => {
    mockMilestoneIssueFindMany.mockResolvedValue([
      { issueId: 501, source: "SYNCED" },
    ]);
    mockQueryRaw.mockResolvedValue([
      {
        issueId: 501,
        linkedCaseCount: 3,
        otherProjectCaseCount: 1,
        passed: 2,
        failed: 0,
        inProgress: 0,
        notRun: 1,
      },
    ]);

    const { GET } = await import("./route");
    const [req, ctx] = createRequest("1");
    const response = await GET(req, ctx);
    const body = await response.json();

    expect(body[501].otherProjectCaseCount).toBe(1);
    expect(body[501].linkedCaseCount).toBe(3);
  });
});

describe("GET /api/milestones/[milestoneId]/members/coverage — membership NOT descendant-scoped (D-15)", () => {
  it("only includes MilestoneIssue rows on the requested milestone as members, even when descendants have their own members", async () => {
    (getAllDescendantMilestoneIds as any).mockResolvedValue([2]);
    mockMilestoneIssueFindMany.mockResolvedValue([
      { issueId: 501, source: "SYNCED" },
    ]);

    const { GET } = await import("./route");
    const [req, ctx] = createRequest("1");
    await GET(req, ctx);

    // The membership query itself must scope to milestoneId: 1 only — not
    // { in: [1, 2] } — even though descendant id 2 exists for RESULT scope.
    expect(mockMilestoneIssueFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ milestoneId: 1 }),
      })
    );
  });
});
