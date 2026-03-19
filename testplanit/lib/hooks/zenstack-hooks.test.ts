/**
 * Shape verification tests for ZenStack auto-generated hooks.
 * Tests verify that representative CRUD hooks expose the correct API shape
 * (data, isLoading, isError for queries; mutateAsync, isPending for mutations)
 * without testing the ZenStack framework itself.
 *
 * Covers HOOK-01: ZenStack-generated data hooks.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Mock ZenStack runtime BEFORE hook imports ----
vi.mock("@zenstackhq/tanstack-query/runtime-v5/react", () => ({
  getHooksContext: vi.fn(() => ({
    endpoint: "/api/model",
    fetch: vi.fn(),
  })),
  useModelQuery: vi.fn(
    (
      _model: string,
      _url: string,
      _args: unknown,
      _options: unknown,
      _fetch: unknown,
    ) => ({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }),
  ),
  useModelMutation: vi.fn(
    (
      _model: string,
      _method: string,
      _url: string,
      _metadata: unknown,
      _options: unknown,
      _fetch: unknown,
      _optionalArgs: unknown,
    ) => ({
      mutateAsync: vi.fn().mockResolvedValue({}),
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    }),
  ),
  useInfiniteModelQuery: vi.fn(
    (
      _model: string,
      _url: string,
      _args: unknown,
      _options: unknown,
      _fetch: unknown,
    ) => ({
      data: undefined,
      isLoading: false,
      isError: false,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
    }),
  ),
  useSuspenseModelQuery: vi.fn(
    (
      _model: string,
      _url: string,
      _args: unknown,
      _options: unknown,
      _fetch: unknown,
    ) => ({
      data: undefined,
      isLoading: false,
      isError: false,
    }),
  ),
  useSuspenseInfiniteModelQuery: vi.fn(() => ({
    data: undefined,
    isLoading: false,
  })),
}));

// Mock __model_meta to avoid loading the large 309KB metadata file
vi.mock("./__model_meta", () => ({ default: {} }));

// ---- Import hooks AFTER vi.mock calls ----
import {
  useCreateRepositoryCases,
  useDeleteRepositoryCases,
  useFindManyRepositoryCases,
  useUpdateRepositoryCases,
} from "./repository-cases";
import { useFindManyTestRuns } from "./test-runs";
import { useFindManyNotification } from "./notification";
import { useFindManyUser } from "./user";
import {
  useModelMutation,
  useModelQuery,
} from "@zenstackhq/tanstack-query/runtime-v5/react";

// Helper: create a minimal QueryClientProvider wrapper for renderHook
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

// ────────────────────────────────────────────────────────────────────────────
// RepositoryCases hooks
// ────────────────────────────────────────────────────────────────────────────

describe("RepositoryCases hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useModelQuery).mockImplementation(
      (_model, _url, _args, _options, _fetch) =>
        ({
          data: undefined,
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }) as any,
    );
    vi.mocked(useModelMutation).mockImplementation(
      (_model, _method, _url, _metadata, _options, _fetch, _opt) =>
        ({
          mutateAsync: vi.fn().mockResolvedValue({}),
          mutate: vi.fn(),
          isPending: false,
          isError: false,
          error: null,
        }) as any,
    );
  });

  it("useFindManyRepositoryCases returns data and isLoading fields", () => {
    const { result } = renderHook(
      () => useFindManyRepositoryCases({ where: { projectId: 1 } }),
      { wrapper: createWrapper() },
    );

    expect(result.current).toBeDefined();
    expect("data" in result.current).toBe(true);
    expect("isLoading" in result.current).toBe(true);
    expect("isError" in result.current).toBe(true);
  });

  it("useFindManyRepositoryCases calls useModelQuery with RepositoryCases model", () => {
    renderHook(() => useFindManyRepositoryCases(), { wrapper: createWrapper() });

    expect(useModelQuery).toHaveBeenCalled();
    const [model, url] = vi.mocked(useModelQuery).mock.calls[0];
    expect(model).toBe("RepositoryCases");
    expect(url).toContain("repositoryCases/findMany");
  });

  it("useCreateRepositoryCases returns a mutateAsync function", () => {
    const { result } = renderHook(() => useCreateRepositoryCases(), {
      wrapper: createWrapper(),
    });

    expect(result.current).toBeDefined();
    expect(typeof result.current.mutateAsync).toBe("function");
  });

  it("useCreateRepositoryCases calls useModelMutation with RepositoryCases model and POST method", () => {
    renderHook(() => useCreateRepositoryCases(), { wrapper: createWrapper() });

    expect(useModelMutation).toHaveBeenCalled();
    const [model, method] = vi.mocked(useModelMutation).mock.calls[0];
    expect(model).toBe("RepositoryCases");
    expect(method).toBe("POST");
  });

  it("useUpdateRepositoryCases returns a mutateAsync function", () => {
    const { result } = renderHook(() => useUpdateRepositoryCases(), {
      wrapper: createWrapper(),
    });

    expect(result.current).toBeDefined();
    expect(typeof result.current.mutateAsync).toBe("function");
  });

  it("useUpdateRepositoryCases calls useModelMutation with PUT method", () => {
    renderHook(() => useUpdateRepositoryCases(), { wrapper: createWrapper() });

    const calls = vi.mocked(useModelMutation).mock.calls;
    const updateCall = calls.find(
      ([model, method]: any[]) =>
        model === "RepositoryCases" && method === "PUT",
    );
    expect(updateCall).toBeDefined();
  });

  it("useDeleteRepositoryCases returns a mutateAsync function", () => {
    const { result } = renderHook(() => useDeleteRepositoryCases(), {
      wrapper: createWrapper(),
    });

    expect(result.current).toBeDefined();
    expect(typeof result.current.mutateAsync).toBe("function");
  });

  it("useDeleteRepositoryCases calls useModelMutation with DELETE method", () => {
    renderHook(() => useDeleteRepositoryCases(), { wrapper: createWrapper() });

    const calls = vi.mocked(useModelMutation).mock.calls;
    const deleteCall = calls.find(
      ([model, method]: any[]) =>
        model === "RepositoryCases" && method === "DELETE",
    );
    expect(deleteCall).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TestRuns hooks
// ────────────────────────────────────────────────────────────────────────────

describe("TestRuns hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useModelQuery).mockImplementation(
      (_model, _url, _args, _options, _fetch) =>
        ({
          data: undefined,
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }) as any,
    );
  });

  it("useFindManyTestRuns returns data and isLoading fields", () => {
    const { result } = renderHook(
      () => useFindManyTestRuns({ where: { projectId: 1 } }),
      { wrapper: createWrapper() },
    );

    expect(result.current).toBeDefined();
    expect("data" in result.current).toBe(true);
    expect("isLoading" in result.current).toBe(true);
  });

  it("useFindManyTestRuns calls useModelQuery with TestRuns model", () => {
    renderHook(() => useFindManyTestRuns(), { wrapper: createWrapper() });

    expect(useModelQuery).toHaveBeenCalled();
    const [model, url] = vi.mocked(useModelQuery).mock.calls[0];
    expect(model).toBe("TestRuns");
    expect(url).toContain("testRuns/findMany");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Notification hooks
// ────────────────────────────────────────────────────────────────────────────

describe("Notification hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useModelQuery).mockImplementation(
      (_model, _url, _args, _options, _fetch) =>
        ({
          data: undefined,
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }) as any,
    );
  });

  it("useFindManyNotification returns data and isLoading fields", () => {
    const { result } = renderHook(() => useFindManyNotification(), {
      wrapper: createWrapper(),
    });

    expect(result.current).toBeDefined();
    expect("data" in result.current).toBe(true);
    expect("isLoading" in result.current).toBe(true);
  });

  it("useFindManyNotification calls useModelQuery with Notification model", () => {
    renderHook(() => useFindManyNotification(), { wrapper: createWrapper() });

    expect(useModelQuery).toHaveBeenCalled();
    const [model, url] = vi.mocked(useModelQuery).mock.calls[0];
    expect(model).toBe("Notification");
    expect(url).toContain("notification/findMany");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// User hooks
// ────────────────────────────────────────────────────────────────────────────

describe("User hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useModelQuery).mockImplementation(
      (_model, _url, _args, _options, _fetch) =>
        ({
          data: undefined,
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }) as any,
    );
  });

  it("useFindManyUser returns data and isLoading fields", () => {
    const { result } = renderHook(() => useFindManyUser(), {
      wrapper: createWrapper(),
    });

    expect(result.current).toBeDefined();
    expect("data" in result.current).toBe(true);
    expect("isLoading" in result.current).toBe(true);
  });

  it("useFindManyUser calls useModelQuery with User model", () => {
    renderHook(() => useFindManyUser(), { wrapper: createWrapper() });

    expect(useModelQuery).toHaveBeenCalled();
    const [model, url] = vi.mocked(useModelQuery).mock.calls[0];
    expect(model).toBe("User");
    expect(url).toContain("user/findMany");
  });
});
