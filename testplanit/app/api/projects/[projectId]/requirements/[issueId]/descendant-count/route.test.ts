import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

vi.mock("~/lib/db", () => ({
  baseDb: {
    issue: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("~/lib/integrations/importAuthorization", () => ({
  authorizeProjectAdminForProject: vi.fn(),
}));

vi.mock("~/lib/services/requirementHierarchy", () => ({
  getRequirementSubtreeCount: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { baseDb } from "~/lib/db";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
import { getRequirementSubtreeCount } from "~/lib/services/requirementHierarchy";

import { GET } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedFindFirst = baseDb.issue.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockedAuth = authorizeProjectAdminForProject as unknown as ReturnType<
  typeof vi.fn
>;
const mockedGetSubtreeCount =
  getRequirementSubtreeCount as unknown as ReturnType<typeof vi.fn>;

function makeRequest(projectId = "5", issueId = "10"): NextRequest {
  return new NextRequest(
    `http://localhost/api/projects/${projectId}/requirements/${issueId}/descendant-count`
  );
}

const params = (projectId = "5", issueId = "10") => ({
  params: Promise.resolve({ projectId, issueId }),
});

describe("GET /api/projects/[projectId]/requirements/[issueId]/descendant-count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    mockedAuth.mockResolvedValue({ ok: true, status: 200, projectId: 5 });
    mockedFindFirst.mockResolvedValue({ id: 10 });
    mockedGetSubtreeCount.mockResolvedValue(7);
  });

  it("returns 401 when there is no session", async () => {
    mockedSession.mockResolvedValue(null);

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(401);
    expect(mockedAuth).not.toHaveBeenCalled();
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(mockedGetSubtreeCount).not.toHaveBeenCalled();
  });

  it("returns 400 when projectId or issueId is not a number", async () => {
    const res = await GET(makeRequest("abc", "10"), params("abc", "10"));

    expect(res.status).toBe(400);
    expect(mockedAuth).not.toHaveBeenCalled();
    expect(mockedGetSubtreeCount).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not a project admin for the addressed project", async () => {
    mockedAuth.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(403);
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(mockedGetSubtreeCount).not.toHaveBeenCalled();
  });

  it("a non-admin request against an EXISTING requirement still returns 403, never 404", async () => {
    mockedAuth.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });
    mockedFindFirst.mockResolvedValue({ id: 10 });

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(403);
    expect(mockedFindFirst).not.toHaveBeenCalled();
  });

  it("returns 404 when the addressed issue is not a live requirement in the addressed project", async () => {
    mockedFindFirst.mockResolvedValue(null);

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(404);
    expect(mockedFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 10,
          projectId: 5,
          isDeleted: false,
          isRequirement: true,
        }),
      })
    );
    expect(mockedGetSubtreeCount).not.toHaveBeenCalled();
  });

  it("returns the count produced by getRequirementSubtreeCount as a JSON number", async () => {
    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw);
    expect(typeof body.count).toBe("number");
    expect(body.count).toBe(7);
    expect(mockedGetSubtreeCount).toHaveBeenCalledWith(10, 5);
  });

  it("survives a real bigint-shaped count without throwing at serialization", async () => {
    // getRequirementSubtreeCount's own contract already coerces to a JS
    // number (`Number(rows[0]?.count ?? 0)`); this test pins that this
    // route trusts that contract rather than re-serializing a raw value
    // that could still be a BigInt if the service's own cast were ever
    // dropped -- JSON.stringify throws on a real BigInt, and that failure
    // would surface here, not in the service's own test.
    mockedGetSubtreeCount.mockResolvedValue(Number(9007199254740991));

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(() => JSON.parse(raw)).not.toThrow();
    const body = JSON.parse(raw);
    expect(typeof body.count).toBe("number");
  });

  it("never leaks the internal error message in a 500 body", async () => {
    mockedGetSubtreeCount.mockRejectedValue(
      new Error('relation "Widgets" does not exist')
    );

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("Widgets");
  });
});
