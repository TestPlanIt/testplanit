import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRequirementSubtreeCount } from "./useRequirementSubtreeCount";

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

// Resolves the GET fetch only when the test says so, so assertions can run
// while a request is still in flight (mirrors
// useRepositoryCasesByDescendants.test.tsx's own convention).
const pending: Array<(value: unknown) => void> = [];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  pending.length = 0;
  fetchMock = vi.fn(
    (_url: string) =>
      new Promise((resolve) => {
        pending.push(resolve);
      })
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const resolveOk = (count: number) => {
  const resolvers = pending.splice(0, pending.length);
  resolvers.forEach((resolve) =>
    resolve({ ok: true, json: async () => ({ count }) } as any)
  );
};

const resolveError = (status: number) => {
  const resolvers = pending.splice(0, pending.length);
  resolvers.forEach((resolve) => resolve({ ok: false, status } as any));
};

describe("useRequirementSubtreeCount", () => {
  it("issues no fetch at all while disabled", () => {
    renderHook(
      () =>
        useRequirementSubtreeCount({
          projectId: 1,
          requirementId: 5,
          enabled: false,
        }),
      { wrapper: createWrapper() }
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("issues one GET to the descendant-count route when enabled with a requirement id", async () => {
    renderHook(
      () =>
        useRequirementSubtreeCount({
          projectId: 1,
          requirementId: 5,
          enabled: true,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/1/requirements/5/descendant-count"
    );
  });

  it("reports count as null while loading, then the resolved number", async () => {
    const { result } = renderHook(
      () =>
        useRequirementSubtreeCount({
          projectId: 1,
          requirementId: 5,
          enabled: true,
        }),
      { wrapper: createWrapper() }
    );

    expect(result.current.count).toBeNull();
    expect(result.current.isLoading).toBe(true);

    resolveOk(7);
    await waitFor(() => expect(result.current.count).toBe(7));
    expect(result.current.isLoading).toBe(false);
  });

  it("surfaces a non-2xx response as an error, with count staying null", async () => {
    const { result } = renderHook(
      () =>
        useRequirementSubtreeCount({
          projectId: 1,
          requirementId: 5,
          enabled: true,
        }),
      { wrapper: createWrapper() }
    );

    resolveError(500);
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.count).toBeNull();
  });

  it("refetches when the requirement id changes, but not on a same-id re-render", async () => {
    const { rerender } = renderHook(
      ({ requirementId }: { requirementId: number }) =>
        useRequirementSubtreeCount({
          projectId: 1,
          requirementId,
          enabled: true,
        }),
      { wrapper: createWrapper(), initialProps: { requirementId: 5 } }
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveOk(3);

    rerender({ requirementId: 5 });
    // Same id, same query key -- no additional network call.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ requirementId: 9 });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/projects/1/requirements/9/descendant-count"
    );
  });
});
