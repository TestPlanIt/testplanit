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

vi.mock("~/lib/authContext", () => ({
  resolveViewerProjectScope: vi.fn(),
}));

vi.mock("~/lib/services/requirementTree", () => ({
  getRequirementAncestorChain: vi.fn(),
}));

import { resolveViewerProjectScope } from "~/lib/authContext";
import { baseDb } from "~/lib/db";
import { getRequirementAncestorChain } from "~/lib/services/requirementTree";
import { getServerSession } from "next-auth";

import { GET } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedFindFirst = baseDb.issue.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockedScope = resolveViewerProjectScope as unknown as ReturnType<
  typeof vi.fn
>;
const mockedChain = getRequirementAncestorChain as unknown as ReturnType<
  typeof vi.fn
>;

function makeRequest(projectId = "5", issueId = "10"): NextRequest {
  return new NextRequest(
    `http://localhost/api/projects/${projectId}/requirements/${issueId}/ancestors`
  );
}

function params(projectId = "5", issueId = "10") {
  return { params: Promise.resolve({ projectId, issueId }) };
}

describe("GET /api/projects/[projectId]/requirements/[issueId]/ancestors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({ user: { id: "user-1" } });
    mockedScope.mockResolvedValue(null);
    mockedFindFirst.mockResolvedValue({ id: 10 });
    mockedChain.mockResolvedValue([]);
  });

  it("returns 401 when there is no session", async () => {
    mockedSession.mockResolvedValue(null);

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(401);
    expect(mockedChain).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-numeric id", async () => {
    const res = await GET(makeRequest("abc", "10"), params("abc", "10"));

    expect(res.status).toBe(400);
    expect(mockedChain).not.toHaveBeenCalled();
  });

  it("returns 403 when the project is outside the viewer's scope", async () => {
    mockedScope.mockResolvedValue([7, 8]);

    const res = await GET(makeRequest("5"), params("5"));

    expect(res.status).toBe(403);
    // The identity check must not run either: a caller outside the project
    // could otherwise use the 404/200 split to probe which ids exist in it.
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(mockedChain).not.toHaveBeenCalled();
  });

  it("returns 404 when the id is not a live requirement in this project", async () => {
    mockedFindFirst.mockResolvedValue(null);

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(404);
    expect(mockedChain).not.toHaveBeenCalled();
  });

  it("scopes the identity check so the route cannot be aimed at a non-requirement row", async () => {
    await GET(makeRequest(), params());

    const [args] = mockedFindFirst.mock.calls.at(-1)!;
    expect(args.where).toMatchObject({
      id: 10,
      projectId: 5,
      isDeleted: false,
    });
    // REQUIREMENT_SCOPE_WHERE's own predicate, spread into the same object.
    expect(Object.keys(args.where).length).toBeGreaterThan(3);
  });

  it("returns the chain the service produced, in its order", async () => {
    // The service orders outermost-first; the route must not re-sort it.
    mockedChain.mockResolvedValue([
      { id: 1, name: "Root", title: "Root", externalUrl: null },
      { id: 2, name: "Middle", title: "Middle", externalUrl: null },
    ]);

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ancestors.map((a: { id: number }) => a.id)).toEqual([1, 2]);
    expect(mockedChain).toHaveBeenCalledWith(5, 10);
  });

  it("returns an empty chain for a root requirement rather than erroring", async () => {
    mockedChain.mockResolvedValue([]);

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(200);
    expect((await res.json()).ancestors).toEqual([]);
  });

  it("is a VIEWER-level read -- a non-admin in the project still gets the chain", async () => {
    // Deliberately unlike the sibling `descendant-count` route, which gates
    // on project admin because it previews a delete. A breadcrumb is
    // ordinary context for a requirement already on screen.
    mockedScope.mockResolvedValue([5]);
    mockedChain.mockResolvedValue([
      { id: 1, name: "Root", title: "Root", externalUrl: null },
    ]);

    const res = await GET(makeRequest("5"), params("5"));

    expect(res.status).toBe(200);
    expect((await res.json()).ancestors).toHaveLength(1);
  });
});
