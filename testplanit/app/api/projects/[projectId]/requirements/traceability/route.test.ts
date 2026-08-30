// Converted from the it.todo scaffold (26-02) by 26-08. This route
// composes the shipped rollup + drill-down services rather than
// hand-rolling a third "latest result" query (26-PATTERNS.md,
// "Traceability matrix export").

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

vi.mock("~/lib/authContext", () => ({
  resolveViewerProjectScope: vi.fn(),
}));

vi.mock("~/lib/services/requirementTraceability", () => ({
  loadRequirementTraceability: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { loadRequirementTraceability } from "~/lib/services/requirementTraceability";

import type { RequirementTraceabilityData } from "~/lib/services/requirementTraceability";

import { GET } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedResolveScope = resolveViewerProjectScope as unknown as ReturnType<
  typeof vi.fn
>;
const mockedLoad = loadRequirementTraceability as unknown as ReturnType<
  typeof vi.fn
>;

function makeRequest(projectId = "5"): NextRequest {
  return new NextRequest(
    `http://localhost/api/projects/${projectId}/requirements/traceability`
  );
}

const params = (projectId = "5") => ({
  params: Promise.resolve({ projectId }),
});

function traceabilityData(
  overrides: Partial<RequirementTraceabilityData> = {}
): RequirementTraceabilityData {
  return {
    projectId: 5,
    projectName: "Project Five",
    generatedAt: "2026-08-23T00:00:00.000Z",
    rows: [],
    ...overrides,
  };
}

describe("GET /api/projects/[projectId]/requirements/traceability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    mockedResolveScope.mockResolvedValue([5]);
    mockedLoad.mockResolvedValue(traceabilityData());
  });

  it("returns 401 then 400 then 403 in that order", async () => {
    // 401 first: no session at all.
    mockedSession.mockResolvedValue(null);
    const unauthorized = await GET(makeRequest(), params());
    expect(unauthorized.status).toBe(401);
    expect(mockedResolveScope).not.toHaveBeenCalled();
    expect(mockedLoad).not.toHaveBeenCalled();

    // 400 next: a session exists, but the project id is not numeric.
    mockedSession.mockResolvedValue({ user: { id: "user-1", access: "USER" } });
    const badRequest = await GET(
      makeRequest("not-a-number"),
      params("not-a-number")
    );
    expect(badRequest.status).toBe(400);
    expect(mockedResolveScope).not.toHaveBeenCalled();
    expect(mockedLoad).not.toHaveBeenCalled();

    // 403 last: a session and a numeric id, but the viewer's scope
    // excludes the requested project.
    mockedResolveScope.mockResolvedValue([6, 7]);
    const forbidden = await GET(makeRequest(), params());
    expect(forbidden.status).toBe(403);
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it("emits one row per requirement and covering case", async () => {
    mockedLoad.mockResolvedValue(
      traceabilityData({
        rows: [
          {
            requirementId: 1,
            requirementKey: "REQ-1",
            requirementTitle: null,
            requirementPath: "REQ-1",
            requirementParentPath: "",
            caseId: 10,
            caseName: "Case A",
            caseProjectId: 5,
            caseProjectName: "Project Five",
            statusName: "Passed",
            statusColor: "#00ff00",
            executedAt: "2026-08-01T00:00:00.000Z",
            linkedCaseCount: 2,
            coverageStatus: "PASSED",
          },
          {
            requirementId: 1,
            requirementKey: "REQ-1",
            requirementTitle: null,
            requirementPath: "REQ-1",
            requirementParentPath: "",
            caseId: 11,
            caseName: "Case B",
            caseProjectId: 5,
            caseProjectName: "Project Five",
            statusName: null,
            statusColor: null,
            executedAt: null,
            linkedCaseCount: 2,
            coverageStatus: "PASSED",
          },
        ],
      })
    );

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0].caseId).toBe(10);
    expect(body.rows[1].caseId).toBe(11);
  });

  it("emits a single null-case row for a requirement with zero covering cases", async () => {
    mockedLoad.mockResolvedValue(
      traceabilityData({
        rows: [
          {
            requirementId: 2,
            requirementKey: "REQ-2",
            requirementTitle: null,
            requirementPath: "REQ-2",
            requirementParentPath: "",
            caseId: null,
            caseName: null,
            caseProjectId: null,
            caseProjectName: null,
            statusName: null,
            statusColor: null,
            executedAt: null,
            linkedCaseCount: 0,
            coverageStatus: "UNCOVERED",
          },
        ],
      })
    );

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].caseId).toBeNull();
    expect(body.rows[0].requirementId).toBe(2);
  });

  it("stamps generatedAt and projectId onto the envelope", async () => {
    mockedLoad.mockResolvedValue(
      traceabilityData({
        projectId: 5,
        projectName: "Project Five",
        generatedAt: "2026-08-23T12:34:56.000Z",
      })
    );

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projectId).toBe(5);
    expect(body.projectName).toBe("Project Five");
    expect(body.generatedAt).toBe("2026-08-23T12:34:56.000Z");
    expect(mockedLoad).toHaveBeenCalledWith(5, { accessibleProjectIds: [5] });
  });
});
