import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAsyncComboboxOptions } from "./useAsyncComboboxOptions";

interface Option {
  id: number;
  label: string;
}

const makeOptions = (count: number, offset = 0): Option[] =>
  Array.from({ length: count }, (_, i) => ({
    id: offset + i + 1,
    label: `Item ${offset + i + 1}`,
  }));

const getOptionValue = (option: Option) => option.id;

const renderOptionsHook = (
  fetchOptions: Parameters<
    typeof useAsyncComboboxOptions<Option>
  >[0]["fetchOptions"],
  pageSize = 10
) =>
  renderHook(() =>
    useAsyncComboboxOptions<Option>({
      open: true,
      fetchOptions,
      getOptionValue,
      pageSize,
    })
  );

describe("useAsyncComboboxOptions", () => {
  it("appends the next page on loadMore instead of swapping it in", async () => {
    const all = makeOptions(25);
    const fetcher = vi.fn(async (_q: string, page: number, size: number) => ({
      results: all.slice(page * size, (page + 1) * size),
      total: all.length,
    }));
    const { result } = renderOptionsHook(fetcher);

    await waitFor(() => expect(result.current.options).toHaveLength(10));
    expect(result.current.total).toBe(25);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.options).toHaveLength(20));
    // Page 1 landed after page 0 and both are present — an append, not a swap.
    expect(result.current.options[0]).toEqual(all[0]);
    expect(result.current.options[19]).toEqual(all[19]);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.options).toHaveLength(25));
    expect(result.current.hasMore).toBe(false);
  });

  it("stops paging when a page lands with nothing new, whatever total claims", async () => {
    // A fetcher that ignores paging: every page is the same ten items, but
    // total advertises more. Without the dedupe-stop guard the sentinel
    // would refetch this page forever.
    const fetcher = vi.fn(async () => ({
      results: makeOptions(10),
      total: 30,
    }));
    const { result } = renderOptionsHook(fetcher);

    await waitFor(() => expect(result.current.options).toHaveLength(10));
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadingMore).toBe(false));
    expect(result.current.options).toHaveLength(10);
    expect(result.current.hasMore).toBe(false);
  });

  it("treats a full array page as possibly-more and a short one as exhausted", async () => {
    const paged = renderOptionsHook(async (_q, page, size) =>
      makeOptions(size, page * size)
    );
    await waitFor(() => expect(paged.result.current.options).toHaveLength(10));
    expect(paged.result.current.hasMore).toBe(true);

    const short = renderOptionsHook(async () => makeOptions(4));
    await waitFor(() => expect(short.result.current.options).toHaveLength(4));
    expect(short.result.current.hasMore).toBe(false);
  });

  it("treats an overlong array page as a fetcher that ignores paging", async () => {
    // Local fetchers return the whole filtered list for every page; the
    // list is already complete, so no load-more should be offered.
    const { result } = renderOptionsHook(async () => makeOptions(25));

    await waitFor(() => expect(result.current.options).toHaveLength(25));
    expect(result.current.hasMore).toBe(false);
  });

  it("clears the append spinner when a fetcher change aborts the append", async () => {
    // Reproduces the admin Add User latch: an append is in flight when the
    // fetcher's identity changes (unstable caller), which aborts the append
    // and restarts from page 0 as a REPLACE fetch. The replace path never
    // touches `loadingMore`, so the aborted append must clear its own flag —
    // otherwise the bottom spinner latches on and all further paging is
    // blocked until the dropdown closes.
    const all = makeOptions(25);
    const slowFetcher = (_q: string, page: number, size: number) =>
      page === 0
        ? Promise.resolve({
            results: all.slice(0, size),
            total: all.length,
          })
        : new Promise<{ results: Option[]; total: number }>(() => {});

    const { result, rerender } = renderHook(
      ({ fetchOptions }) =>
        useAsyncComboboxOptions<Option>({
          open: true,
          fetchOptions,
          getOptionValue,
          pageSize: 10,
        }),
      { initialProps: { fetchOptions: slowFetcher } }
    );

    await waitFor(() => expect(result.current.options).toHaveLength(10));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadingMore).toBe(true));

    const replacement = async () => ({
      results: all.slice(0, 5),
      total: 5,
    });
    rerender({ fetchOptions: replacement });

    await waitFor(() => expect(result.current.options).toHaveLength(5));
    expect(result.current.loadingMore).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("stays unsettled until the first page resolves", async () => {
    // `settled` gates the "no results" message: while the first fetch is in
    // flight the list is empty but nothing is known yet, so the message must
    // not render under the loading spinner.
    let resolvePage: (value: { results: Option[]; total: number }) => void;
    const fetcher = () =>
      new Promise<{ results: Option[]; total: number }>((resolve) => {
        resolvePage = resolve;
      });
    const { result } = renderOptionsHook(fetcher);

    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.settled).toBe(false);

    await act(async () => {
      resolvePage({ results: [], total: 0 });
    });
    expect(result.current.settled).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it("settles — and clears the spinner — when the fetch rejects", async () => {
    // A failed load must still reveal the empty state, or the list sits blank
    // with neither a spinner nor a message.
    const { result } = renderOptionsHook(async () => {
      throw new Error("boom");
    });

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.loading).toBe(false);
    expect(result.current.options).toEqual([]);
  });

  it("goes unsettled again when the dropdown closes", async () => {
    // Stable across renders — the hook refetches on `fetchOptions` identity.
    const fetcher = async () => makeOptions(3);
    const { result, rerender } = renderHook(
      ({ open }) =>
        useAsyncComboboxOptions<Option>({
          open,
          fetchOptions: fetcher,
          getOptionValue,
          pageSize: 10,
        }),
      { initialProps: { open: true } }
    );

    await waitFor(() => expect(result.current.settled).toBe(true));
    rerender({ open: false });
    // The next open re-fetches, so the empty state must be gated again.
    await waitFor(() => expect(result.current.settled).toBe(false));
  });

  it("restarts from page 0 when the search changes", async () => {
    const all = makeOptions(25);
    const fetcher = vi.fn(
      async (query: string, page: number, size: number) => ({
        results: query
          ? all.slice(0, 3)
          : all.slice(page * size, (page + 1) * size),
        total: query ? 3 : all.length,
      })
    );
    const { result } = renderOptionsHook(fetcher);

    await waitFor(() => expect(result.current.options).toHaveLength(10));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.options).toHaveLength(20));

    act(() => result.current.setSearch("It"));
    // Past the debounce, the accumulated list is replaced by the new query's
    // first page — not appended to.
    await waitFor(() => expect(result.current.options).toHaveLength(3));
    expect(result.current.total).toBe(3);
    expect(result.current.hasMore).toBe(false);
    expect(fetcher).toHaveBeenCalledWith("It", 0, 10);
  });
});
