import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFindManyRepositoryCasesByDescendants } from "./useRepositoryCasesByDescendants";

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

// Resolves the POST fetch only when the test says so, so assertions can run
// while a new folder's request is still in flight.
const pending: Array<
  (value: { cases: unknown[]; totalCount: number }) => void
> = [];

const casesForFolder = (folderId: number) =>
  folderId === 1 ? [{ id: 11 }, { id: 12 }, { id: 13 }] : [{ id: 21 }];

beforeEach(() => {
  pending.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init: any) =>
        new Promise((resolve) => {
          const { folderId } = JSON.parse(init.body);
          pending.push(() =>
            resolve({
              ok: true,
              json: async () => ({
                cases: casesForFolder(folderId),
                totalCount: casesForFolder(folderId).length,
              }),
            } as any)
          );
        })
    )
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const flushPending = () => {
  const resolvers = pending.splice(0, pending.length);
  resolvers.forEach((resolve) => resolve({ cases: [], totalCount: 0 }));
};

describe("useFindManyRepositoryCasesByDescendants", () => {
  it("keeps the previous folder's rows while the next folder loads by default", async () => {
    const { result, rerender } = renderHook(
      ({ folderId }: { folderId: number }) =>
        useFindManyRepositoryCasesByDescendants({ projectId: 1, folderId }),
      { wrapper: createWrapper(), initialProps: { folderId: 1 } }
    );

    flushPending();
    await waitFor(() => expect(result.current.data).toHaveLength(3));

    rerender({ folderId: 2 });
    expect(result.current.data).toHaveLength(3);

    flushPending();
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });

  it("returns no data until the current folder resolves when keepPreviousData is false", async () => {
    const { result, rerender } = renderHook(
      ({ folderId }: { folderId: number }) =>
        useFindManyRepositoryCasesByDescendants({
          projectId: 1,
          folderId,
          keepPreviousData: false,
        }),
      { wrapper: createWrapper(), initialProps: { folderId: 1 } }
    );

    flushPending();
    await waitFor(() => expect(result.current.data).toHaveLength(3));

    rerender({ folderId: 2 });
    expect(result.current.data).toBeUndefined();

    flushPending();
    await waitFor(() => expect(result.current.data).toEqual([{ id: 21 }]));
  });
});
