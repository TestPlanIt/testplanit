import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRepositoryCasesQuery } from "./useRepositoryCasesQuery";

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

let fetchMock: ReturnType<typeof vi.fn>;

const respond = (payload: Record<string, unknown>) =>
  ({ ok: true, json: async () => payload }) as any;

beforeEach(() => {
  fetchMock = vi.fn(() =>
    Promise.resolve(respond({ cases: [{ id: 11 }, { id: 12 }], totalCount: 2 }))
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRepositoryCasesQuery", () => {
  it("posts the where, search ids and paging to the cases/query route", async () => {
    const { result } = renderHook(
      () =>
        useRepositoryCasesQuery({
          projectId: 42,
          where: { AND: [{ projectId: 42 }] },
          select: { id: true },
          skip: 25,
          take: 25,
          searchCaseIds: [12, 11],
          searchKey: "login",
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.totalCount).toBe(2);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/projects/42/cases/query");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.searchCaseIds).toEqual([12, 11]);
    expect(body.skip).toBe(25);
    // No orderBy => the route keeps Elasticsearch relevance order.
    expect(body.orderBy).toBeUndefined();
  });

  it("refetches when the search key changes but not when the id array is rebuilt", async () => {
    const { result, rerender } = renderHook(
      ({ ids, key }: { ids: number[]; key: string }) =>
        useRepositoryCasesQuery({
          projectId: 42,
          select: { id: true },
          searchCaseIds: ids,
          searchKey: key,
        }),
      {
        wrapper: createWrapper(),
        initialProps: { ids: [1, 2], key: "login" },
      }
    );

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Same search, a fresh array instance: hashing the ids would refetch,
    // keying on the query string does not.
    rerender({ ids: [1, 2], key: "login" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rerender({ ids: [5], key: "checkout" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("applies text matchers in memory and reports the matched count", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        respond({
          cases: [
            {
              id: 1,
              template: { caseFields: [{ caseField: { id: 9 } }] },
              caseFieldValues: [{ fieldId: 9, value: "smoke test" }],
            },
            {
              id: 2,
              template: { caseFields: [{ caseField: { id: 9 } }] },
              caseFieldValues: [{ fieldId: 9, value: "regression" }],
            },
          ],
          totalCount: 2,
        })
      )
    );

    const { result } = renderHook(
      () =>
        useRepositoryCasesQuery({ projectId: 42, select: { id: true } }, [
          {
            type: "text",
            fieldId: 9,
            operator: "contains",
            value1: "smoke",
          },
        ]),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].id).toBe(1);
    // The server counted the SQL pre-filter; the honest total is what matched.
    expect(result.current.totalCount).toBe(1);
  });

  it("surfaces a failed request instead of resolving to an unfiltered list", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 500 } as any)
    );

    const { result } = renderHook(
      () => useRepositoryCasesQuery({ projectId: 42, select: { id: true } }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toBeUndefined();
  });
});
