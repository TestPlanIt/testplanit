import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequirementTreeRow } from "~/lib/services/requirementTree";
import { useRequirementsTree } from "./useRequirementsTree";

/**
 * Task 2 covers mode resolution, unfiltered roots paging, and expand-on-
 * demand -- every test below renders with every filter axis inactive.
 * Task 3 extends this same suite with filter submission and the two counts;
 * see the tests appended at the bottom of this file for those.
 */

const INACTIVE_FILTERS = {
  search: "",
  coverage: "" as const,
  status: "",
  source: "" as const,
};

function makeRow(
  id: number,
  overrides: Partial<RequirementTreeRow> = {}
): RequirementTreeRow {
  return {
    id,
    name: `REQ-${id}`,
    title: `Requirement ${id}`,
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
    createdAt: new Date("2026-01-01T00:00:00Z"),
    projectId: 1,
    integrationId: null,
    parentId: null,
    isRequirement: true,
    requirementDetachedAt: null,
    isDeleted: false,
    hasChildren: false,
    ...overrides,
  };
}

interface PendingRequest {
  url: string;
  init?: RequestInit;
  resolve: (value: unknown) => void;
}

let pendingRequests: PendingRequest[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  pendingRequests = [];
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    return new Promise((resolve) => {
      pendingRequests.push({ url, init, resolve });
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function findPending(
  urlSubstring: string,
  opts?: { method?: string }
): PendingRequest {
  const idx = pendingRequests.findIndex((r) => {
    const method = r.init?.method ?? "GET";
    return (
      r.url.includes(urlSubstring) && (!opts?.method || method === opts.method)
    );
  });
  if (idx === -1) {
    throw new Error(
      `No pending request matching "${urlSubstring}" (method ${opts?.method ?? "GET"}). ` +
        `Pending: ${pendingRequests.map((r) => `${r.init?.method ?? "GET"} ${r.url}`).join(", ")}`
    );
  }
  return pendingRequests.splice(idx, 1)[0];
}

function countPending(
  urlSubstring: string,
  opts?: { method?: string }
): number {
  return pendingRequests.filter((r) => {
    const method = r.init?.method ?? "GET";
    return (
      r.url.includes(urlSubstring) && (!opts?.method || method === opts.method)
    );
  }).length;
}

function resolveJson(req: PendingRequest, data: unknown, status = 200) {
  req.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as unknown);
}

function parseBody(req: PendingRequest): any {
  return JSON.parse(req.init!.body as string);
}

async function resolveCount(mode: "all" | "lazy", total: number) {
  const req = await waitFor(() => findPending("countOnly=1"));
  await act(async () => {
    resolveJson(req, { total, threshold: 500, mode });
  });
}

async function resolveRootsPage(
  rows: RequirementTreeRow[],
  nextCursor: { name: string; id: number } | null,
  total = 600
) {
  // "limit=" (never "countOnly=1" or "facetsOnly=1") is what actually
  // distinguishes the roots-page GET from this hook's other two GETs on the
  // SAME `/requirements/tree?` path (28-19 added the facets fetch as a
  // sibling of the count round trip) -- a bare path-prefix match would
  // grab whichever of the three the hook happened to issue first.
  const req = await waitFor(() =>
    findPending("/requirements/tree?limit=", { method: "GET" })
  );
  await act(async () => {
    resolveJson(req, { total, rows, nextCursor });
  });
}

interface MatchPageFixture {
  total?: number;
  matchedTotal: number;
  matchedIds: number[];
  ancestorIds: number[];
  rows?: RequirementTreeRow[];
  nextCursor: { name: string; id: number } | null;
  expandMatchedSubtrees?: boolean;
}

async function resolveFilterPage(fixture: MatchPageFixture) {
  const req = await waitFor(() =>
    findPending("/requirements/tree", { method: "POST" })
  );
  await act(async () => {
    resolveJson(req, {
      total: fixture.total ?? 600,
      matchedTotal: fixture.matchedTotal,
      matchedIds: fixture.matchedIds,
      ancestorIds: fixture.ancestorIds,
      rows: fixture.rows ?? [],
      nextCursor: fixture.nextCursor,
      expandMatchedSubtrees: fixture.expandMatchedSubtrees ?? false,
    });
  });
  return req;
}

describe("useRequirementsTree", () => {
  it("derives mode from the server's count response, never from a local comparison", async () => {
    const { result } = renderHook(() =>
      useRequirementsTree({ projectId: 1, filters: INACTIVE_FILTERS })
    );

    // The server says "lazy" for a total (10) that a naive `total > 500`
    // recomputation would call "all" -- proving the hook trusts the response.
    await resolveCount("lazy", 10);
    await waitFor(() => expect(result.current.mode).toBe("lazy"));
    expect(result.current.total).toBe(10);

    await resolveRootsPage([], null);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("loads the first roots page in lazy mode and reports hasMore from the cursor", async () => {
    const { result } = renderHook(() =>
      useRequirementsTree({ projectId: 1, filters: INACTIVE_FILTERS })
    );

    await resolveCount("lazy", 600);
    await resolveRootsPage([makeRow(1), makeRow(2)], { name: "REQ-2", id: 2 });

    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.hasMore).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it("appends the next window on onLoadMore -- every root appears exactly once across pages", async () => {
    const { result } = renderHook(() =>
      useRequirementsTree({ projectId: 1, filters: INACTIVE_FILTERS })
    );

    await resolveCount("lazy", 600);
    await resolveRootsPage([makeRow(1), makeRow(2)], { name: "REQ-2", id: 2 });
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    act(() => {
      result.current.onLoadMore();
    });

    const req = await waitFor(() => findPending("cursorName=REQ-2&cursorId=2"));
    await act(async () => {
      resolveJson(req, { total: 600, rows: [makeRow(3)], nextCursor: null });
    });

    await waitFor(() => expect(result.current.rows).toHaveLength(3));
    const ids = result.current.rows.map((row) => row.id).sort();
    expect(ids).toEqual([1, 2, 3]);
    expect(new Set(ids).size).toBe(3);
    expect(result.current.hasMore).toBe(false);
  });

  it("ignores a second onLoadMore while one is already in flight", async () => {
    const { result } = renderHook(() =>
      useRequirementsTree({ projectId: 1, filters: INACTIVE_FILTERS })
    );

    await resolveCount("lazy", 600);
    await resolveRootsPage([makeRow(1), makeRow(2)], { name: "REQ-2", id: 2 });
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    const callsBefore = fetchMock.mock.calls.length;
    act(() => {
      result.current.onLoadMore();
      result.current.onLoadMore();
    });

    expect(fetchMock.mock.calls.length).toBe(callsBefore + 1);
  });

  it("fetchChildren merges a node's children without disturbing hasMore, the cursor, or loadedCount", async () => {
    const { result } = renderHook(() =>
      useRequirementsTree({ projectId: 1, filters: INACTIVE_FILTERS })
    );

    await resolveCount("lazy", 600);
    await resolveRootsPage([makeRow(1, { hasChildren: true }), makeRow(2)], {
      name: "REQ-2",
      id: 2,
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    const hasMoreBefore = result.current.hasMore;
    const loadedCountBefore = result.current.loadedCount;

    let childrenPromise: Promise<void> = Promise.resolve();
    act(() => {
      childrenPromise = result.current.fetchChildren(1);
    });
    const childrenReq = await waitFor(() => findPending("/tree/1/children"));
    await act(async () => {
      resolveJson(childrenReq, { rows: [makeRow(11, { parentId: 1 })] });
      await childrenPromise;
    });

    await waitFor(() => expect(result.current.rows).toHaveLength(3));
    expect(result.current.hasMore).toBe(hasMoreBefore);
    expect(result.current.loadedCount).toBe(loadedCountBefore);

    // The pager's own cursor is unaffected by the expand: onLoadMore must
    // still resume from REQ-2/2, not from anything fetchChildren touched.
    act(() => {
      result.current.onLoadMore();
    });
    const pagerReq = await waitFor(() =>
      findPending("cursorName=REQ-2&cursorId=2")
    );
    await act(async () => {
      resolveJson(pagerReq, { total: 600, rows: [], nextCursor: null });
    });
  });

  it("fetchChildren for a parent already loaded or already in flight is a no-op", async () => {
    const { result } = renderHook(() =>
      useRequirementsTree({ projectId: 1, filters: INACTIVE_FILTERS })
    );

    await resolveCount("lazy", 600);
    await resolveRootsPage([makeRow(1, { hasChildren: true })], null);
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    // Two calls before the first resolves -- only one request goes out.
    act(() => {
      void result.current.fetchChildren(1);
      void result.current.fetchChildren(1);
    });
    expect(countPending("/tree/1/children")).toBe(1);

    await act(async () => {
      const req = findPending("/tree/1/children");
      resolveJson(req, { rows: [makeRow(11, { parentId: 1 })] });
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    // Already loaded -- calling again issues no new request.
    await act(async () => {
      await result.current.fetchChildren(1);
    });
    expect(countPending("/tree/1/children")).toBe(0);
  });

  it("a failed page fetch sets loadMoreError and keeps the rows; onRetryLoadMore recovers", async () => {
    const { result } = renderHook(() =>
      useRequirementsTree({ projectId: 1, filters: INACTIVE_FILTERS })
    );

    await resolveCount("lazy", 600);
    await resolveRootsPage([makeRow(1), makeRow(2)], { name: "REQ-2", id: 2 });
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    act(() => {
      result.current.onLoadMore();
    });
    const failedReq = await waitFor(() =>
      findPending("cursorName=REQ-2&cursorId=2")
    );
    await act(async () => {
      resolveJson(failedReq, { error: "boom" }, 500);
    });

    await waitFor(() => expect(result.current.loadMoreError).toBe(true));
    expect(result.current.rows).toHaveLength(2);

    act(() => {
      result.current.onRetryLoadMore();
    });
    const retryReq = await waitFor(() =>
      findPending("cursorName=REQ-2&cursorId=2")
    );
    await act(async () => {
      resolveJson(retryReq, {
        total: 600,
        rows: [makeRow(3)],
        nextCursor: null,
      });
    });

    await waitFor(() => expect(result.current.loadMoreError).toBe(false));
    expect(result.current.rows).toHaveLength(3);
  });

  it("issues no roots-page request at all in 'all' mode", async () => {
    const { result } = renderHook(() =>
      useRequirementsTree({ projectId: 1, filters: INACTIVE_FILTERS })
    );

    await resolveCount("all", 10);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.rows).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // --- 28-19 (gap closure): the Status/Coverage Selects' server-side
  // facet source above the threshold -- see requirementTree.ts's own
  // getRequirementFilterFacets for the server half. ---

  it("fetches facets once mode resolves to lazy, and surfaces them on the return object", async () => {
    const { result } = renderHook(() =>
      useRequirementsTree({ projectId: 1, filters: INACTIVE_FILTERS })
    );

    await resolveCount("lazy", 600);
    const facetsReq = await waitFor(() => findPending("facetsOnly=1"));
    await act(async () => {
      resolveJson(facetsReq, {
        statuses: ["Blocked", "Open"],
        coverageStatuses: [
          { statusId: 10, name: "Passed", color: "#0f0", count: 3 },
        ],
      });
    });
    await resolveRootsPage([], null);

    await waitFor(() =>
      expect(result.current.facets.statuses).toEqual(["Blocked", "Open"])
    );
    expect(result.current.facets.coverageStatuses).toEqual([
      { statusId: 10, name: "Passed", color: "#0f0", count: 3 },
    ]);
  });

  it("never fetches facets in 'all' mode -- facets stay at their empty starting value, and the below-threshold path issues exactly the ONE request it issues today", async () => {
    const { result } = renderHook(() =>
      useRequirementsTree({ projectId: 1, filters: INACTIVE_FILTERS })
    );

    await resolveCount("all", 10);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(countPending("facetsOnly=1")).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.facets).toEqual({
      statuses: [],
      coverageStatuses: [],
    });
  });

  it("does not fetch facets while mode is still null (the count round trip hasn't resolved yet)", async () => {
    renderHook(() =>
      useRequirementsTree({ projectId: 1, filters: INACTIVE_FILTERS })
    );

    // Only the count round trip's own request may be pending before mode
    // resolves -- a facets request this early would mean the gate reads
    // `mode !== null` instead of the required `mode === "lazy"`.
    expect(countPending("facetsOnly=1")).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // --- Task 3: filter submission and the two counts SCALE-03 renders. ---

  const ACTIVE_FILTERS = {
    search: "widget",
    coverage: "" as const,
    status: "",
    source: "" as const,
  };

  it("submits to the filter endpoint when any filter axis is active, and does not when none are active", async () => {
    const { result } = renderHook(() =>
      useRequirementsTree({ projectId: 1, filters: INACTIVE_FILTERS })
    );

    await resolveCount("lazy", 600);
    await resolveRootsPage([makeRow(1)], null);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(countPending("/requirements/tree", { method: "POST" })).toBe(0);
  });

  it("submits to the filter endpoint once a filter axis becomes active", async () => {
    const { rerender } = renderHook(
      ({ filters }: { filters: typeof INACTIVE_FILTERS }) =>
        useRequirementsTree({ projectId: 1, filters }),
      { initialProps: { filters: INACTIVE_FILTERS } }
    );

    await resolveCount("lazy", 600);
    await resolveRootsPage([makeRow(1)], null);

    rerender({ filters: ACTIVE_FILTERS });
    const req = await waitFor(() =>
      findPending("/requirements/tree", { method: "POST" })
    );
    expect(parseBody(req).search).toBe("widget");
  });

  it("requests include: 'rows' in lazy mode", async () => {
    renderHook(() =>
      useRequirementsTree({ projectId: 1, filters: ACTIVE_FILTERS })
    );

    await resolveCount("lazy", 600);
    const req = await waitFor(() =>
      findPending("/requirements/tree", { method: "POST" })
    );
    expect(parseBody(req).include).toBe("rows");
  });

  it("requests include: 'ids' in 'all' mode", async () => {
    renderHook(() =>
      useRequirementsTree({ projectId: 1, filters: ACTIVE_FILTERS })
    );

    await resolveCount("all", 10);
    const req = await waitFor(() =>
      findPending("/requirements/tree", { method: "POST" })
    );
    expect(parseBody(req).include).toBe("ids");
  });

  it("changing a filter resets paging and replaces the match set rather than appending to it", async () => {
    const { result, rerender } = renderHook(
      ({ filters }: { filters: typeof ACTIVE_FILTERS }) =>
        useRequirementsTree({ projectId: 1, filters }),
      { initialProps: { filters: ACTIVE_FILTERS } }
    );

    await resolveCount("lazy", 600);
    await resolveFilterPage({
      matchedTotal: 1,
      matchedIds: [1],
      ancestorIds: [],
      rows: [makeRow(1)],
      nextCursor: null,
    });
    await waitFor(() => expect(result.current.matchedIds?.size).toBe(1));
    expect(result.current.matchedIds?.has(1)).toBe(true);

    rerender({ filters: { ...ACTIVE_FILTERS, search: "gadget" } });
    // The stale match set is cleared immediately on the filter change, before
    // the new response arrives.
    await waitFor(() => expect(result.current.matchedIds).toBeNull());

    await resolveFilterPage({
      matchedTotal: 1,
      matchedIds: [2],
      ancestorIds: [],
      rows: [makeRow(2)],
      nextCursor: null,
    });
    await waitFor(() => expect(result.current.matchedIds?.size).toBe(1));
    expect(result.current.matchedIds?.has(2)).toBe(true);
    expect(result.current.matchedIds?.has(1)).toBe(false);
    expect(result.current.rows.map((row) => row.id)).toEqual([2]);
  });

  it("discards a response for a superseded filter", async () => {
    const { result, rerender } = renderHook(
      ({ filters }: { filters: typeof ACTIVE_FILTERS }) =>
        useRequirementsTree({ projectId: 1, filters }),
      { initialProps: { filters: ACTIVE_FILTERS } }
    );

    await resolveCount("lazy", 600);
    const staleReq = await waitFor(() =>
      findPending("/requirements/tree", { method: "POST" })
    );
    expect(parseBody(staleReq).search).toBe("widget");

    // The filter changes WHILE the first request is still in flight.
    rerender({ filters: { ...ACTIVE_FILTERS, search: "gadget" } });
    const freshReq = await waitFor(() =>
      findPending("/requirements/tree", { method: "POST" })
    );
    expect(parseBody(freshReq).search).toBe("gadget");

    // Resolve the STALE request out of order -- it must never reach state.
    await act(async () => {
      resolveJson(staleReq, {
        total: 600,
        matchedTotal: 1,
        matchedIds: [999],
        ancestorIds: [],
        rows: [makeRow(999)],
        nextCursor: null,
        expandMatchedSubtrees: false,
      });
    });
    expect(result.current.matchedIds).toBeNull();

    await act(async () => {
      resolveJson(freshReq, {
        total: 600,
        matchedTotal: 1,
        matchedIds: [2],
        ancestorIds: [],
        rows: [makeRow(2)],
        nextCursor: null,
        expandMatchedSubtrees: false,
      });
    });
    await waitFor(() => expect(result.current.matchedIds?.size).toBe(1));
    expect(result.current.matchedIds?.has(999)).toBe(false);
    expect(result.current.matchedIds?.has(2)).toBe(true);
  });

  it("unfiltered: loadedCount is the loaded row count and matchedTotal is null", async () => {
    const { result } = renderHook(() =>
      useRequirementsTree({ projectId: 1, filters: INACTIVE_FILTERS })
    );

    await resolveCount("lazy", 600);
    await resolveRootsPage([makeRow(1), makeRow(2)], null);

    await waitFor(() => expect(result.current.loadedCount).toBe(2));
    expect(result.current.matchedTotal).toBeNull();
  });

  it("filtered paging arithmetic: loadedCount counts only matches, ancestors never inflate it, and paging appends without duplicating either", async () => {
    const { result } = renderHook(() =>
      useRequirementsTree({ projectId: 1, filters: ACTIVE_FILTERS })
    );

    await resolveCount("lazy", 600);

    const page1Matches = Array.from({ length: 10 }, (_, i) => makeRow(i + 1));
    const page1Ancestors = [101, 102, 103, 104].map((id) => makeRow(id));
    await resolveFilterPage({
      matchedTotal: 20,
      matchedIds: page1Matches.map((r) => r.id),
      ancestorIds: [101, 102, 103, 104],
      rows: [...page1Matches, ...page1Ancestors],
      nextCursor: { name: "REQ-10", id: 10 },
    });

    await waitFor(() => expect(result.current.loadedCount).toBe(10));
    expect(result.current.matchedTotal).toBe(20);
    expect(result.current.rows).toHaveLength(14);
    // Disjoint: no id is in both sets.
    const overlap = [...(result.current.matchedIds ?? [])].filter((id) =>
      result.current.ancestorIds?.has(id)
    );
    expect(overlap).toEqual([]);

    act(() => {
      result.current.onLoadMore();
    });

    const page2Matches = Array.from({ length: 10 }, (_, i) => makeRow(i + 11));
    // Shares 103/104 with page 1's ancestors, plus one new ancestor (105).
    const page2Ancestors = [103, 104, 105].map((id) => makeRow(id));
    await resolveFilterPage({
      matchedTotal: 20,
      matchedIds: page2Matches.map((r) => r.id),
      ancestorIds: [103, 104, 105],
      rows: [...page2Matches, ...page2Ancestors],
      nextCursor: null,
    });

    await waitFor(() => expect(result.current.loadedCount).toBe(20));
    expect(result.current.matchedTotal).toBe(20);
    expect(result.current.matchedIds?.size).toBe(20);
    expect(result.current.ancestorIds?.size).toBe(5);
    // 20 matches + (4 original ancestors + 1 new distinct ancestor) = 25,
    // never double-counted for the shared 103/104.
    expect(result.current.rows).toHaveLength(25);
    const ids = result.current.rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
