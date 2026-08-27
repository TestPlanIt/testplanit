import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

vi.mock("~/lib/authContext", () => ({
  resolveViewerProjectScope: vi.fn(),
}));

vi.mock("~/lib/services/requirementTree", () => ({
  getRequirementChildren: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { getRequirementChildren } from "~/lib/services/requirementTree";
import type { RequirementTreeRow } from "~/lib/services/requirementTree";

import { GET } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedResolveScope = resolveViewerProjectScope as unknown as ReturnType<
  typeof vi.fn
>;
const mockedGetChildren = getRequirementChildren as unknown as ReturnType<
  typeof vi.fn
>;

function makeRow(
  overrides: Partial<RequirementTreeRow> = {}
): RequirementTreeRow {
  return {
    id: 10,
    name: "REQ-010",
    title: "A child requirement",
    status: null,
    externalStatus: null,
    priority: null,
    externalId: null,
    externalKey: null,
    externalUrl: null,
    issueTypeId: null,
    issueTypeName: null,
    issueTypeIconUrl: null,
    contentUpdatedAt: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    projectId: 5,
    integrationId: null,
    parentId: 1,
    isRequirement: true,
    requirementDetachedAt: null,
    isDeleted: false,
    hasChildren: false,
    ...overrides,
  };
}

function makeRequest(projectId = "5", issueId = "1"): NextRequest {
  return new NextRequest(
    `http://localhost/api/projects/${projectId}/requirements/tree/${issueId}/children`
  );
}

const params = (projectId = "5", issueId = "1") => ({
  params: Promise.resolve({ projectId, issueId }),
});

describe("GET /api/projects/[projectId]/requirements/tree/[issueId]/children", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    mockedResolveScope.mockResolvedValue([5]);
    mockedGetChildren.mockResolvedValue([makeRow()]);
  });

  it("returns 401 before it looks at the project id", async () => {
    mockedSession.mockResolvedValue(null);

    const res = await GET(makeRequest("not-a-number"), params("not-a-number"));

    expect(res.status).toBe(401);
    expect(mockedResolveScope).not.toHaveBeenCalled();
    expect(mockedGetChildren).not.toHaveBeenCalled();
  });

  it("returns 400 when the project id is not numeric", async () => {
    const res = await GET(makeRequest("abc", "1"), params("abc", "1"));

    expect(res.status).toBe(400);
    expect(mockedResolveScope).not.toHaveBeenCalled();
    expect(mockedGetChildren).not.toHaveBeenCalled();
  });

  it("returns 400 when the issue id is not numeric", async () => {
    const res = await GET(makeRequest("5", "abc"), params("5", "abc"));

    expect(res.status).toBe(400);
    expect(mockedResolveScope).not.toHaveBeenCalled();
    expect(mockedGetChildren).not.toHaveBeenCalled();
  });

  it("returns 403 when the viewer's project scope excludes the requested project", async () => {
    mockedResolveScope.mockResolvedValue([6, 7]);

    const res = await GET(makeRequest("5", "1"), params("5", "1"));

    expect(res.status).toBe(403);
    expect(mockedGetChildren).not.toHaveBeenCalled();
  });

  it("returns the children rows on success", async () => {
    const res = await GET(makeRequest("5", "1"), params("5", "1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(mockedGetChildren).toHaveBeenCalledWith({
      projectId: 5,
      parentId: 1,
    });
  });

  it("returns an empty list, not an error, for an unknown or foreign parent id", async () => {
    mockedGetChildren.mockResolvedValue([]);

    const res = await GET(makeRequest("5", "99999"), params("5", "99999"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual([]);
  });

  it("never leaks the internal error message in a 500 body", async () => {
    mockedGetChildren.mockRejectedValue(
      new Error('relation "Widgets" does not exist')
    );

    const res = await GET(makeRequest("5", "1"), params("5", "1"));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("Widgets");
  });
});
