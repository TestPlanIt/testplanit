// Converted from the it.todo scaffold (26-02) by 26-11. One handler derives
// both report variants from a single traceability load rather than two
// separate queries (D-2/D-3/COV-04) — see requirementCoverageReportUtils.ts's
// own header comment for the full rationale.

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

// The real (unmocked) module — toGapRows is the seam this suite is
// proving, so it stays real rather than mocked. Only the authorizer and
// the traceability load are stubbed.
vi.mock("~/utils/reportApiUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/reportApiUtils")>()),
  authorizeReportRequest: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { loadRequirementTraceability } from "~/lib/services/requirementTraceability";
import { authorizeReportRequest } from "~/utils/reportApiUtils";

import type { RequirementTraceabilityData } from "~/lib/services/requirementTraceability";
import type { RequirementTraceabilityRow } from "~/lib/services/requirementTraceabilityExport";

import { handleRequirementCoverageReportPOST } from "./requirementCoverageReportUtils";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedResolveScope = resolveViewerProjectScope as unknown as ReturnType<
  typeof vi.fn
>;
const mockedLoad = loadRequirementTraceability as unknown as ReturnType<
  typeof vi.fn
>;
const mockedAuthorize = authorizeReportRequest as unknown as ReturnType<
  typeof vi.fn
>;

function makeRequest(body: Record<string, unknown> | null): NextRequest {
  return new NextRequest("http://localhost/api/report-builder/whatever", {
    method: "POST",
    body: body === null ? undefined : JSON.stringify(body),
  });
}

function traceabilityData(
  rows: RequirementTraceabilityRow[]
): RequirementTraceabilityData {
  return {
    projectId: 5,
    projectName: "Project Five",
    generatedAt: "2026-08-23T00:00:00.000Z",
    rows,
  };
}

// One covered requirement (req 3, two covering cases) plus two uncovered
// requirements (req 1, req 2, each a single null-case row) — the covered
// requirement is what makes "returns only uncovered" a real assertion
// rather than one that would pass against a handler filtering nothing.
function fixtureRows(): RequirementTraceabilityRow[] {
  return [
    {
      requirementId: 1,
      requirementKey: "REQ-1",
      requirementTitle: "Requirement One",
      requirementPath: "REQ-1",
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
    {
      requirementId: 2,
      requirementKey: "REQ-2",
      requirementTitle: "Requirement Two",
      requirementPath: "REQ-2",
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
    {
      requirementId: 3,
      requirementKey: "REQ-3",
      requirementTitle: "Requirement Three",
      requirementPath: "REQ-3",
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
      requirementId: 3,
      requirementKey: "REQ-3",
      requirementTitle: "Requirement Three",
      requirementPath: "REQ-3",
      caseId: 11,
      caseName: "Case B",
      caseProjectId: 5,
      caseProjectName: "Project Five",
      statusName: "Passed",
      statusColor: "#00ff00",
      executedAt: "2026-08-02T00:00:00.000Z",
      linkedCaseCount: 2,
      coverageStatus: "PASSED",
    },
  ];
}

describe("requirementCoverageReportUtils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAuthorize.mockResolvedValue({ ok: true, bypass: false });
    mockedSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    mockedResolveScope.mockResolvedValue([5]);
    mockedLoad.mockResolvedValue(traceabilityData(fixtureRows()));
  });

  it("rejects a request with no projectId", async () => {
    const res = await handleRequirementCoverageReportPOST(
      makeRequest({}),
      "gaps"
    );

    expect(res.status).toBe(400);
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it("authorizes through the shared report request authorizer before reading", async () => {
    const forbidden = Response.json({ error: "Forbidden" }, { status: 403 });
    mockedAuthorize.mockResolvedValue({ ok: false, response: forbidden });

    const res = await handleRequirementCoverageReportPOST(
      makeRequest({ projectId: 5 }),
      "gaps"
    );

    expect(res.status).toBe(403);
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it("returns only uncovered requirements for the gaps variant", async () => {
    const res = await handleRequirementCoverageReportPOST(
      makeRequest({ projectId: 5 }),
      "gaps"
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.data).toHaveLength(2);
    const requirementIds = body.data.map(
      (row: { requirementId: number }) => row.requirementId
    );
    expect(requirementIds.sort()).toEqual([1, 2]);
    // The covered requirement (3) must never appear in the gap report.
    expect(requirementIds).not.toContain(3);
  });

  it("returns every requirement and covering case for the traceability variant", async () => {
    const res = await handleRequirementCoverageReportPOST(
      makeRequest({ projectId: 5 }),
      "traceability"
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(4);
    expect(body.data).toHaveLength(4);
    const req3Rows = body.data.filter(
      (row: { requirementId: number }) => row.requirementId === 3
    );
    expect(req3Rows).toHaveLength(2);
    expect(req3Rows.map((row: { testCaseId: number }) => row.testCaseId)).toEqual(
      [10, 11]
    );
    const gapRows = body.data.filter(
      (row: { testCaseId: number | null }) => row.testCaseId === null
    );
    expect(gapRows).toHaveLength(2);
  });

  it("derives both variants from one traceability load rather than two queries", async () => {
    await handleRequirementCoverageReportPOST(
      makeRequest({ projectId: 5 }),
      "gaps"
    );
    expect(mockedLoad).toHaveBeenCalledTimes(1);

    mockedLoad.mockClear();

    await handleRequirementCoverageReportPOST(
      makeRequest({ projectId: 5 }),
      "traceability"
    );
    expect(mockedLoad).toHaveBeenCalledTimes(1);
  });
});
