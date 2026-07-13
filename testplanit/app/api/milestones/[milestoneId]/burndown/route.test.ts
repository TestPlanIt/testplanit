import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    milestones: {
      findFirst: vi.fn(),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("~/lib/services/milestoneDescendants", () => ({
  getAllDescendantMilestoneIds: vi.fn().mockResolvedValue([]),
}));

const mockGetVisibleMilestone = vi.fn();
vi.mock("~/lib/services/milestoneAccess", () => ({
  getVisibleMilestone: (...args: any[]) => mockGetVisibleMilestone(...args),
}));

import { baseDb } from "~/lib/db";
import { getServerSession } from "next-auth";
import { GET } from "./route";

const createRequest = (
  milestoneId: string
): [NextRequest, { params: Promise<{ milestoneId: string }> }] => {
  const req = new NextRequest(
    `http://localhost/api/milestones/${milestoneId}/burndown`
  );
  const params = { params: Promise.resolve({ milestoneId }) };
  return [req, params];
};

const adminSession = {
  user: { id: "admin-1", name: "Admin", access: "ADMIN" },
};

beforeEach(() => {
  vi.clearAllMocks();
  (baseDb.$queryRaw as any).mockResolvedValue([]);
});

describe("GET /api/milestones/[milestoneId]/burndown", () => {
  it("returns 400 for a non-numeric milestone id", async () => {
    const [req, params] = createRequest("abc");
    const res = await GET(req, params);
    expect(res.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const [req, params] = createRequest("5");
    const res = await GET(req, params);
    expect(res.status).toBe(401);
  });

  it("returns 404 when the milestone is not visible to the session", async () => {
    (getServerSession as any).mockResolvedValue(adminSession);
    mockGetVisibleMilestone.mockResolvedValue(null);
    const [req, params] = createRequest("5");
    const res = await GET(req, params);
    expect(res.status).toBe(404);
  });

  it("builds a burndown series from manual + automated cases and sessions", async () => {
    (getServerSession as any).mockResolvedValue(adminSession);
    mockGetVisibleMilestone.mockResolvedValue({ id: 5, projectId: 1 });
    (baseDb.milestones.findFirst as any).mockResolvedValue({
      startedAt: new Date("2026-03-01T00:00:00.000Z"),
      completedAt: new Date("2026-03-05T00:00:00.000Z"),
      createdAt: new Date("2026-02-20T00:00:00.000Z"),
    });

    // Order matches the route's Promise.all batches: caseTotal, sessionTotal,
    // then manualCaseDay, automatedCaseDay, sessionDay.
    (baseDb.$queryRaw as any)
      .mockResolvedValueOnce([{ count: 5n }]) // 5 cases total (3 manual + 2 automated)
      .mockResolvedValueOnce([{ count: 1n }]) // 1 session
      .mockResolvedValueOnce([
        { day: "2026-03-01", count: 2n },
        { day: "2026-03-02", count: 1n },
      ]) // manual first-executions
      .mockResolvedValueOnce([{ day: "2026-03-01", count: 2n }]) // automated run burns down on its createdAt
      .mockResolvedValueOnce([{ day: "2026-03-02", count: 1n }]); // session

    const [req, params] = createRequest("5");
    const res = await GET(req, params);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.total).toBe(6);
    expect(body.hasTarget).toBe(true);
    expect(body.start).toBe("2026-03-01");
    expect(body.end).toBe("2026-03-05");
    // 03-01: 2 manual + 2 automated burned → 2 left; 03-02: +1 manual +1 session
    // → 0; then flat.
    expect(body.actual).toEqual([
      { date: "2026-03-01", remaining: 2 },
      { date: "2026-03-02", remaining: 0 },
      { date: "2026-03-03", remaining: 0 },
      { date: "2026-03-04", remaining: 0 },
      { date: "2026-03-05", remaining: 0 },
    ]);
  });

  it("returns an empty series when the milestone has no executable scope", async () => {
    (getServerSession as any).mockResolvedValue(adminSession);
    mockGetVisibleMilestone.mockResolvedValue({ id: 5, projectId: 1 });
    (baseDb.milestones.findFirst as any).mockResolvedValue({
      startedAt: new Date("2026-03-01T00:00:00.000Z"),
      completedAt: null,
      createdAt: new Date("2026-02-20T00:00:00.000Z"),
    });
    (baseDb.$queryRaw as any)
      .mockResolvedValueOnce([{ count: 0n }]) // no cases
      .mockResolvedValueOnce([{ count: 0n }]) // no sessions
      .mockResolvedValueOnce([]) // manual day rows
      .mockResolvedValueOnce([]) // automated day rows
      .mockResolvedValueOnce([]); // session day rows

    const [req, params] = createRequest("5");
    const res = await GET(req, params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(0);
    expect(body.start).toBeNull();
    expect(body.actual).toEqual([]);
  });
});
