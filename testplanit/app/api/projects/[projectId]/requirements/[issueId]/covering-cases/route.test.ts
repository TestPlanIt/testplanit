// Converted from the it.todo scaffold (26-02) by 26-07. The route wraps
// the same closure builder the rollup consumes (26-PATTERNS.md,
// "Covering-case drill-down") so it can never resolve a different case
// set than the badge sitting above it.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

vi.mock("~/lib/authContext", () => ({
  resolveViewerProjectScope: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    issue: { findFirst: vi.fn() },
    repositoryCaseIssue: { findMany: vi.fn() },
  },
}));

vi.mock("~/lib/services/requirementCoverage", () => ({
  getRequirementCoveringCases: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { baseDb } from "~/lib/db";
import { getRequirementCoveringCases } from "~/lib/services/requirementCoverage";

import type { RequirementCoveringCase } from "~/lib/services/requirementCoverage";

import { GET } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedResolveScope = resolveViewerProjectScope as unknown as ReturnType<
  typeof vi.fn
>;
const mockedFindFirst = baseDb.issue.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockedDirectFindMany = baseDb.repositoryCaseIssue
  .findMany as unknown as ReturnType<typeof vi.fn>;
const mockedGetCoveringCases =
  getRequirementCoveringCases as unknown as ReturnType<typeof vi.fn>;

function makeRequest(projectId = "5", issueId = "10"): NextRequest {
  return new NextRequest(
    `http://localhost/api/projects/${projectId}/requirements/${issueId}/covering-cases`
  );
}

const params = (projectId = "5", issueId = "10") => ({
  params: Promise.resolve({ projectId, issueId }),
});

function coveringCase(
  overrides: Partial<RequirementCoveringCase> = {}
): RequirementCoveringCase {
  return {
    caseId: 100,
    caseName: "Case 100",
    projectId: 5,
    projectName: "Project Five",
    lastStatusName: "Passed",
    lastStatusColor: "#00ff00",
    lastStatusIsSuccess: true,
    lastStatusIsFailure: false,
    lastExecutedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("GET /api/projects/[projectId]/requirements/[issueId]/covering-cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    mockedResolveScope.mockResolvedValue([5]);
    mockedFindFirst.mockResolvedValue({ id: 10 });
    mockedDirectFindMany.mockResolvedValue([]);
    mockedGetCoveringCases.mockResolvedValue(new Map());
  });

  it("returns 404 when the addressed issue is not a live requirement in this project", async () => {
    // Represents a requirement that lives in a DIFFERENT project — the
    // pre-check binds projectId (from the URL) into the query, so a
    // real Postgres client would return null for it exactly as this
    // mock does. Asserting the where clause carries the URL's
    // projectId is what makes this test fail if that binding is ever
    // dropped, rather than merely happening to pass because the mock
    // always returns null.
    mockedFindFirst.mockResolvedValue(null);

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(404);
    expect(mockedFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 10,
          projectId: 5,
          isDeleted: false,
        }),
      })
    );
    expect(mockedGetCoveringCases).not.toHaveBeenCalled();
  });

  it("returns 404 when the addressed id is a defect rather than a requirement", async () => {
    // The pre-check spreads REQUIREMENT_SCOPE_WHERE into the query — a
    // defect row never matches it, so the mocked pre-check returns null
    // exactly as it would for a genuinely missing row. Asserting the
    // where clause carries isRequirement: true is what makes this test
    // fail if that spread is ever dropped, distinct from the
    // cross-project test above which asserts the projectId half.
    mockedFindFirst.mockResolvedValue(null);

    const res = await GET(makeRequest("5", "999"), params("5", "999"));

    expect(res.status).toBe(404);
    expect(mockedFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 999,
          isRequirement: true,
        }),
      })
    );
    expect(mockedGetCoveringCases).not.toHaveBeenCalled();
  });

  it("returns 403 before it performs the row lookup", async () => {
    mockedResolveScope.mockResolvedValue([6, 7]);

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(403);
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(mockedGetCoveringCases).not.toHaveBeenCalled();
  });

  it("returns the extended covering-case rows with each case's latest result", async () => {
    const caseOne = coveringCase({ caseId: 100 });
    mockedGetCoveringCases.mockResolvedValue(new Map([[10, [caseOne]]]));

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requirementId).toBe(10);
    expect(body.cases).toHaveLength(1);
    expect(body.cases[0]).toMatchObject({
      caseId: 100,
      lastStatusName: "Passed",
      lastStatusIsSuccess: true,
      lastStatusIsFailure: false,
      lastExecutedAt: "2026-08-01T00:00:00.000Z",
    });
  });

  it("marks a case linked directly to this requirement as direct and an inherited one as not", async () => {
    const directCase = coveringCase({ caseId: 100 });
    const inheritedCase = coveringCase({ caseId: 200 });
    mockedGetCoveringCases.mockResolvedValue(
      new Map([[10, [directCase, inheritedCase]]])
    );
    mockedDirectFindMany.mockResolvedValue([{ caseId: 100 }]);

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(200);
    const body = await res.json();
    const byCaseId = Object.fromEntries(
      (body.cases as Array<{ caseId: number; direct: boolean }>).map((row) => [
        row.caseId,
        row.direct,
      ])
    );
    expect(byCaseId[100]).toBe(true);
    expect(byCaseId[200]).toBe(false);
  });

  it("returns an empty list, not an error, for a requirement with no covering cases", async () => {
    mockedGetCoveringCases.mockResolvedValue(new Map());

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cases).toEqual([]);
  });
});
