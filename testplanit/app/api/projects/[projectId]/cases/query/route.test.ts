import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Contract under test (spec §9): the repository read path where the client
// predicate `where` (folder scoping included) and the Elasticsearch id set
// intersect. The non-widening server scope, the relevance-order preservation
// and the bounded page/hydration cost are the things that must never regress.

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

const projectsFindUniqueMock = vi.fn();
const casesFindManyMock = vi.fn();
const casesCountMock = vi.fn();

vi.mock("@/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(async () => ({
    projects: { findUnique: projectsFindUniqueMock },
    repositoryCases: {
      findMany: casesFindManyMock,
      count: casesCountMock,
    },
  })),
}));

const paginatedFindManyWithRelationsMock = vi.fn();

vi.mock("~/lib/paginatedFindMany", () => ({
  paginatedFindManyWithRelations: (...args: unknown[]) =>
    paginatedFindManyWithRelationsMock(...args),
}));

import { getServerSession } from "next-auth";

import { POST } from "./route";

const SELECT = { id: true, name: true };

// Mirrors the route's constants: the page ceiling and the hydration batch size.
const MAX_PAGE_SIZE = 1000;
const HYDRATION_CHUNK_SIZE = 200;

/** The AND operands the route composes: [clientWhere, {projectId}, ...scope]. */
const andOperands = (where: {
  AND: Array<Record<string, unknown>>;
}): Array<Record<string, unknown>> => where.AND;

const buildPost = (
  body: unknown,
  projectId = "42"
): [NextRequest, { params: Promise<{ projectId: string }> }] => {
  const req = new NextRequest(
    `http://localhost/api/projects/${projectId}/cases/query`,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
  return [req, { params: Promise.resolve({ projectId }) }];
};

beforeEach(() => {
  vi.clearAllMocks();
  (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { id: "u1" },
  });
  projectsFindUniqueMock.mockResolvedValue({ id: 42, isDeleted: false });
  casesFindManyMock.mockResolvedValue([]);
  casesCountMock.mockResolvedValue(0);
  paginatedFindManyWithRelationsMock.mockResolvedValue([]);
});

describe("POST /api/projects/[projectId]/cases/query — auth", () => {
  it("returns 401 without a session", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      null
    );
    const [req, ctx] = buildPost({ select: SELECT });
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
    expect(casesFindManyMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-numeric project id", async () => {
    const [req, ctx] = buildPost({ select: SELECT }, "abc");
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 404 when the enhanced client cannot read the project", async () => {
    // Policy-denied and non-existent are deliberately indistinguishable — the
    // response must not disclose that the project exists.
    projectsFindUniqueMock.mockResolvedValue(null);
    const [req, ctx] = buildPost({ select: SELECT });
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Project not found or access denied");
    expect(casesFindManyMock).not.toHaveBeenCalled();
    expect(paginatedFindManyWithRelationsMock).not.toHaveBeenCalled();
  });

  it("returns 400 on a malformed body without leaking internals", async () => {
    const [req, ctx] = buildPost({ skip: -5, select: SELECT });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid request data");
  });

  it("returns 500 with a generic message when the query fails", async () => {
    casesCountMock.mockRejectedValue(new Error("connection terminated"));
    const [req, ctx] = buildPost({ select: SELECT, orderBy: { name: "asc" } });
    const res = await POST(req, ctx);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Failed to fetch cases" });
  });
});

describe("POST /api/projects/[projectId]/cases/query — server-forced scope", () => {
  it("intersects the client where with projectId and the search ids", async () => {
    casesFindManyMock.mockResolvedValue([]);
    const [req, ctx] = buildPost({
      where: { isDeleted: false },
      searchCaseIds: [7, 8],
      select: SELECT,
    });

    const res = await POST(req, ctx);
    expect(res.status).toBe(200);

    const operands = andOperands(casesFindManyMock.mock.calls[0][0].where);
    expect(operands).toEqual([
      { isDeleted: false },
      { projectId: 42 },
      { id: { in: [7, 8] } },
    ]);
  });

  it("keeps a client id filter as its own AND operand instead of dropping it", async () => {
    // A page-by-id request (`where.id`) taken together with an active search
    // must return the intersection, not the whole search set: dropping the
    // client's id constraint silently widens the response past what was asked
    // for.
    casesFindManyMock.mockResolvedValue([]);
    const [req, ctx] = buildPost({
      where: { id: { in: [7] } },
      searchCaseIds: [7, 8, 9],
      select: SELECT,
    });

    const res = await POST(req, ctx);
    expect(res.status).toBe(200);

    const where = casesFindManyMock.mock.calls[0][0].where;
    // No top-level key can shadow another: both id constraints survive.
    expect(where).not.toHaveProperty("id");
    expect(andOperands(where)).toEqual([
      { id: { in: [7] } },
      { projectId: 42 },
      { id: { in: [7, 8, 9] } },
    ]);
  });

  it("cannot be widened by a client projectId — the server operand stands alongside it", async () => {
    casesCountMock.mockResolvedValue(0);
    const [req, ctx] = buildPost({
      where: { projectId: 999 },
      orderBy: { name: "asc" },
      select: SELECT,
    });

    const res = await POST(req, ctx);
    expect(res.status).toBe(200);

    const where = casesCountMock.mock.calls[0][0].where;
    // AND semantics: the client's foreign projectId can only contradict the
    // server's (matching nothing), never replace it.
    expect(where).not.toHaveProperty("projectId");
    expect(andOperands(where)).toContainEqual({ projectId: 42 });
    expect(andOperands(where)).toContainEqual({ projectId: 999 });
  });

  it("passes folder scoping through as an ordinary client predicate", async () => {
    // Folder scope is NOT server-forced: the client sends it inside `where`,
    // where it is intersected like any other predicate.
    const [req, ctx] = buildPost({
      where: { folderId: { in: [5, 6] } },
      orderBy: { name: "asc" },
      select: SELECT,
    });

    await POST(req, ctx);

    expect(andOperands(casesCountMock.mock.calls[0][0].where)).toEqual([
      { folderId: { in: [5, 6] } },
      { projectId: 42 },
    ]);
  });

  it("ignores legacy folderId/showDescendants body keys", async () => {
    // The server-side folder-subtree branch was removed (no caller ever used
    // it). A body still carrying those keys must not be interpreted as folder
    // scope — this test is the tripwire if the branch is ever reintroduced.
    const [req, ctx] = buildPost({
      folderId: 5,
      showDescendants: true,
      orderBy: { name: "asc" },
      select: SELECT,
    });

    const res = await POST(req, ctx);
    expect(res.status).toBe(200);

    expect(andOperands(casesCountMock.mock.calls[0][0].where)).toEqual([
      {},
      { projectId: 42 },
    ]);
  });

  it("applies the client where unchanged when there is no search", async () => {
    const [req, ctx] = buildPost({
      where: { isDeleted: false },
      orderBy: { name: "asc" },
      select: SELECT,
    });

    await POST(req, ctx);

    expect(andOperands(casesCountMock.mock.calls[0][0].where)).toEqual([
      { isDeleted: false },
      { projectId: 42 },
    ]);
  });
});

describe("POST /api/projects/[projectId]/cases/query — searchCaseIds sanitization", () => {
  it("drops non-safe, non-positive and duplicate ids while keeping order", async () => {
    const [req, ctx] = buildPost({
      searchCaseIds: [9, 1.5, -3, 9, 0, Number.MAX_SAFE_INTEGER + 2, 4],
      select: SELECT,
    });

    await POST(req, ctx);

    expect(
      andOperands(casesFindManyMock.mock.calls[0][0].where)
    ).toContainEqual({ id: { in: [9, 4] } });
  });

  it("caps the id set at the Elasticsearch 10,000-result window", async () => {
    const ids = Array.from({ length: 10_050 }, (_, i) => i + 1);
    const [req, ctx] = buildPost({ searchCaseIds: ids, select: SELECT });

    await POST(req, ctx);

    const searchOperand = andOperands(
      casesFindManyMock.mock.calls[0][0].where
    ).at(-1) as { id: { in: number[] } };
    const sent = searchOperand.id.in;
    expect(sent).toHaveLength(10_000);
    expect(sent[0]).toBe(1);
    expect(sent[9999]).toBe(10_000);
  });

  it("treats a present-but-empty search set as zero matches, not as no search", async () => {
    const [req, ctx] = buildPost({ searchCaseIds: [], select: SELECT });

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(body).toEqual({ cases: [], totalCount: 0 });
    expect(casesFindManyMock).not.toHaveBeenCalled();
    expect(casesCountMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/projects/[projectId]/cases/query — relevance path", () => {
  it("preserves searchCaseIds order through slice + hydrate", async () => {
    // DB matches a subset and returns it in its own (id-ascending) order.
    casesFindManyMock
      .mockResolvedValueOnce([{ id: 1 }, { id: 3 }, { id: 5 }])
      .mockResolvedValueOnce([
        { id: 3, name: "three" },
        { id: 5, name: "five" },
      ]);

    const [req, ctx] = buildPost({
      searchCaseIds: [5, 3, 9, 1],
      select: SELECT,
      skip: 0,
      take: 2,
    });

    const res = await POST(req, ctx);
    const body = await res.json();

    // 9 was filtered out by the DB; 1 falls on page 2.
    expect(body.totalCount).toBe(3);
    expect(body.cases.map((c: { id: number }) => c.id)).toEqual([5, 3]);

    // Phase 1 selects ids only; phase 2 hydrates just the page.
    expect(casesFindManyMock.mock.calls[0][0].select).toEqual({ id: true });
    expect(casesFindManyMock.mock.calls[1][0].where.id).toEqual({ in: [5, 3] });
    expect(casesFindManyMock.mock.calls[1][0].select).toEqual(SELECT);
    expect(paginatedFindManyWithRelationsMock).not.toHaveBeenCalled();
  });

  it("pages the relevance list with skip/take", async () => {
    casesFindManyMock
      .mockResolvedValueOnce([{ id: 1 }, { id: 3 }, { id: 5 }])
      .mockResolvedValueOnce([{ id: 1, name: "one" }]);

    const [req, ctx] = buildPost({
      searchCaseIds: [5, 3, 9, 1],
      select: SELECT,
      skip: 2,
      take: 2,
    });

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(body.totalCount).toBe(3);
    expect(body.cases.map((c: { id: number }) => c.id)).toEqual([1]);
  });

  it("serializes BigInt attachment sizes", async () => {
    casesFindManyMock.mockResolvedValueOnce([{ id: 5 }]).mockResolvedValueOnce([
      {
        id: 5,
        name: "five",
        attachments: [{ id: 1, size: BigInt(2048) }],
      },
    ]);

    const [req, ctx] = buildPost({
      searchCaseIds: [5],
      select: SELECT,
    });

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(body.cases[0].attachments[0].size).toBe("2048");
  });

  it("skips hydration when the page is empty", async () => {
    casesFindManyMock.mockResolvedValueOnce([{ id: 1 }]);

    const [req, ctx] = buildPost({
      searchCaseIds: [1],
      select: SELECT,
      skip: 50,
      take: 25,
    });

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(body).toEqual({ cases: [], totalCount: 1 });
    expect(casesFindManyMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/projects/[projectId]/cases/query — page + hydration bounds", () => {
  const MATCHED = Array.from({ length: 1500 }, (_, i) => i + 1);

  /** Phase 1 returns every matched id; hydration echoes the ids it was asked for. */
  const mockRelevanceDb = () => {
    casesFindManyMock.mockImplementation(async (args: any) => {
      if (!args.select?.name) return MATCHED.map((id) => ({ id }));
      const ids = args.where.id.in as number[];
      return ids.map((id) => ({ id, name: `case-${id}` }));
    });
  };

  /** Ids actually hydrated, across every chunked call. */
  const hydratedIds = () =>
    casesFindManyMock.mock.calls
      .filter(([args]) => args.select?.name)
      .flatMap(([args]) => args.where.id.in as number[]);

  it("clamps an oversized take to the page ceiling", async () => {
    mockRelevanceDb();
    const [req, ctx] = buildPost({
      searchCaseIds: MATCHED,
      select: SELECT,
      take: 5000,
    });

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(body.totalCount).toBe(1500);
    expect(body.cases).toHaveLength(MAX_PAGE_SIZE);
    expect(hydratedIds()).toHaveLength(MAX_PAGE_SIZE);
  });

  it("defaults an absent take to the page ceiling instead of hydrating everything", async () => {
    mockRelevanceDb();
    const [req, ctx] = buildPost({ searchCaseIds: MATCHED, select: SELECT });

    const res = await POST(req, ctx);
    const body = await res.json();

    // The full intersected count is still reported honestly.
    expect(body.totalCount).toBe(1500);
    expect(body.cases).toHaveLength(MAX_PAGE_SIZE);
    expect(hydratedIds()).toHaveLength(MAX_PAGE_SIZE);
  });

  it("hydrates the relevance page in bounded chunks", async () => {
    mockRelevanceDb();
    const [req, ctx] = buildPost({
      searchCaseIds: MATCHED,
      select: SELECT,
      take: 250,
    });

    const res = await POST(req, ctx);
    const body = await res.json();

    const hydrationCalls = casesFindManyMock.mock.calls.filter(
      ([args]) => args.select?.name
    );
    expect(hydrationCalls).toHaveLength(2);
    expect(hydrationCalls[0][0].where.id.in).toHaveLength(HYDRATION_CHUNK_SIZE);
    expect(hydrationCalls[1][0].where.id.in).toHaveLength(50);
    // Every chunk still carries the full server scope.
    expect(andOperands(hydrationCalls[0][0].where)).toContainEqual({
      projectId: 42,
    });
    // Relevance order survives the chunking.
    expect(body.cases.map((c: { id: number }) => c.id)).toEqual(
      MATCHED.slice(0, 250)
    );
  });

  it("issues a single hydration query for an ordinary page size", async () => {
    mockRelevanceDb();
    const [req, ctx] = buildPost({
      searchCaseIds: MATCHED,
      select: SELECT,
      take: 25,
    });

    await POST(req, ctx);

    expect(
      casesFindManyMock.mock.calls.filter(([args]) => args.select?.name)
    ).toHaveLength(1);
  });

  it("clamps the take handed to the paginated helper on the sorted path", async () => {
    const [req, ctx] = buildPost({
      orderBy: { name: "asc" },
      select: SELECT,
      take: 99_999,
    });

    await POST(req, ctx);

    expect(paginatedFindManyWithRelationsMock.mock.calls[0][1].take).toBe(
      MAX_PAGE_SIZE
    );
  });

  it("defaults the sorted path's take when the body omits it", async () => {
    const [req, ctx] = buildPost({ orderBy: { name: "asc" }, select: SELECT });

    await POST(req, ctx);

    expect(paginatedFindManyWithRelationsMock.mock.calls[0][1].take).toBe(
      MAX_PAGE_SIZE
    );
  });

  it("leaves the idsOnly list unbounded by take", async () => {
    // Select-all and details-panel prev/next need every id; ids are cheap.
    casesFindManyMock.mockResolvedValueOnce(MATCHED.map((id) => ({ id })));

    const [req, ctx] = buildPost({
      searchCaseIds: MATCHED,
      idsOnly: true,
      take: 25,
    });

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(body.ids).toHaveLength(1500);
    expect(body.totalCount).toBe(1500);
  });
});

describe("POST /api/projects/[projectId]/cases/query — orderBy path", () => {
  it("uses the paginated helper and the DB count when orderBy is supplied", async () => {
    casesCountMock.mockResolvedValue(17);
    paginatedFindManyWithRelationsMock.mockResolvedValue([
      { id: 2, name: "b" },
      { id: 1, name: "a" },
    ]);

    const [req, ctx] = buildPost({
      where: { isDeleted: false },
      orderBy: { name: "asc" },
      searchCaseIds: [1, 2],
      select: SELECT,
      skip: 25,
      take: 25,
    });

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(body.totalCount).toBe(17);
    expect(body.cases.map((c: { id: number }) => c.id)).toEqual([2, 1]);

    const [, args] = paginatedFindManyWithRelationsMock.mock.calls[0];
    expect(args).toMatchObject({
      orderBy: { name: "asc" },
      select: SELECT,
      skip: 25,
      take: 25,
    });
    // The search set still constrains the sorted page.
    expect(andOperands(args.where)).toEqual([
      { isDeleted: false },
      { projectId: 42 },
      { id: { in: [1, 2] } },
    ]);
  });

  it("returns cases: null when no select is supplied (count-only)", async () => {
    casesCountMock.mockResolvedValue(4);

    const [req, ctx] = buildPost({ orderBy: { name: "asc" } });

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(body).toEqual({ cases: null, totalCount: 4 });
    expect(paginatedFindManyWithRelationsMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/projects/[projectId]/cases/query — idsOnly", () => {
  it("returns the full intersected id list in relevance order without hydrating", async () => {
    casesFindManyMock.mockResolvedValueOnce([{ id: 1 }, { id: 3 }, { id: 5 }]);

    const [req, ctx] = buildPost({
      searchCaseIds: [5, 3, 9, 1],
      idsOnly: true,
      select: SELECT,
      skip: 0,
      take: 2,
    });

    const res = await POST(req, ctx);
    const body = await res.json();

    // Ignores paging on purpose: select-all / prev-next need every id.
    expect(body).toEqual({ ids: [5, 3, 1], totalCount: 3 });
    expect(casesFindManyMock).toHaveBeenCalledTimes(1);
    expect(paginatedFindManyWithRelationsMock).not.toHaveBeenCalled();
  });

  it("returns ids in DB order when orderBy is supplied", async () => {
    casesFindManyMock.mockResolvedValueOnce([{ id: 3 }, { id: 1 }]);

    const [req, ctx] = buildPost({
      orderBy: { name: "asc" },
      idsOnly: true,
    });

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(body).toEqual({ ids: [3, 1], totalCount: 2 });
    expect(casesFindManyMock.mock.calls[0][0]).toMatchObject({
      orderBy: { name: "asc" },
      select: { id: true },
    });
    expect(casesCountMock).not.toHaveBeenCalled();
  });
});
