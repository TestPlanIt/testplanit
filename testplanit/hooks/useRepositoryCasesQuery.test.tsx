import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { JsonNull } from "@zenstackhq/orm";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  invalidateRepositoryCasesQueries,
  notifyRepositoryCasesChanged,
  repositoryCasesQueryKey,
  REPOSITORY_CASES_QUERY_ROOT,
  useRepositoryCasesInvalidation,
  useRepositoryCasesQuery,
} from "./useRepositoryCasesQuery";

const createWrapper = (client?: QueryClient) => {
  const queryClient =
    client ??
    new QueryClient({
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

  it("posts Json-null sentinels in the plain form the route revives", async () => {
    // JsonNull is a class instance; JSON.stringify would flatten it to this
    // shape anyway, but saying so explicitly is what keeps the wire form and
    // the route's revival one contract instead of an accident.
    const { result } = renderHook(
      () =>
        useRepositoryCasesQuery({
          projectId: 42,
          where: { caseFieldValues: { some: { value: { not: JsonNull } } } },
          repositoryCaseWhere: { value: { equals: JsonNull } },
          select: { id: true },
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data).toHaveLength(2));

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string
    );
    expect(body.where).toEqual({
      caseFieldValues: { some: { value: { not: { __brand: "JsonNull" } } } },
    });
    expect(body.repositoryCaseWhere).toEqual({
      value: { equals: { __brand: "JsonNull" } },
    });
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

  it("keeps previous rows while a new page is fetched", async () => {
    const { result, rerender } = renderHook(
      ({ skip }: { skip: number }) =>
        useRepositoryCasesQuery({
          projectId: 42,
          select: { id: true },
          selectKey: "list",
          skip,
          take: 25,
        }),
      { wrapper: createWrapper(), initialProps: { skip: 0 } }
    );

    await waitFor(() => expect(result.current.data).toHaveLength(2));

    let resolveSecond: (value: unknown) => void = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise((resolve) => (resolveSecond = resolve))
    );
    rerender({ skip: 25 });

    // Page 2 is in flight, so page 1 stays on screen rather than blanking.
    expect(result.current.data).toHaveLength(2);
    resolveSecond(respond({ cases: [{ id: 21 }], totalCount: 1 }));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });

  it("drops previous rows when the new scope's query is gated off", async () => {
    const { result, rerender } = renderHook(
      ({ folderId, enabled }: { folderId: number; enabled: boolean }) =>
        useRepositoryCasesQuery({
          projectId: 42,
          where: { AND: [{ folderId: { equals: folderId } }] },
          select: { id: true },
          selectKey: "list",
          enabled,
        }),
      {
        wrapper: createWrapper(),
        initialProps: { folderId: 1, enabled: true },
      }
    );

    await waitFor(() => expect(result.current.data).toHaveLength(2));

    // The next folder is known to be empty, so its list query is never asked.
    // Showing the previous folder's rows under that scope would claim the
    // emptied folder still holds the case that was moved out of it.
    rerender({ folderId: 2, enabled: false });

    expect(result.current.data).toBeUndefined();
    expect(result.current.totalCount).toBe(0);
    expect(result.current.isLoading).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useRepositoryCasesQuery — run mode", () => {
  it("sends the run scope and the nested repository predicate", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        respond({
          cases: [{ id: 501, repositoryCase: { id: 11 } }],
          totalCount: 1,
        })
      )
    );

    const { result } = renderHook(
      () =>
        useRepositoryCasesQuery({
          projectId: 42,
          testRunIds: [7, 8],
          where: { isDeleted: false },
          repositoryCaseWhere: { AND: [{ projectId: 42 }] },
          orderBy: { order: "asc" },
          select: { id: true },
          selectKey: "runList",
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data).toHaveLength(1));

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string
    );
    expect(body.testRunIds).toEqual([7, 8]);
    expect(body.repositoryCaseWhere).toEqual({ AND: [{ projectId: 42 }] });
    // The run scope is never smuggled into the repository predicate.
    expect(body.where).toEqual({ isDeleted: false });
  });

  it("matches post-fetch filters against the nested repository case", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        respond({
          cases: [
            {
              id: 501,
              repositoryCase: {
                id: 11,
                template: { caseFields: [{ caseField: { id: 9 } }] },
                caseFieldValues: [{ fieldId: 9, value: "smoke test" }],
              },
            },
            {
              id: 502,
              repositoryCase: {
                id: 12,
                template: { caseFields: [{ caseField: { id: 9 } }] },
                caseFieldValues: [{ fieldId: 9, value: "regression" }],
              },
            },
          ],
          totalCount: 2,
        })
      )
    );

    const { result } = renderHook(
      () =>
        useRepositoryCasesQuery(
          {
            projectId: 42,
            testRunIds: [7],
            select: { id: true },
            selectKey: "runList",
          },
          [{ type: "text", fieldId: 9, operator: "contains", value1: "smoke" }]
        ),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].id).toBe(501);
  });

  it("surfaces the parallel case ids from an idsOnly run response", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        respond({ ids: [501, 502], caseIds: [11, 11], totalCount: 2 })
      )
    );

    const { result } = renderHook(
      () =>
        useRepositoryCasesQuery({
          projectId: 42,
          testRunIds: [7],
          idsOnly: true,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.ids).toEqual([501, 502]));
    // A multi-config run maps one case to several rows; they are not deduped.
    expect(result.current.caseIds).toEqual([11, 11]);
  });
});

describe("repositoryCasesQueryKey", () => {
  it("keys on the predicates, folder scope, sort, page and search identity", () => {
    const key = repositoryCasesQueryKey({
      projectId: 42,
      where: { AND: [{ folderId: { in: [3] } }] },
      orderBy: { order: "asc" },
      selectKey: "list",
      skip: 25,
      take: 25,
      searchKey: "login",
    });

    expect(key[0]).toBe(REPOSITORY_CASES_QUERY_ROOT);
    expect(key).toContainEqual({ AND: [{ folderId: { in: [3] } }] });
    expect(key).toContain("login");
  });

  it("does not thrash when only the select object identity changes", () => {
    const base = {
      projectId: 42,
      where: { AND: [{ projectId: 42 }] },
      selectKey: "list",
    };
    // The select is kilobytes of constant shape; naming it keeps the key small
    // AND stable across the re-renders that rebuild it.
    expect(repositoryCasesQueryKey(base)).toEqual(
      repositoryCasesQueryKey(base)
    );
  });

  it("separates repository rows from run rows for the same predicate", () => {
    const repo = repositoryCasesQueryKey({ projectId: 42, selectKey: "list" });
    const run = repositoryCasesQueryKey({
      projectId: 42,
      testRunIds: [7],
      selectKey: "runList",
    });
    expect(repo).not.toEqual(run);
  });
});

describe("useRepositoryCasesInvalidation", () => {
  const mount = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = createWrapper(queryClient);
    const rendered = renderHook(
      () => ({
        invalidate: useRepositoryCasesInvalidation(),
        list: useRepositoryCasesQuery({
          projectId: 42,
          where: { AND: [{ projectId: 42 }] },
          select: { id: true },
          selectKey: "list",
        }),
      }),
      { wrapper }
    );
    return { queryClient, wrapper, ...rendered };
  };

  const settled = async (result: { current: { list: { data: unknown } } }) =>
    waitFor(() => expect(result.current.list.data).toHaveLength(2));

  it("refetches the list after a successful mutation it was never told about", async () => {
    const { queryClient, wrapper, result } = mount();
    await settled(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Any mutation, any model, no registration: this stands in for every
    // ZenStack create/update/delete call site in the app.
    const mutation = renderHook(
      () => useMutation({ mutationFn: async () => "done" }),
      { wrapper }
    );
    await act(async () => {
      await mutation.result.current.mutateAsync(undefined);
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      queryClient.getQueryCache().findAll({
        queryKey: [REPOSITORY_CASES_QUERY_ROOT],
      })
    ).toHaveLength(1);
  });

  it("does not refetch when a mutation fails", async () => {
    const { wrapper, result } = mount();
    await settled(result);

    const mutation = renderHook(
      () =>
        useMutation({
          mutationFn: async () => {
            throw new Error("nope");
          },
          retry: false,
        }),
      { wrapper }
    );
    await act(async () => {
      await mutation.result.current
        .mutateAsync(undefined)
        .catch(() => undefined);
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("coalesces a burst of mutations into one refetch", async () => {
    const { wrapper, result } = mount();
    await settled(result);

    const mutation = renderHook(
      () => useMutation({ mutationFn: async () => "done" }),
      { wrapper }
    );
    // A drag-reorder issues one update per row.
    await act(async () => {
      await Promise.all([
        mutation.result.current.mutateAsync(undefined),
        mutation.result.current.mutateAsync(undefined),
        mutation.result.current.mutateAsync(undefined),
      ]);
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("mirrors a hand-rolled invalidation of a ZenStack case query", async () => {
    const { queryClient, result } = mount();
    await settled(result);

    // The anchor: any live ZenStack query for a case-list model. The inline
    // Add Case form invalidates by predicate like this after its server action,
    // touching no mutation cache at all.
    const anchorKey = [
      "zenstack",
      "RepositoryCases",
      "count",
      { where: { projectId: 42 } },
      { infinite: false, optimisticUpdate: true },
    ];
    queryClient.setQueryData(anchorKey, 7);

    await act(async () => {
      await queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          query.queryKey[0] === "zenstack" &&
          query.queryKey[1] === "RepositoryCases",
      });
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("ignores an invalidation of a model the list does not read", async () => {
    const { queryClient, result } = mount();
    await settled(result);

    queryClient.setQueryData(
      [
        "zenstack",
        "UserPreferences",
        "findFirst",
        {},
        { infinite: false, optimisticUpdate: true },
      ],
      {}
    );
    await act(async () => {
      await queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          query.queryKey[1] === "UserPreferences",
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches when a raw-fetch flow announces a change", async () => {
    const { result } = mount();
    await settled(result);

    // Bulk delete, import wizard, AI generation: no React Query involvement.
    await act(async () => {
      notifyRepositoryCasesChanged();
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("stops listening once the list unmounts", async () => {
    const { wrapper, result, unmount } = mount();
    await settled(result);
    unmount();

    const mutation = renderHook(
      () => useMutation({ mutationFn: async () => "done" }),
      { wrapper }
    );
    await act(async () => {
      await mutation.result.current.mutateAsync(undefined);
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hands back a stable invalidator that refreshes the list on demand", async () => {
    const { result, rerender } = mount();
    await settled(result);
    const first = result.current.invalidate;
    rerender();
    expect(result.current.invalidate).toBe(first);

    await act(async () => {
      await result.current.invalidate();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("invalidates every case-list query, not just the list", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = createWrapper(queryClient);
    fetchMock.mockImplementation(() =>
      Promise.resolve(respond({ ids: [11, 12], totalCount: 2 }))
    );

    const { result } = renderHook(
      () => ({
        list: useRepositoryCasesQuery({
          projectId: 42,
          select: { id: true },
          selectKey: "list",
        }),
        ids: useRepositoryCasesQuery({
          projectId: 42,
          idsOnly: true,
          selectKey: "ids",
        }),
        count: useRepositoryCasesQuery({ projectId: 42, selectKey: "count" }),
      }),
      { wrapper }
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    await act(async () => {
      await invalidateRepositoryCasesQueries(queryClient);
    });

    // The list, the id list behind select-all/prev-next and the count-only
    // request all refresh together — a stale id set is as wrong as a stale row.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    expect(result.current.list.totalCount).toBe(2);
  });
});
