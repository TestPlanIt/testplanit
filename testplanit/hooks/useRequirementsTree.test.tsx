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

function countPending(urlSubstring: string): number {
  return pendingRequests.filter((r) => r.url.includes(urlSubstring)).length;
}

function resolveJson(req: PendingRequest, data: unknown, status = 200) {
  req.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as unknown);
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
  const req = await waitFor(() =>
    findPending("/requirements/tree?", { method: "GET" })
  );
  await act(async () => {
    resolveJson(req, { total, rows, nextCursor });
  });
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
});
