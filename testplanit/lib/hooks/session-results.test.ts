/**
 * Integration tests for ZenStack-generated session hooks.
 * Tests verify that hooks expose the correct shape (data, isLoading, mutateAsync)
 * when called with mocked ZenStack runtime providers.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Mock ZenStack runtime BEFORE hook imports ----
// The hooks call getHooksContext() at runtime, so we mock the entire runtime module.
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
      _fetch: unknown
    ) => ({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
  ),
  useModelMutation: vi.fn(
    (
      _model: string,
      _method: string,
      _url: string,
      _metadata: unknown,
      _options: unknown,
      _fetch: unknown,
      _optionalArgs: unknown
    ) => ({
      mutateAsync: vi.fn().mockResolvedValue({}),
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    })
  ),
  useInfiniteModelQuery: vi.fn(
    (
      _model: string,
      _url: string,
      _args: unknown,
      _options: unknown,
      _fetch: unknown
    ) => ({
      data: undefined,
      isLoading: false,
      isError: false,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
    })
  ),
  useSuspenseModelQuery: vi.fn(
    (
      _model: string,
      _url: string,
      _args: unknown,
      _options: unknown,
      _fetch: unknown
    ) => ({
      data: undefined,
      isLoading: false,
      isError: false,
    })
  ),
  useSuspenseInfiniteModelQuery: vi.fn(() => ({
    data: undefined,
    isLoading: false,
  })),
}));

// Mock the __model_meta import to avoid loading the large 309KB metadata file
vi.mock("./__model_meta", () => ({ default: {} }));

// ---- Import hooks AFTER vi.mock calls ----
import {
  useCreateSessionResults,
  useDeleteSessionResults,
  useFindManySessionResults,
  useUpdateSessionResults,
} from "./session-results";
import {
  useCreateSessionVersions,
  useFindManySessions,
} from "~/lib/hooks";
import {
  useModelMutation,
  useModelQuery,
} from "@zenstackhq/tanstack-query/runtime-v5/react";

// Helper: create a minimal wrapper for renderHook
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("SessionResults hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-set mock implementations after clearAllMocks
    vi.mocked(useModelQuery).mockImplementation(
      (_model, _url, _args, _options, _fetch) => ({
        data: undefined,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      }) as any
    );
    vi.mocked(useModelMutation).mockImplementation(
      (_model, _method, _url, _metadata, _options, _fetch, _opt) => ({
        mutateAsync: vi.fn().mockResolvedValue({}),
        mutate: vi.fn(),
        isPending: false,
        isError: false,
        error: null,
      }) as any
    );
  });

  it("useCreateSessionResults returns a mutateAsync function", () => {
    const { result } = renderHook(() => useCreateSessionResults(), {
      wrapper: createWrapper(),
    });

    expect(result.current).toBeDefined();
    expect(typeof result.current.mutateAsync).toBe("function");
  });

  it("useFindManySessionResults returns data and isLoading fields", () => {
    const { result } = renderHook(
      () => useFindManySessionResults({ where: { sessionId: 1 } }),
      { wrapper: createWrapper() }
    );

    expect(result.current).toBeDefined();
    // Shape: { data, isLoading, isError, refetch }
    expect("isLoading" in result.current).toBe(true);
    expect("data" in result.current).toBe(true);
  });

  it("useFindManySessionResults passes args to useModelQuery", () => {
    renderHook(
      () => useFindManySessionResults({ where: { sessionId: 42 } }),
      { wrapper: createWrapper() }
    );

    // Verify useModelQuery was called (hook delegates to it)
    expect(useModelQuery).toHaveBeenCalled();
    const [model, url] = vi.mocked(useModelQuery).mock.calls[0];
    expect(model).toBe("SessionResults");
    expect(url).toContain("sessionResults/findMany");
  });

  it("useUpdateSessionResults returns a mutateAsync function", () => {
    const { result } = renderHook(() => useUpdateSessionResults(), {
      wrapper: createWrapper(),
    });

    expect(result.current).toBeDefined();
    expect(typeof result.current.mutateAsync).toBe("function");
  });

  it("useDeleteSessionResults returns a mutateAsync function", () => {
    const { result } = renderHook(() => useDeleteSessionResults(), {
      wrapper: createWrapper(),
    });

    expect(result.current).toBeDefined();
    expect(typeof result.current.mutateAsync).toBe("function");
  });

  it("useCreateSessionResults calls useModelMutation with correct model and method", () => {
    renderHook(() => useCreateSessionResults(), { wrapper: createWrapper() });

    expect(useModelMutation).toHaveBeenCalled();
    const [model, method] = vi.mocked(useModelMutation).mock.calls[0];
    expect(model).toBe("SessionResults");
    expect(method).toBe("POST");
  });

  it("useUpdateSessionResults calls useModelMutation with PUT method", () => {
    renderHook(() => useUpdateSessionResults(), { wrapper: createWrapper() });

    const calls = vi.mocked(useModelMutation).mock.calls;
    const updateCall = calls.find(
      ([model, method]: any[]) =>
        model === "SessionResults" && method === "PUT"
    );
    expect(updateCall).toBeDefined();
  });
});

describe("Sessions hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useModelQuery).mockImplementation(
      (_model, _url, _args, _options, _fetch) => ({
        data: undefined,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      }) as any
    );
    vi.mocked(useModelMutation).mockImplementation(
      (_model, _method, _url, _metadata, _options, _fetch, _opt) => ({
        mutateAsync: vi.fn().mockResolvedValue({}),
        mutate: vi.fn(),
        isPending: false,
        isError: false,
        error: null,
      }) as any
    );
  });

  it("useFindManySessions returns data and isLoading", () => {
    const { result } = renderHook(
      () => useFindManySessions({ where: { projectId: 1 } }),
      { wrapper: createWrapper() }
    );

    expect(result.current).toBeDefined();
    expect("data" in result.current).toBe(true);
    expect("isLoading" in result.current).toBe(true);
  });

  it("useFindManySessions calls useModelQuery with Sessions model", () => {
    renderHook(() => useFindManySessions(), { wrapper: createWrapper() });

    expect(useModelQuery).toHaveBeenCalled();
    const [model, url] = vi.mocked(useModelQuery).mock.calls[0];
    expect(model).toBe("Sessions");
    expect(url).toContain("sessions/findMany");
  });
});

describe("SessionVersions hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useModelMutation).mockImplementation(
      (_model, _method, _url, _metadata, _options, _fetch, _opt) => ({
        mutateAsync: vi.fn().mockResolvedValue({}),
        mutate: vi.fn(),
        isPending: false,
        isError: false,
        error: null,
      }) as any
    );
  });

  it("useCreateSessionVersions returns a mutateAsync function", () => {
    const { result } = renderHook(() => useCreateSessionVersions(), {
      wrapper: createWrapper(),
    });

    expect(result.current).toBeDefined();
    expect(typeof result.current.mutateAsync).toBe("function");
  });

  it("useCreateSessionVersions calls useModelMutation with SessionVersions model and POST method", () => {
    renderHook(() => useCreateSessionVersions(), { wrapper: createWrapper() });

    const calls = vi.mocked(useModelMutation).mock.calls;
    const createCall = calls.find(
      ([model, method]: any[]) =>
        model === "SessionVersions" && method === "POST"
    );
    expect(createCall).toBeDefined();
  });
});
