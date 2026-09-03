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

vi.mock("~/lib/api-token-auth", () => ({
  authenticateRequest: vi.fn(),
}));

// The cross-project variants resolve their anchor set from the projects
// table (every project with requirements enabled); the project-scoped
// variants never touch it.
const mockedProjectsFindMany = vi.fn();
vi.mock("~/lib/db", () => ({
  baseDb: {
    projects: { findMany: (...args: any[]) => mockedProjectsFindMany(...args) },
  },
}));

vi.mock("~/lib/services/requirementTraceability", () => ({
  loadRequirementTraceability: vi.fn(),
}));

// Only the snapshot LOAD is stubbed; the unfold back into matrix rows
// (`toSnapshotTraceabilityData`) stays real — that seam is what the
// snapshot branch is proving.
vi.mock(
  "~/lib/services/requirementTraceabilitySnapshot",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("~/lib/services/requirementTraceabilitySnapshot")
    >()),
    loadRequirementTraceabilitySnapshot: vi.fn(),
  })
);

// The real (unmocked) module — toGapRows is the seam this suite is
// proving, so it stays real rather than mocked. Only the authorizer and
// the traceability load are stubbed.
vi.mock("~/utils/reportApiUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/reportApiUtils")>()),
  authorizeReportRequest: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { authenticateRequest } from "~/lib/api-token-auth";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { loadRequirementTraceability } from "~/lib/services/requirementTraceability";
import { loadRequirementTraceabilitySnapshot } from "~/lib/services/requirementTraceabilitySnapshot";
import { groupTraceabilityRows } from "~/lib/services/requirementTraceabilitySnapshotShape";
import { authorizeReportRequest } from "~/utils/reportApiUtils";

import type { RequirementTraceabilityData } from "~/lib/services/requirementTraceability";
import type { RequirementTraceabilityRow } from "~/lib/services/requirementTraceabilityExport";

import {
  handleRequirementCoverageChangesPOST,
  handleRequirementCoverageReportPOST,
} from "./requirementCoverageReportUtils";

const mockedLoadSnapshot =
  loadRequirementTraceabilitySnapshot as unknown as ReturnType<typeof vi.fn>;

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
const mockedAuthenticateRequest = authenticateRequest as unknown as ReturnType<
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
    {
      requirementId: 2,
      requirementKey: "REQ-2",
      requirementTitle: "Requirement Two",
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
    {
      requirementId: 3,
      requirementKey: "REQ-3",
      requirementTitle: "Requirement Three",
      requirementPath: "REQ-3",
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
      requirementId: 3,
      requirementKey: "REQ-3",
      requirementTitle: "Requirement Three",
      requirementPath: "REQ-3",
      requirementParentPath: "",
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
    // Mirrors authenticateRequest's real session-first behavior for a
    // signed-in caller, without touching the DB-backed API-token path.
    mockedAuthenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { userId: "user-1", access: "USER" },
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
    expect(
      req3Rows.map((row: { testCaseId: number }) => row.testCaseId)
    ).toEqual([10, 11]);
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

  // F1 [CRITICAL]: the shared-report bypass branch must never resolve to an
  // unrestricted (null) scope — that leaks every project's covering cases
  // through a public share link. Asserting the exact array (not just
  // "did not throw") means reverting to `accessibleProjectIds = null` fails
  // this test loudly.
  it("scopes the bypass branch to the requested project, never to unrestricted null", async () => {
    mockedAuthorize.mockResolvedValue({ ok: true, bypass: true });

    const res = await handleRequirementCoverageReportPOST(
      makeRequest({ projectId: 5 }),
      "gaps"
    );

    expect(res.status).toBe(200);
    expect(mockedLoad).toHaveBeenCalledWith(5, {
      accessibleProjectIds: [5],
    });
    // The bypass branch has no authenticated viewer to resolve a scope
    // from, so it must not consult the per-user resolver at all.
    expect(mockedResolveScope).not.toHaveBeenCalled();
  });

  describe("coverage-debt tiers and the coverage-state filter", () => {
    function notRunRows(): RequirementTraceabilityRow[] {
      // REQ-9: two covering-case rows, both never executed — classified
      // NOT_RUN. Must collapse to ONE tier-2 row, and only when the
      // caller opts in.
      const base = fixtureRows();
      const notRunRow = (caseId: number): RequirementTraceabilityRow => ({
        requirementId: 9,
        requirementKey: "REQ-9",
        requirementTitle: "Requirement Nine",
        requirementPath: "REQ-9",
        requirementParentPath: "",
        caseId,
        caseName: `Case ${caseId}`,
        caseProjectId: 5,
        caseProjectName: "Project Five",
        statusName: null,
        statusColor: null,
        executedAt: null,
        linkedCaseCount: 2,
        coverageStatus: "NOT_RUN",
      });
      return [...base, notRunRow(20), notRunRow(21)];
    }

    it("gaps stays tier-1 only without the opt-in", async () => {
      mockedLoad.mockResolvedValue(traceabilityData(notRunRows()));

      const res = await handleRequirementCoverageReportPOST(
        makeRequest({ projectId: 5 }),
        "gaps"
      );

      const body = await res.json();
      expect(body.total).toBe(2);
      expect(
        body.data.every(
          (row: { coverageStatus: string }) =>
            row.coverageStatus === "UNCOVERED"
        )
      ).toBe(true);
    });

    it("includeNotRun adds ONE deduped tier-2 row per never-run requirement", async () => {
      mockedLoad.mockResolvedValue(traceabilityData(notRunRows()));

      const res = await handleRequirementCoverageReportPOST(
        makeRequest({ projectId: 5, includeNotRun: true }),
        "gaps"
      );

      const body = await res.json();
      expect(body.total).toBe(3);
      const tier2 = body.data.filter(
        (row: { coverageStatus: string }) => row.coverageStatus === "NOT_RUN"
      );
      expect(tier2).toHaveLength(1);
      expect(tier2[0].requirementId).toBe(9);
      // Tier 2 keeps its linked count — the distinguishing signal beside
      // tier 1's zero.
      expect(tier2[0].linkedCases).toBe(2);
    });

    it("filters the traceability variant to the requested coverage states server-side", async () => {
      const res = await handleRequirementCoverageReportPOST(
        makeRequest({ projectId: 5, coverageStates: ["UNCOVERED"] }),
        "traceability"
      );

      const body = await res.json();
      // Only the two uncovered requirements' gap rows survive; REQ-3's
      // PASSED pair rows are filtered out — and total describes the
      // FILTERED set, so counts, CSV, and viz agree with the table.
      expect(body.total).toBe(2);
      expect(
        body.data.every(
          (row: { coverageStatus: string }) =>
            row.coverageStatus === "UNCOVERED"
        )
      ).toBe(true);
    });

    it("rejects an unknown coverage state with a 400 before loading", async () => {
      const res = await handleRequirementCoverageReportPOST(
        makeRequest({ projectId: 5, coverageStates: ["BOGUS"] }),
        "traceability"
      );

      expect(res.status).toBe(400);
      expect(mockedLoad).not.toHaveBeenCalled();
    });
  });

  describe("requirementIds scope parameter", () => {
    it("passes the scope through to the loader as rootIds", async () => {
      const res = await handleRequirementCoverageReportPOST(
        makeRequest({ projectId: 5, requirementIds: [7, 9] }),
        "traceability"
      );

      expect(res.status).toBe(200);
      expect(mockedLoad).toHaveBeenCalledWith(
        5,
        { accessibleProjectIds: [5] },
        undefined,
        { rootIds: [7, 9] }
      );
    });

    it.each([[null], [[]]])(
      "treats %j as whole-project (the unscoped two-argument call)",
      async (requirementIds) => {
        const res = await handleRequirementCoverageReportPOST(
          makeRequest({ projectId: 5, requirementIds }),
          "gaps"
        );

        expect(res.status).toBe(200);
        expect(mockedLoad).toHaveBeenCalledWith(5, {
          accessibleProjectIds: [5],
        });
      }
    );

    it.each([["not-an-array"], [[1.5]], [[0]], [[-3]], [["seven"]]])(
      "rejects malformed requirementIds %j with a 400 before loading",
      async (requirementIds) => {
        const res = await handleRequirementCoverageReportPOST(
          makeRequest({ projectId: 5, requirementIds }),
          "gaps"
        );

        expect(res.status).toBe(400);
        expect(mockedLoad).not.toHaveBeenCalled();
      }
    );

    it("rejects a scope list past the rollup's own root cap", async () => {
      const res = await handleRequirementCoverageReportPOST(
        makeRequest({
          projectId: 5,
          requirementIds: Array.from({ length: 1001 }, (_, i) => i + 1),
        }),
        "gaps"
      );

      expect(res.status).toBe(400);
      expect(mockedLoad).not.toHaveBeenCalled();
    });
  });

  // F3/F4 [WARNING]: a Bearer-token-authenticated caller has no NextAuth
  // session. authorizeReportRequest already authenticates it (via its own
  // session-then-token fallback) and returns { ok: true, bypass: false };
  // the handler must resolve the real scope from that same fallback rather
  // than dereferencing a session that is null for this caller.
  it("resolves a correctly-scoped response for a token-authenticated caller with no session", async () => {
    mockedAuthorize.mockResolvedValue({ ok: true, bypass: false });
    mockedSession.mockResolvedValue(null);
    mockedAuthenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { userId: "token-user-1", access: "USER" },
    });
    mockedResolveScope.mockResolvedValue([5]);

    const res = await handleRequirementCoverageReportPOST(
      makeRequest({ projectId: 5 }),
      "gaps"
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(mockedResolveScope).toHaveBeenCalledWith("token-user-1");
    expect(mockedLoad).toHaveBeenCalledWith(5, {
      accessibleProjectIds: [5],
    });
  });
});

// ---------------------------------------------------------------------------
// Snapshots: the traceability/gaps handler renders a persisted snapshot in
// place of the live matrix, and the changes handler diffs a baseline
// snapshot against a later snapshot or the live matrix.
// ---------------------------------------------------------------------------

function loadedSnapshot(
  rows: RequirementTraceabilityRow[],
  overrides: Partial<{
    id: number;
    name: string;
    projectId: number;
    scopeMilestoneIds: number[];
    scopeConfigIds: number[];
  }> = {}
) {
  const entries = groupTraceabilityRows(rows);
  return {
    snapshot: {
      id: overrides.id ?? 77,
      projectId: overrides.projectId ?? 5,
      name: overrides.name ?? "Release sign-off",
      note: null,
      capturedById: "user-1",
      capturedAt: new Date("2026-08-15T09:00:00.000Z"),
      scopeRequirementIds: [],
      scopeMilestoneIds: overrides.scopeMilestoneIds ?? [],
      scopeConfigIds: overrides.scopeConfigIds ?? [],
      requirementCount: entries.length,
      passedCount: 0,
      failedCount: 0,
      notRunCount: 0,
      uncoveredCount: 0,
      caseLinkCount: 0,
    },
    projectName: "Project Five",
    entries,
  };
}

describe("snapshot rendering (gaps/traceability)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAuthorize.mockResolvedValue({ ok: true, bypass: false });
    mockedSession.mockResolvedValue({ user: { id: "user-1", access: "USER" } });
    mockedAuthenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { userId: "user-1", access: "USER" },
    });
    mockedResolveScope.mockResolvedValue([5]);
    mockedLoad.mockResolvedValue(traceabilityData(fixtureRows()));
    mockedLoadSnapshot.mockResolvedValue(loadedSnapshot(fixtureRows()));
  });

  it("serves the snapshot's rows instead of loading the live matrix", async () => {
    const response = await handleRequirementCoverageReportPOST(
      makeRequest({ projectId: 5, snapshotId: 77 }),
      "traceability"
    );
    expect(response.status).toBe(200);
    expect(mockedLoadSnapshot).toHaveBeenCalledWith(77, 5);
    expect(mockedLoad).not.toHaveBeenCalled();
    const json = await response.json();
    // The same four pair rows the live fixture produces, unfolded from
    // the stored entries.
    expect(json.total).toBe(4);
    expect(
      json.data.map((row: any) => [row.requirementKey, row.testCaseName])
    ).toEqual([
      ["REQ-1", null],
      ["REQ-2", null],
      ["REQ-3", "Case A"],
      ["REQ-3", "Case B"],
    ]);
  });

  it("feeds the gaps variant from the snapshot too", async () => {
    const response = await handleRequirementCoverageReportPOST(
      makeRequest({ projectId: 5, snapshotId: 77, includeNotRun: false }),
      "gaps"
    );
    const json = await response.json();
    expect(mockedLoad).not.toHaveBeenCalled();
    expect(json.data.map((row: any) => row.requirementKey)).toEqual([
      "REQ-1",
      "REQ-2",
    ]);
  });

  it("404s a snapshot that is not a live record of this project, before any live load", async () => {
    mockedLoadSnapshot.mockResolvedValue(null);
    const response = await handleRequirementCoverageReportPOST(
      makeRequest({ projectId: 5, snapshotId: 77 }),
      "traceability"
    );
    expect(response.status).toBe(404);
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it("400s a malformed snapshotId and treats null as live", async () => {
    const bad = await handleRequirementCoverageReportPOST(
      makeRequest({ projectId: 5, snapshotId: "seventy-seven" }),
      "traceability"
    );
    expect(bad.status).toBe(400);
    expect(mockedLoadSnapshot).not.toHaveBeenCalled();

    const live = await handleRequirementCoverageReportPOST(
      makeRequest({ projectId: 5, snapshotId: null }),
      "traceability"
    );
    expect(live.status).toBe(200);
    expect(mockedLoad).toHaveBeenCalledTimes(1);
    expect(mockedLoadSnapshot).not.toHaveBeenCalled();
  });

  it("refuses an execution scope beside a snapshotId — the capture froze its own frame", async () => {
    const response = await handleRequirementCoverageReportPOST(
      makeRequest({ projectId: 5, snapshotId: 77, milestoneIds: [9] }),
      "traceability"
    );
    expect(response.status).toBe(400);
    expect(mockedLoadSnapshot).not.toHaveBeenCalled();
  });

  it("threads a live request's execution scope into the loader", async () => {
    const response = await handleRequirementCoverageReportPOST(
      makeRequest({ projectId: 5, milestoneIds: [9], configIds: [4] }),
      "traceability"
    );
    expect(response.status).toBe(200);
    expect(mockedLoad).toHaveBeenCalledWith(
      5,
      { accessibleProjectIds: [5] },
      undefined,
      {
        rootIds: undefined,
        executionScope: { milestoneIds: [9], configIds: [4] },
      }
    );
  });

  it("applies the coverage-state filter and the scope to the snapshot's rows", async () => {
    const filtered = await handleRequirementCoverageReportPOST(
      makeRequest({ projectId: 5, snapshotId: 77, coverageStates: ["PASSED"] }),
      "traceability"
    );
    const filteredJson = await filtered.json();
    expect(filteredJson.data.map((row: any) => row.requirementKey)).toEqual([
      "REQ-3",
      "REQ-3",
    ]);

    const scoped = await handleRequirementCoverageReportPOST(
      makeRequest({ projectId: 5, snapshotId: 77, requirementIds: [2] }),
      "traceability"
    );
    const scopedJson = await scoped.json();
    expect(scopedJson.data.map((row: any) => row.requirementKey)).toEqual([
      "REQ-2",
    ]);
  });
});

describe("handleRequirementCoverageChangesPOST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAuthorize.mockResolvedValue({ ok: true, bypass: false });
    mockedSession.mockResolvedValue({ user: { id: "user-1", access: "USER" } });
    mockedAuthenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { userId: "user-1", access: "USER" },
    });
    mockedResolveScope.mockResolvedValue([5]);
  });

  // The live matrix has moved on from the baseline: REQ-1 gained a case,
  // REQ-2 is unchanged, REQ-3 is gone, REQ-4 is new.
  function laterRows(): RequirementTraceabilityRow[] {
    const rows = fixtureRows();
    const req1 = rows[0];
    const covered1: RequirementTraceabilityRow = {
      ...req1,
      caseId: 20,
      caseName: "Case N",
      caseProjectId: 5,
      caseProjectName: "Project Five",
      statusName: null,
      statusColor: null,
      executedAt: null,
      linkedCaseCount: 1,
      coverageStatus: "NOT_RUN",
    };
    const req4: RequirementTraceabilityRow = {
      ...rows[1],
      requirementId: 4,
      requirementKey: "REQ-4",
      requirementTitle: "Requirement Four",
      requirementPath: "REQ-4",
    };
    return [covered1, rows[1], req4];
  }

  it("400s without a baseline snapshot id", async () => {
    const response = await handleRequirementCoverageChangesPOST(
      makeRequest({ projectId: 5 })
    );
    expect(response.status).toBe(400);
    expect(mockedLoadSnapshot).not.toHaveBeenCalled();
  });

  it("404s a baseline that does not resolve in this project", async () => {
    mockedLoadSnapshot.mockResolvedValue(null);
    const response = await handleRequirementCoverageChangesPOST(
      makeRequest({ projectId: 5, baselineSnapshotId: 77 })
    );
    expect(response.status).toBe(404);
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it("diffs the baseline against the LIVE matrix by default and lists only changed rows", async () => {
    mockedLoadSnapshot.mockResolvedValue(loadedSnapshot(fixtureRows()));
    mockedLoad.mockResolvedValue(traceabilityData(laterRows()));

    const response = await handleRequirementCoverageChangesPOST(
      makeRequest({ projectId: 5, baselineSnapshotId: 77 })
    );
    expect(response.status).toBe(200);
    // Third/fourth arguments: the db default and the options bag — both
    // undefined here because an UNscoped baseline inherits no execution
    // frame onto the live side.
    expect(mockedLoad).toHaveBeenCalledWith(
      5,
      { accessibleProjectIds: [5] },
      undefined,
      undefined
    );
    const json = await response.json();
    expect(
      json.data.map((row: any) => [row.requirementKey, row.changeKind])
    ).toEqual([
      ["REQ-1", "COVERAGE_CHANGED"],
      ["REQ-3", "REMOVED"],
      ["REQ-4", "ADDED"],
    ]);
    // DataTable ids are dense and unique.
    expect(json.data.map((row: any) => row.id)).toEqual([0, 1, 2]);
  });

  it("includes unchanged rows on request", async () => {
    mockedLoadSnapshot.mockResolvedValue(loadedSnapshot(fixtureRows()));
    mockedLoad.mockResolvedValue(traceabilityData(laterRows()));

    const response = await handleRequirementCoverageChangesPOST(
      makeRequest({
        projectId: 5,
        baselineSnapshotId: 77,
        includeUnchanged: true,
      })
    );
    const json = await response.json();
    expect(json.data.map((row: any) => row.changeKind)).toContain("UNCHANGED");
    expect(json.total).toBe(4);
  });

  it("compares two snapshots without touching the live matrix", async () => {
    mockedLoadSnapshot.mockImplementation(async (id: number) =>
      id === 77
        ? loadedSnapshot(fixtureRows())
        : loadedSnapshot(laterRows(), { id: 78, name: "Later" })
    );

    const response = await handleRequirementCoverageChangesPOST(
      makeRequest({
        projectId: 5,
        baselineSnapshotId: 77,
        compareSnapshotId: 78,
      })
    );
    expect(response.status).toBe(200);
    expect(mockedLoad).not.toHaveBeenCalled();
    expect(mockedLoadSnapshot).toHaveBeenCalledWith(77, 5);
    expect(mockedLoadSnapshot).toHaveBeenCalledWith(78, 5);
    const json = await response.json();
    expect(json.total).toBe(3);
  });

  it("404s a comparison snapshot that does not resolve", async () => {
    mockedLoadSnapshot.mockImplementation(async (id: number) =>
      id === 77 ? loadedSnapshot(fixtureRows()) : null
    );
    const response = await handleRequirementCoverageChangesPOST(
      makeRequest({
        projectId: 5,
        baselineSnapshotId: 77,
        compareSnapshotId: 99,
      })
    );
    expect(response.status).toBe(404);
  });

  it("scopes both sides to the selected subtrees", async () => {
    mockedLoadSnapshot.mockResolvedValue(loadedSnapshot(fixtureRows()));
    mockedLoad.mockResolvedValue(traceabilityData(laterRows()));

    const response = await handleRequirementCoverageChangesPOST(
      makeRequest({ projectId: 5, baselineSnapshotId: 77, requirementIds: [3] })
    );
    const json = await response.json();
    // Only REQ-3 is in scope on either side: it was removed.
    expect(
      json.data.map((row: any) => [row.requirementKey, row.changeKind])
    ).toEqual([["REQ-3", "REMOVED"]]);
  });

  it("refuses request-level execution-scope keys — the frame comes from the baseline", async () => {
    const response = await handleRequirementCoverageChangesPOST(
      makeRequest({ projectId: 5, baselineSnapshotId: 77, milestoneIds: [9] })
    );
    expect(response.status).toBe(400);
    expect(mockedLoadSnapshot).not.toHaveBeenCalled();
  });

  it("applies a scoped baseline's frozen frame to the live side", async () => {
    mockedLoadSnapshot.mockResolvedValue(
      loadedSnapshot(fixtureRows(), {
        scopeMilestoneIds: [9],
        scopeConfigIds: [4],
      })
    );
    mockedLoad.mockResolvedValue(traceabilityData(laterRows()));

    const response = await handleRequirementCoverageChangesPOST(
      makeRequest({ projectId: 5, baselineSnapshotId: 77 })
    );
    expect(response.status).toBe(200);
    expect(mockedLoad).toHaveBeenCalledWith(
      5,
      { accessibleProjectIds: [5] },
      undefined,
      { executionScope: { milestoneIds: [9], configIds: [4] } }
    );
  });

  it("refuses to diff two snapshots captured under different execution scopes", async () => {
    mockedLoadSnapshot
      .mockResolvedValueOnce(
        loadedSnapshot(fixtureRows(), { scopeMilestoneIds: [9] })
      )
      .mockResolvedValueOnce(
        loadedSnapshot(laterRows(), { id: 78, scopeMilestoneIds: [12] })
      );

    const response = await handleRequirementCoverageChangesPOST(
      makeRequest({
        projectId: 5,
        baselineSnapshotId: 77,
        compareSnapshotId: 78,
      })
    );
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toMatch(/different execution scopes/);
  });
});

// Phase 26 deliberately carved the cross-project variants out (carve-out
// 3) because getRequirementCoverage anchored on a single project id. The
// rollup now anchors on a LIST, so both variants have a cross-project
// twin — ADMIN-gated, anchored on every requirements-enabled project, and
// with no snapshot form at all.
describe("requirement coverage reports — cross-project variants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAuthorize.mockResolvedValue({ ok: true, bypass: false });
    mockedSession.mockResolvedValue({
      user: { id: "admin-1", access: "ADMIN" },
    });
    mockedAuthenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { userId: "admin-1", access: "ADMIN" },
    });
    mockedProjectsFindMany.mockResolvedValue([{ id: 5 }, { id: 9 }]);
    mockedLoad.mockResolvedValue(traceabilityData(fixtureRows()));
  });

  it("gates on ADMIN and asks for no single project", async () => {
    await handleRequirementCoverageReportPOST(makeRequest({}), "gaps", true);

    expect(mockedAuthorize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requiresAdmin: true, projectId: undefined })
    );
  });

  it("runs without a projectId, which the project-scoped variant rejects", async () => {
    const res = await handleRequirementCoverageReportPOST(
      makeRequest({}),
      "gaps",
      true
    );

    expect(res.status).toBe(200);
    expect(mockedLoad).toHaveBeenCalled();
  });

  it("anchors on every requirements-enabled project, not on one", async () => {
    await handleRequirementCoverageReportPOST(
      makeRequest({}),
      "traceability",
      true
    );

    // The anchor list, not a scalar — this is the whole point of the
    // rollup's multi-project closure.
    expect(mockedLoad).toHaveBeenCalledWith([5, 9], expect.anything());
    expect(mockedProjectsFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ requirementsEnabled: true }),
      })
    );
  });

  it("refuses a snapshotId instead of quietly returning live data", async () => {
    // A snapshot is captured from one project and pinned to it, so there
    // is no cross-project snapshot to load. Silently ignoring the
    // parameter would serve live rows under a snapshot's name.
    const res = await handleRequirementCoverageReportPOST(
      makeRequest({ snapshotId: 7 }),
      "gaps",
      true
    );

    expect(res.status).toBe(400);
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it("names each row's own requirement project so a row's origin is visible", async () => {
    mockedLoad.mockResolvedValue(
      traceabilityData([
        {
          ...fixtureRows()[0],
          requirementProjectId: 9,
          requirementProjectName: "Project Nine",
        },
      ])
    );

    const res = await handleRequirementCoverageReportPOST(
      makeRequest({}),
      "traceability",
      true
    );
    const json = await res.json();

    expect(json.data[0].requirementProjectId).toBe(9);
    expect(json.data[0].requirementProjectName).toBe("Project Nine");
  });
  it("narrows the anchor set to the picked projects, intersected with the enabled ones", async () => {
    mockedProjectsFindMany.mockResolvedValue([{ id: 9 }]);

    await handleRequirementCoverageReportPOST(
      makeRequest({ projectIds: [9, 12345] }),
      "traceability",
      true
    );

    // The picked ids are a WHERE narrowing, never the anchor list itself --
    // a crafted id cannot pull in a project with requirements switched off.
    expect(mockedProjectsFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          requirementsEnabled: true,
          id: { in: [9, 12345] },
        }),
      })
    );
    expect(mockedLoad).toHaveBeenCalledWith([9], expect.anything());
  });

  it("filters the shared matrix rows by priority and status before either variant shapes them", async () => {
    mockedLoad.mockResolvedValue(
      traceabilityData([
        {
          ...fixtureRows()[0],
          requirementPriority: "High",
          requirementStatus: "Open",
        },
        {
          ...fixtureRows()[1],
          requirementPriority: "Low",
          requirementStatus: "Open",
        },
      ])
    );

    const res = await handleRequirementCoverageReportPOST(
      makeRequest({ priorities: ["High"] }),
      "traceability",
      true
    );
    const json = await res.json();

    expect(json.data).toHaveLength(1);
    expect(json.data[0].requirementKey).toBe(fixtureRows()[0].requirementKey);
  });

  it("rejects a malformed priority or status filter rather than ignoring it", async () => {
    const badPriority = await handleRequirementCoverageReportPOST(
      makeRequest({ priorities: "High" }),
      "gaps",
      true
    );
    const badStatus = await handleRequirementCoverageReportPOST(
      makeRequest({ statuses: [7] }),
      "gaps",
      true
    );

    expect(badPriority.status).toBe(400);
    expect(badStatus.status).toBe(400);
    expect(mockedLoad).not.toHaveBeenCalled();
  });
});
