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

vi.mock("~/lib/services/requirementTree", () => ({
  REQUIREMENT_LAZY_THRESHOLD: 500,
  countProjectRequirements: vi.fn(),
  countProjectRequirementRoots: vi.fn(),
  getRequirementFilterFacets: vi.fn(),
  getRequirementRootsPage: vi.fn(),
  resolveRequirementMatches: vi.fn(),
  // The sort CONSTANTS are real values, not stubs: the route builds its own
  // zod schema out of `REQUIREMENT_SORT_COLUMNS`, so a stubbed-away column
  // list would make every sort test assert against a schema the production
  // route does not have.
  REQUIREMENT_SORT_COLUMNS: [
    "name",
    "status",
    "priority",
    "source",
    "createdAt",
    "coverage",
    "linkedCases",
    "coveringCases",
  ],
  COVERAGE_DERIVED_SORT_COLUMNS: ["coverage", "linkedCases", "coveringCases"],
  DEFAULT_REQUIREMENT_SORT: { column: "name", direction: "asc" },
}));

import { getServerSession } from "next-auth";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { getRequirementCoverage } from "~/lib/services/requirementCoverage";
import type { RequirementCoverageBreakdown } from "~/lib/services/requirementCoverage";
import {
  countProjectRequirements,
  countProjectRequirementRoots,
  getRequirementFilterFacets,
  getRequirementRootsPage,
  resolveRequirementMatches,
} from "~/lib/services/requirementTree";
import type { RequirementTreeRow } from "~/lib/services/requirementTree";

import { GET, POST } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedResolveScope = resolveViewerProjectScope as unknown as ReturnType<
  typeof vi.fn
>;
const mockedGetCoverage = getRequirementCoverage as unknown as ReturnType<
  typeof vi.fn
>;
const mockedCountProjectRequirements =
  countProjectRequirements as unknown as ReturnType<typeof vi.fn>;
const mockCountRoots = countProjectRequirementRoots as unknown as ReturnType<
  typeof vi.fn
>;
const mockedGetRequirementFilterFacets =
  getRequirementFilterFacets as unknown as ReturnType<typeof vi.fn>;
const mockedGetRequirementRootsPage =
  getRequirementRootsPage as unknown as ReturnType<typeof vi.fn>;
const mockedResolveRequirementMatches =
  resolveRequirementMatches as unknown as ReturnType<typeof vi.fn>;

function makeRow(
  overrides: Partial<RequirementTreeRow> = {}
): RequirementTreeRow {
  return {
    id: 1,
    name: "REQ-001",
    title: "A requirement",
    status: null,
    externalStatus: null,
    priority: null,
    externalPriority: null,
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
    parentId: null,
    isRequirement: true,
    requirementDetachedAt: null,
    isDeleted: false,
    hasChildren: false,
    ...overrides,
  };
}

function breakdown(
  overrides: Partial<RequirementCoverageBreakdown> = {}
): RequirementCoverageBreakdown {
  return {
    linkedCaseCount: 0,
    crossProjectCaseCount: 0,
    directCaseCount: 0,
    directCrossProjectCaseCount: 0,
    passed: 0,
    failed: 0,
    inProgress: 0,
    notRun: 0,
    statuses: [],
    untested: 0,
    uncovered: true,
    status: "UNCOVERED",
    ...overrides,
  };
}

function makeGetRequest(projectId = "5", query = ""): NextRequest {
  return new NextRequest(
    `http://localhost/api/projects/${projectId}/requirements/tree${query}`
  );
}

function makePostRequest(projectId = "5", body?: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/projects/${projectId}/requirements/tree`,
    {
      method: "POST",
      ...(body !== undefined
        ? {
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
          }
        : {}),
    }
  );
}

const params = (projectId = "5") => ({
  params: Promise.resolve({ projectId }),
});

describe("GET /api/projects/[projectId]/requirements/tree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    mockedResolveScope.mockResolvedValue([5]);
    mockedCountProjectRequirements.mockResolvedValue(10);
    mockedGetRequirementRootsPage.mockResolvedValue({
      rows: [makeRow()],
      nextCursor: null,
    });
  });

  it("returns 401 before it looks at the project id", async () => {
    mockedSession.mockResolvedValue(null);

    const res = await GET(
      makeGetRequest("not-a-number"),
      params("not-a-number")
    );

    expect(res.status).toBe(401);
    expect(mockedResolveScope).not.toHaveBeenCalled();
    expect(mockedCountProjectRequirements).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-numeric project id", async () => {
    const res = await GET(makeGetRequest("abc"), params("abc"));

    expect(res.status).toBe(400);
    expect(mockedResolveScope).not.toHaveBeenCalled();
  });

  it("returns 403 when the viewer's project scope excludes the requested project", async () => {
    mockedResolveScope.mockResolvedValue([6, 7]);

    const res = await GET(makeGetRequest("5"), params("5"));

    expect(res.status).toBe(403);
    expect(mockedCountProjectRequirements).not.toHaveBeenCalled();
  });

  it("?countOnly=1 returns the live count, the threshold and the mode it implies (all)", async () => {
    mockedCountProjectRequirements.mockResolvedValue(499);
    mockCountRoots.mockResolvedValue(450);

    const res = await GET(makeGetRequest("5", "?countOnly=1"), params("5"));

    expect(res.status).toBe(200);
    const body = await res.json();
    // `rootTotal` is the unfiltered "x of y" denominator: only top-level
    // rows are ever loaded by the roots window.
    expect(body).toEqual({
      total: 499,
      rootTotal: 450,
      threshold: 500,
      mode: "all",
    });
    expect(mockedGetRequirementRootsPage).not.toHaveBeenCalled();
  });

  it("?countOnly=1 reports mode 'lazy' once the live count exceeds the threshold", async () => {
    mockedCountProjectRequirements.mockResolvedValue(501);
    mockCountRoots.mockResolvedValue(480);

    const res = await GET(makeGetRequest("5", "?countOnly=1"), params("5"));

    const body = await res.json();
    expect(body.mode).toBe("lazy");
  });

  it("?facetsOnly=1 returns the service's facets, scoped with the viewer's own resolved project scope", async () => {
    mockedResolveScope.mockResolvedValue([5, 6]);
    mockedGetRequirementFilterFacets.mockResolvedValue({
      statuses: ["Blocked", "Open"],
      coverageStatuses: [
        { statusId: 10, name: "Passed", color: "#0f0", count: 3 },
      ],
    });

    const res = await GET(makeGetRequest("5", "?facetsOnly=1"), params("5"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      statuses: ["Blocked", "Open"],
      coverageStatuses: [
        { statusId: 10, name: "Passed", color: "#0f0", count: 3 },
      ],
    });
    expect(mockedGetRequirementFilterFacets).toHaveBeenCalledWith({
      projectId: 5,
      coverageScope: { accessibleProjectIds: [5, 6] },
    });
    expect(mockedCountProjectRequirements).not.toHaveBeenCalled();
    expect(mockedGetRequirementRootsPage).not.toHaveBeenCalled();
  });

  it("?facetsOnly=1 passes accessibleProjectIds: null through for an unrestricted (ADMIN) viewer, never an empty array", async () => {
    mockedResolveScope.mockResolvedValue(null);
    mockedGetRequirementFilterFacets.mockResolvedValue({
      statuses: [],
      coverageStatuses: [],
    });

    const res = await GET(makeGetRequest("5", "?facetsOnly=1"), params("5"));

    expect(res.status).toBe(200);
    expect(mockedGetRequirementFilterFacets).toHaveBeenCalledWith({
      projectId: 5,
      coverageScope: { accessibleProjectIds: null },
    });
  });

  it("?facetsOnly=1 still 403s when the viewer's project scope excludes the requested project -- the gate runs before the branch", async () => {
    mockedResolveScope.mockResolvedValue([6, 7]);

    const res = await GET(makeGetRequest("5", "?facetsOnly=1"), params("5"));

    expect(res.status).toBe(403);
    expect(mockedGetRequirementFilterFacets).not.toHaveBeenCalled();
  });

  it("a roots page returns at most limit rows with a cursor", async () => {
    mockedCountProjectRequirements.mockResolvedValue(10);
    mockedGetRequirementRootsPage.mockResolvedValue({
      rows: [makeRow({ id: 1 }), makeRow({ id: 2 })],
      nextCursor: { value: "REQ-002", id: 2 },
    });

    const res = await GET(makeGetRequest("5", "?limit=2"), params("5"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(10);
    expect(body.rows).toHaveLength(2);
    expect(body.nextCursor).toEqual({ value: "REQ-002", id: 2 });
    expect(mockedGetRequirementRootsPage).toHaveBeenCalledWith({
      projectId: 5,
      limit: 2,
      cursor: null,
      sort: { column: "name", direction: "asc", coverageValues: null },
    });
  });

  it("a limit above the documented maximum is clamped, not honoured", async () => {
    const res = await GET(makeGetRequest("5", "?limit=100000"), params("5"));

    expect(res.status).toBe(200);
    expect(mockedGetRequirementRootsPage).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 })
    );
  });

  it("rejects a non-numeric limit with 400", async () => {
    const res = await GET(makeGetRequest("5", "?limit=abc"), params("5"));

    expect(res.status).toBe(400);
    expect(mockedGetRequirementRootsPage).not.toHaveBeenCalled();
  });

  it("passes a fully-supplied cursor through to the service", async () => {
    const res = await GET(
      makeGetRequest("5", "?limit=10&cursorValue=REQ-001&cursorId=1"),
      params("5")
    );

    expect(res.status).toBe(200);
    expect(mockedGetRequirementRootsPage).toHaveBeenCalledWith({
      projectId: 5,
      limit: 10,
      cursor: { value: "REQ-001", id: 1 },
      sort: { column: "name", direction: "asc", coverageValues: null },
    });
  });

  it("rejects a cursor with only cursorValue supplied", async () => {
    const res = await GET(
      makeGetRequest("5", "?limit=10&cursorValue=REQ-001"),
      params("5")
    );

    expect(res.status).toBe(400);
    expect(mockedGetRequirementRootsPage).not.toHaveBeenCalled();
  });

  it("rejects a cursor with only cursorId supplied", async () => {
    const res = await GET(
      makeGetRequest("5", "?limit=10&cursorId=1"),
      params("5")
    );

    expect(res.status).toBe(400);
    expect(mockedGetRequirementRootsPage).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric cursorId", async () => {
    const res = await GET(
      makeGetRequest("5", "?limit=10&cursorValue=REQ-001&cursorId=abc"),
      params("5")
    );

    expect(res.status).toBe(400);
    expect(mockedGetRequirementRootsPage).not.toHaveBeenCalled();
  });
});

describe("POST /api/projects/[projectId]/requirements/tree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    mockedResolveScope.mockResolvedValue([5]);
    mockedCountProjectRequirements.mockResolvedValue(42);
    mockedResolveRequirementMatches.mockResolvedValue({
      matchedTotal: 1,
      matchedIds: [1],
      ancestorIds: [],
      rows: [],
      nextCursor: null,
      expandMatchedSubtrees: false,
    });
  });

  it("returns 401 before it looks at the project id", async () => {
    mockedSession.mockResolvedValue(null);

    const res = await POST(
      makePostRequest("not-a-number", {
        search: "x",
        limit: 10,
        include: "ids",
      }),
      params("not-a-number")
    );

    expect(res.status).toBe(401);
    expect(mockedResolveScope).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-numeric project id", async () => {
    const res = await POST(
      makePostRequest("abc", { search: "x", limit: 10, include: "ids" }),
      params("abc")
    );

    expect(res.status).toBe(400);
    expect(mockedResolveScope).not.toHaveBeenCalled();
  });

  it("returns 403 when the viewer's project scope excludes the requested project", async () => {
    mockedResolveScope.mockResolvedValue([6, 7]);

    const res = await POST(
      makePostRequest("5", { search: "x", limit: 10, include: "ids" }),
      params("5")
    );

    expect(res.status).toBe(403);
    expect(mockedResolveRequirementMatches).not.toHaveBeenCalled();
  });

  it("accepts the explicit cursor: null the client sends on a first page", async () => {
    // The hook posts `cursor: null` for page one of every filtered request.
    // zod's `.optional()` is `T | undefined` and REJECTS null, so this body
    // 400'd in the browser while every test here omitted `cursor` entirely
    // and never noticed (operator UAT: search was completely broken).
    mockedResolveRequirementMatches.mockResolvedValue({
      matchedIds: [],
      ancestorIds: [],
      rows: [],
      matchedTotal: 0,
      nextCursor: null,
    });

    const res = await POST(
      makePostRequest("5", {
        search: "veracode",
        status: [],
        source: [],
        coverage: [],
        limit: 100,
        cursor: null,
        include: "rows",
      }),
      params("5")
    );

    expect(res.status).toBe(200);
  });

  it("returns 400 for a malformed body (limit missing)", async () => {
    const res = await POST(
      makePostRequest("5", { search: "x", include: "ids" }),
      params("5")
    );

    expect(res.status).toBe(400);
    expect(mockedResolveRequirementMatches).not.toHaveBeenCalled();
  });

  it("returns 400 for a body with no active axis", async () => {
    mockedResolveRequirementMatches.mockRejectedValue(
      new Error(
        "resolveRequirementMatches: at least one filter axis must be active -- an unfiltered read is getRequirementRootsPage's job"
      )
    );

    const res = await POST(
      makePostRequest("5", { limit: 10, include: "ids" }),
      params("5")
    );

    expect(res.status).toBe(400);
    expect(mockedGetCoverage).not.toHaveBeenCalled();
  });

  it("delegates a text-search filter straight through to resolveRequirementMatches", async () => {
    const res = await POST(
      makePostRequest("5", { search: "widget", limit: 10, include: "ids" }),
      params("5")
    );

    expect(res.status).toBe(200);
    expect(mockedResolveRequirementMatches).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 5,
        axes: { search: "widget", status: [], source: [] },
        coverageMatchIds: null,
        limit: 10,
        cursor: null,
        include: "ids",
      })
    );
    const body = await res.json();
    expect(body.total).toBe(42);
    expect(body.matchedIds).toEqual([1]);
  });

  it("evaluates the coverage axis against the project's coverage rollup, mapped through the shared predicate", async () => {
    mockedGetCoverage.mockResolvedValue(
      new Map([
        [1, breakdown({ uncovered: true, status: "UNCOVERED" })],
        [
          2,
          breakdown({
            uncovered: false,
            status: "PASSED",
            linkedCaseCount: 1,
            passed: 1,
          }),
        ],
      ])
    );

    const res = await POST(
      makePostRequest("5", {
        coverage: ["UNCOVERED"],
        limit: 10,
        include: "ids",
      }),
      params("5")
    );

    expect(res.status).toBe(200);
    expect(mockedGetCoverage).toHaveBeenCalledWith(5, {
      accessibleProjectIds: [5],
    });
    expect(mockedResolveRequirementMatches).toHaveBeenCalledWith(
      expect.objectContaining({ coverageMatchIds: [1] })
    );
  });

  it("relays the requested sort to the service", async () => {
    const res = await POST(
      makePostRequest("5", {
        search: "widget",
        limit: 10,
        include: "ids",
        sort: { column: "priority", direction: "desc" },
      }),
      params("5")
    );

    expect(res.status).toBe(200);
    expect(mockedResolveRequirementMatches).toHaveBeenCalledWith(
      expect.objectContaining({
        sort: expect.objectContaining({
          column: "priority",
          direction: "desc",
        }),
      })
    );
  });

  it("rejects an unknown sort column rather than silently falling back -- a sort that quietly orders by something else is the exact failure this is meant to remove", async () => {
    const res = await POST(
      makePostRequest("5", {
        search: "widget",
        limit: 10,
        include: "ids",
        sort: { column: "notAColumn", direction: "asc" },
      }),
      params("5")
    );

    expect(res.status).toBe(400);
    expect(mockedResolveRequirementMatches).not.toHaveBeenCalled();
  });

  it("computes coverage sort values from the rollup for a coverage-derived sort column", async () => {
    mockedGetCoverage.mockResolvedValue(
      new Map([
        [1, breakdown({ uncovered: true, status: "UNCOVERED" })],
        [
          2,
          breakdown({
            uncovered: false,
            status: "PASSED",
            linkedCaseCount: 3,
            directCaseCount: 2,
            passed: 3,
          }),
        ],
      ])
    );

    const res = await POST(
      makePostRequest("5", {
        search: "widget",
        limit: 10,
        include: "ids",
        sort: { column: "coverage", direction: "desc" },
      }),
      params("5")
    );

    expect(res.status).toBe(200);
    const callArgs = mockedResolveRequirementMatches.mock.calls[0][0];
    expect(callArgs.sort.coverageValues.ids).toEqual([1, 2]);
    // STATUS_RANK: UNCOVERED = 0 -> 0; PASSED = 3 -> 3 * 10_000 + passed(3).
    expect(callArgs.sort.coverageValues.values).toEqual([0, 30_003]);
  });

  it("never runs the coverage rollup for a plain Issue sort column", async () => {
    const res = await POST(
      makePostRequest("5", {
        search: "widget",
        limit: 10,
        include: "ids",
        sort: { column: "name", direction: "asc" },
      }),
      params("5")
    );

    expect(res.status).toBe(200);
    expect(mockedGetCoverage).not.toHaveBeenCalled();
    const callArgs = mockedResolveRequirementMatches.mock.calls[0][0];
    expect(callArgs.sort.coverageValues).toBeNull();
  });

  it("passes a multi-valued status/source selection through as arrays", async () => {
    const res = await POST(
      makePostRequest("5", {
        status: ["Open", "Blocked"],
        source: ["MANUAL", "DETACHED"],
        limit: 10,
        include: "ids",
      }),
      params("5")
    );

    expect(res.status).toBe(200);
    expect(mockedResolveRequirementMatches).toHaveBeenCalledWith(
      expect.objectContaining({
        axes: {
          search: "",
          status: ["Open", "Blocked"],
          source: ["MANUAL", "DETACHED"],
        },
      })
    );
  });

  it("unions WITHIN the coverage axis -- a requirement matching either selected state is included", async () => {
    mockedGetCoverage.mockResolvedValue(
      new Map([
        [1, breakdown({ uncovered: true, status: "UNCOVERED" })],
        [
          2,
          breakdown({
            uncovered: false,
            status: "NOT_RUN",
            linkedCaseCount: 1,
            untested: 1,
          }),
        ],
        [
          3,
          breakdown({
            uncovered: false,
            status: "PASSED",
            linkedCaseCount: 1,
            passed: 1,
          }),
        ],
      ])
    );

    const res = await POST(
      makePostRequest("5", {
        coverage: ["UNCOVERED", "UNTESTED"],
        limit: 10,
        include: "ids",
      }),
      params("5")
    );

    expect(res.status).toBe(200);
    const callArgs = mockedResolveRequirementMatches.mock.calls[0][0];
    expect(callArgs.coverageMatchIds).toEqual([1, 2]);
  });

  it('rejects the retired `source: ""` sentinel -- the inactive axis is the empty ARRAY now, and a client still sending the old shape must fail loudly', async () => {
    const res = await POST(
      makePostRequest("5", {
        source: [""],
        limit: 10,
        include: "ids",
      }),
      params("5")
    );

    expect(res.status).toBe(400);
    expect(mockedResolveRequirementMatches).not.toHaveBeenCalled();
  });

  it("passes a non-null EMPTY coverageMatchIds through when the coverage axis matches nothing", async () => {
    mockedGetCoverage.mockResolvedValue(
      new Map([
        [
          1,
          breakdown({
            uncovered: false,
            status: "PASSED",
            linkedCaseCount: 1,
            passed: 1,
          }),
        ],
      ])
    );

    const res = await POST(
      makePostRequest("5", {
        coverage: ["UNCOVERED"],
        limit: 10,
        include: "ids",
      }),
      params("5")
    );

    expect(res.status).toBe(200);
    const callArgs = mockedResolveRequirementMatches.mock.calls[0][0];
    expect(callArgs.coverageMatchIds).not.toBeNull();
    expect(callArgs.coverageMatchIds).toEqual([]);
  });

  it("degrades the coverage axis to inactive when the rollup throws, while the other axes still filter", async () => {
    mockedGetCoverage.mockRejectedValue(new Error("rollup unavailable"));

    const res = await POST(
      makePostRequest("5", {
        search: "widget",
        coverage: ["UNCOVERED"],
        limit: 10,
        include: "ids",
      }),
      params("5")
    );

    expect(res.status).toBe(200);
    expect(mockedResolveRequirementMatches).toHaveBeenCalledWith(
      expect.objectContaining({
        axes: { search: "widget", status: [], source: [] },
        coverageMatchIds: null,
      })
    );
  });

  it("does not swallow a real error thrown by resolveRequirementMatches", async () => {
    mockedResolveRequirementMatches.mockRejectedValue(
      new Error("relation does not exist")
    );

    const res = await POST(
      makePostRequest("5", { search: "widget", limit: 10, include: "ids" }),
      params("5")
    );

    expect(res.status).toBe(500);
  });

  it("never leaks the internal error message in a 500 body", async () => {
    mockedResolveRequirementMatches.mockRejectedValue(
      new Error('relation "Widgets" does not exist')
    );

    const res = await POST(
      makePostRequest("5", { search: "widget", limit: 10, include: "ids" }),
      params("5")
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("Widgets");
  });

  it("clamps a POST limit above the documented maximum", async () => {
    const res = await POST(
      makePostRequest("5", { search: "widget", limit: 100000, include: "ids" }),
      params("5")
    );

    expect(res.status).toBe(200);
    expect(mockedResolveRequirementMatches).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 })
    );
  });

  it("rejects a cursor with only one half supplied", async () => {
    const res = await POST(
      makePostRequest("5", {
        search: "widget",
        limit: 10,
        include: "ids",
        cursor: { name: "REQ-001" },
      }),
      params("5")
    );

    expect(res.status).toBe(400);
    expect(mockedResolveRequirementMatches).not.toHaveBeenCalled();
  });

  it("serializes a full rows response with no Map or BigInt surviving the JSON round trip", async () => {
    mockedResolveRequirementMatches.mockResolvedValue({
      matchedTotal: 1,
      matchedIds: [1],
      ancestorIds: [2],
      rows: [makeRow({ id: 1 }), makeRow({ id: 2, parentId: null })],
      nextCursor: { name: "REQ-001", id: 1 },
      expandMatchedSubtrees: true,
    });

    const res = await POST(
      makePostRequest("5", { search: "widget", limit: 10, include: "rows" }),
      params("5")
    );

    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw);

    expect(body.total).toBe(42);
    expect(body.matchedTotal).toBe(1);
    expect(Array.isArray(body.matchedIds)).toBe(true);
    expect(Array.isArray(body.ancestorIds)).toBe(true);
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.rows).toHaveLength(2);
    expect(body.nextCursor).toEqual({ name: "REQ-001", id: 1 });
    expect(body.expandMatchedSubtrees).toBe(true);
    expect(typeof body.matchedTotal).toBe("number");
    // No key silently vanished into `{}` (the Map-serialization bug this
    // route's own header/coverage/route.ts document) and no key is a
    // string coercion of a BigInt (`"1n"` never appears in the raw text).
    expect(raw).not.toContain("1n");
    for (const key of [
      "total",
      "matchedTotal",
      "matchedIds",
      "ancestorIds",
      "rows",
      "nextCursor",
      "expandMatchedSubtrees",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(body, key)).toBe(true);
    }
  });
});
