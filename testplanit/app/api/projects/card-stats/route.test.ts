import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({ getServerAuthSession: vi.fn() }));
vi.mock("~/lib/auth/utils", () => ({ getEnhancedDb: vi.fn() }));
vi.mock("~/lib/services/projectCardStats", () => ({
  getProjectCardStats: vi.fn(),
}));

import { getEnhancedDb } from "~/lib/auth/utils";
import { getProjectCardStats } from "~/lib/services/projectCardStats";
import { getServerAuthSession } from "~/server/auth";
import { POST } from "./route";

const session = vi.mocked(getServerAuthSession);
const enhancedDb = vi.mocked(getEnhancedDb);
const cardStats = vi.mocked(getProjectCardStats);

const findMany = vi.fn();
const viewer = { user: { id: "user-1", access: "USER" } } as any;

function request(body: unknown) {
  return new Request("http://localhost/api/projects/card-stats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue(viewer);
  enhancedDb.mockResolvedValue({ projects: { findMany } } as any);
  findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
  cardStats.mockResolvedValue({});
});

describe("POST /api/projects/card-stats", () => {
  it("refuses a signed-out caller", async () => {
    session.mockResolvedValue(null);

    const response = await POST(request({ projectIds: [1] }));

    expect(response.status).toBe(401);
    expect(cardStats).not.toHaveBeenCalled();
  });

  it.each([
    ["no list", {}],
    ["a list of strings", { projectIds: ["1"] }],
    ["a fractional id", { projectIds: [1.5] }],
    ["more ids than a page of cards holds", { projectIds: Array(501).fill(1) }],
    ["a body that is not JSON", "not json"],
  ])("rejects %s", async (_label, body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(cardStats).not.toHaveBeenCalled();
  });

  it("answers an empty list without touching the database", async () => {
    const response = await POST(request({ projectIds: [] }));

    expect(await response.json()).toEqual({ stats: {} });
    expect(enhancedDb).not.toHaveBeenCalled();
  });

  it("computes stats only for the projects the caller can read", async () => {
    findMany.mockResolvedValue([{ id: 2 }]);
    cardStats.mockResolvedValue({
      2: { issues: 3, lastActivityAt: null, myPending: 1 },
    });

    const response = await POST(request({ projectIds: [1, 2, 999] }));

    expect(enhancedDb).toHaveBeenCalledWith(viewer);
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2, 999] }, isDeleted: false },
      select: { id: true },
    });
    expect(cardStats).toHaveBeenCalledWith([2], "user-1");
    expect(await response.json()).toEqual({
      stats: {
        2: { issues: 3, lastActivityAt: null, myPending: 1 },
      },
    });
  });

  it("reports a failure without leaking it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    cardStats.mockRejectedValue(new Error("relation does not exist"));

    const response = await POST(request({ projectIds: [1] }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to fetch project card stats",
    });
  });
});
