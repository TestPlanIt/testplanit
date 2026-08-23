import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

vi.mock("~/lib/authContext", () => ({
  resolveViewerProjectScope: vi.fn(),
}));

vi.mock("~/lib/services/requirementCoverage", () => ({
  getRequirementCoverage: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { getRequirementCoverage } from "~/lib/services/requirementCoverage";

import type { RequirementCoverageBreakdown } from "~/lib/services/requirementCoverage";

import { GET } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedResolveScope = resolveViewerProjectScope as unknown as ReturnType<
  typeof vi.fn
>;
const mockedGetCoverage = getRequirementCoverage as unknown as ReturnType<
  typeof vi.fn
>;

function makeRequest(projectId = "5"): NextRequest {
  return new NextRequest(
    `http://localhost/api/projects/${projectId}/requirements/coverage`
  );
}

const params = (projectId = "5") => ({
  params: Promise.resolve({ projectId }),
});

function breakdown(
  overrides: Partial<RequirementCoverageBreakdown> = {}
): RequirementCoverageBreakdown {
  return {
    linkedCaseCount: 2,
    crossProjectCaseCount: 0,
    passed: 2,
    failed: 0,
    inProgress: 0,
    notRun: 0,
    uncovered: false,
    status: "PASSED",
    ...overrides,
  };
}

describe("GET /api/projects/[projectId]/requirements/coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    mockedResolveScope.mockResolvedValue([5]);
    mockedGetCoverage.mockResolvedValue(new Map());
  });

  it("returns 401 before it looks at the project id", async () => {
    mockedSession.mockResolvedValue(null);

    const res = await GET(makeRequest("not-a-number"), params("not-a-number"));

    expect(res.status).toBe(401);
    expect(mockedResolveScope).not.toHaveBeenCalled();
    expect(mockedGetCoverage).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-numeric project id", async () => {
    const res = await GET(makeRequest("abc"), params("abc"));

    expect(res.status).toBe(400);
    expect(mockedResolveScope).not.toHaveBeenCalled();
    expect(mockedGetCoverage).not.toHaveBeenCalled();
  });

  it("returns 403 when the viewer's project scope excludes the requested project", async () => {
    mockedResolveScope.mockResolvedValue([6, 7]);

    const res = await GET(makeRequest("5"), params("5"));

    expect(res.status).toBe(403);
    expect(mockedGetCoverage).not.toHaveBeenCalled();
  });

  it("passes the viewer scope straight through as accessibleProjectIds", async () => {
    mockedResolveScope.mockResolvedValue(null);

    const res = await GET(makeRequest("5"), params("5"));

    expect(res.status).toBe(200);
    expect(mockedGetCoverage).toHaveBeenCalledWith(5, {
      accessibleProjectIds: null,
    });
  });

  it("serializes the service Map into a non-empty object keyed by requirement id", async () => {
    const breakdownOne = breakdown({ status: "PASSED" });
    const breakdownTwo = breakdown({
      status: "UNCOVERED",
      linkedCaseCount: 0,
      passed: 0,
      uncovered: true,
    });
    mockedGetCoverage.mockResolvedValue(
      new Map([
        [10, breakdownOne],
        [20, breakdownTwo],
      ])
    );

    const res = await GET(makeRequest("5"), params("5"));

    expect(res.status).toBe(200);
    const body = await res.json();
    const keys = Object.keys(body.coverage);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.sort()).toEqual(["10", "20"]);
    expect(body.coverage["10"]).toEqual(breakdownOne);
    expect(body.coverage["20"]).toEqual(breakdownTwo);
  });

  it("maps the service RangeError and integer guard to 400, not 500", async () => {
    mockedGetCoverage.mockRejectedValueOnce(
      new RangeError(
        "getRequirementCoverage: rootIds may not exceed 1000 entries, received 2000"
      )
    );
    const resRange = await GET(makeRequest("5"), params("5"));
    expect(resRange.status).toBe(400);

    mockedGetCoverage.mockRejectedValueOnce(
      new Error(
        "getRequirementCoverage: projectId must be an integer, received NaN"
      )
    );
    const resGuard = await GET(makeRequest("5"), params("5"));
    expect(resGuard.status).toBe(400);
  });

  it("never leaks the internal error message in a 500 body", async () => {
    mockedGetCoverage.mockRejectedValue(
      new Error("relation \"RepositoryCases\" does not exist")
    );

    const res = await GET(makeRequest("5"), params("5"));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("RepositoryCases");
  });
});
