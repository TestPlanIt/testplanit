import { beforeEach, describe, expect, it, vi } from "vitest";

// The engine is unit/live-DB tested elsewhere; here we verify the route's
// HARD BRANCH contract (spec §8): legacy bodies take the legacy path
// byte-identical, predicates/searchCaseIds bodies take the engine path.

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/app/actions/getUserAccessibleProjects", () => ({
  getUserAccessibleProjects: vi.fn(),
}));

vi.mock("~/lib/repositoryCaseFacetCounts", () => ({
  computeRepositoryCaseFacetCounts: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    projects: { findUnique: vi.fn() },
    repositoryCases: {
      groupBy: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    caseFieldValues: { findMany: vi.fn(), count: vi.fn() },
    templates: { findMany: vi.fn() },
    workflows: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    tags: { findMany: vi.fn() },
    issue: { findMany: vi.fn() },
    testRunCases: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

import { getServerSession } from "next-auth";
import { getUserAccessibleProjects } from "~/app/actions/getUserAccessibleProjects";
import { baseDb } from "~/lib/db";
import { computeRepositoryCaseFacetCounts } from "~/lib/repositoryCaseFacetCounts";

import { POST } from "./route";

const mockedDb = baseDb as unknown as {
  projects: { findUnique: ReturnType<typeof vi.fn> };
  repositoryCases: {
    groupBy: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  templates: { findMany: ReturnType<typeof vi.fn> };
  workflows: { findMany: ReturnType<typeof vi.fn> };
  user: { findMany: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
};

const ENGINE_RESULT = {
  templates: [{ id: 1, name: "T", count: 3 }],
  totalCount: 3,
};

function makeRequest(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { id: "user-1" },
  });
  (getUserAccessibleProjects as ReturnType<typeof vi.fn>).mockResolvedValue([
    { projectId: 42 },
  ]);
  (
    computeRepositoryCaseFacetCounts as ReturnType<typeof vi.fn>
  ).mockResolvedValue(ENGINE_RESULT);

  mockedDb.projects.findUnique.mockResolvedValue({ id: 42 });
  mockedDb.repositoryCases.groupBy.mockResolvedValue([]);
  mockedDb.repositoryCases.count.mockResolvedValue(0);
  mockedDb.repositoryCases.findMany.mockResolvedValue([]);
  mockedDb.templates.findMany.mockResolvedValue([]);
  mockedDb.workflows.findMany.mockResolvedValue([]);
  mockedDb.user.findMany.mockResolvedValue([]);
  mockedDb.$queryRaw.mockResolvedValue([]);
});

describe("view-options route — engine/legacy hard branch", () => {
  it("returns 401 without a session", async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const response = await POST(makeRequest({ projectId: 42 }));
    expect(response.status).toBe(401);
  });

  it("takes the legacy path when predicates/searchCaseIds are absent", async () => {
    const response = await POST(
      makeRequest({ projectId: 42, templateIds: [1] })
    );
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(computeRepositoryCaseFacetCounts).not.toHaveBeenCalled();
    // Legacy aggregation actually ran (5 groupBys) and produced the legacy
    // response shape with sentinel ids.
    expect(mockedDb.repositoryCases.groupBy).toHaveBeenCalledTimes(5);
    expect(body.templates).toEqual([]);
    expect(body.tags[0]).toEqual({ id: "any", name: "Any Tag", count: 0 });
    expect(body.totalCount).toBe(0);
  });

  it("routes to the engine when predicates are present and ignores legacy filters", async () => {
    const predicates = [
      { dimension: "templates", operator: "in", values: [1] },
    ];
    const response = await POST(
      makeRequest({
        projectId: 42,
        isRunMode: true,
        runIds: [7, 8],
        // Legacy fields must be ignored by the engine branch:
        templateIds: [99],
        stateIds: [98],
        predicates,
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(ENGINE_RESULT);

    expect(computeRepositoryCaseFacetCounts).toHaveBeenCalledTimes(1);
    expect(computeRepositoryCaseFacetCounts).toHaveBeenCalledWith(baseDb, {
      projectId: 42,
      isRunMode: true,
      effectiveRunIds: [7, 8],
      selectedTestCases: undefined,
      predicates,
      searchCaseIds: undefined,
    });
    // Legacy aggregation must NOT run.
    expect(mockedDb.repositoryCases.groupBy).not.toHaveBeenCalled();
    expect(mockedDb.$queryRaw).not.toHaveBeenCalled();
  });

  it("routes to the engine when only searchCaseIds is present, sanitizing ids", async () => {
    const response = await POST(
      makeRequest({
        projectId: 42,
        searchCaseIds: [1, 2.5, "3", null, 4],
      })
    );
    expect(response.status).toBe(200);

    expect(computeRepositoryCaseFacetCounts).toHaveBeenCalledWith(
      baseDb,
      expect.objectContaining({
        predicates: undefined,
        searchCaseIds: [1, 4],
      })
    );
    expect(mockedDb.repositoryCases.groupBy).not.toHaveBeenCalled();
  });

  it("an empty predicates array still selects the engine path", async () => {
    await POST(makeRequest({ projectId: 42, predicates: [] }));
    expect(computeRepositoryCaseFacetCounts).toHaveBeenCalledWith(
      baseDb,
      expect.objectContaining({ predicates: [] })
    );
    expect(mockedDb.repositoryCases.groupBy).not.toHaveBeenCalled();
  });
});
