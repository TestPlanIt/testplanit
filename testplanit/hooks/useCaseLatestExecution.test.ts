import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CASE_LATEST_EXECUTION_QUERY_KEY_ROOT,
  invalidateCaseLatestExecution,
  isCaseLatestExecutionQueryKey,
  useCaseLatestExecution,
} from "./useCaseLatestExecution";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe("useCaseLatestExecution", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("issues no request while caseId is undefined", () => {
    renderHook(() => useCaseLatestExecution(undefined), {
      wrapper: createWrapper(),
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("issues no request while caseId is non-finite", () => {
    renderHook(() => useCaseLatestExecution(Number.NaN), {
      wrapper: createWrapper(),
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fetches a stable queryKey rooted at the exported key-root constant with caseId second", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ caseId: 100, lastExecutedAt: null }),
    });

    const { result } = renderHook(() => useCaseLatestExecution(100), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/repository-cases/100/latest-execution"
    );
    expect(result.current.data).toEqual({ caseId: 100, lastExecutedAt: null });
  });

  it("rejects with an Error rather than resolving to undefined on a non-OK response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Forbidden" }),
    });

    const { result } = renderHook(() => useCaseLatestExecution(100), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toBeUndefined();
  });
});

describe("isCaseLatestExecutionQueryKey", () => {
  it("matches this hook's own key for the given caseId", () => {
    expect(
      isCaseLatestExecutionQueryKey(
        [CASE_LATEST_EXECUTION_QUERY_KEY_ROOT, 100],
        100
      )
    ).toBe(true);
  });

  it("matches any caseId when caseId is omitted", () => {
    expect(
      isCaseLatestExecutionQueryKey([CASE_LATEST_EXECUTION_QUERY_KEY_ROOT, 100])
    ).toBe(true);
  });

  it("rejects a different caseId's key", () => {
    expect(
      isCaseLatestExecutionQueryKey(
        [CASE_LATEST_EXECUTION_QUERY_KEY_ROOT, 100],
        200
      )
    ).toBe(false);
  });

  it("rejects a non-array query key", () => {
    expect(
      isCaseLatestExecutionQueryKey(
        CASE_LATEST_EXECUTION_QUERY_KEY_ROOT as unknown as readonly unknown[],
        100
      )
    ).toBe(false);
  });

  // The predicate must reject the two sibling requirement-side hooks' keys
  // even for the SAME numeric id -- an assertion that would fail if this
  // predicate were ever loosened into a key-prefix or same-second-element
  // match instead of checking the root string first.
  it("rejects requirementCoveringCases' key for the same numeric id", () => {
    expect(
      isCaseLatestExecutionQueryKey(["requirementCoveringCases", 5, 100], 100)
    ).toBe(false);
  });

  it("rejects requirementCoverage's key for the same numeric id", () => {
    expect(
      isCaseLatestExecutionQueryKey(["requirementCoverage", 100], 100)
    ).toBe(false);
  });
});

describe("invalidateCaseLatestExecution", () => {
  it("invalidates using a predicate built from isCaseLatestExecutionQueryKey", () => {
    const invalidateQueries = vi.fn();
    const queryClient = { invalidateQueries } as any;

    invalidateCaseLatestExecution(queryClient, 100);

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    const { predicate } = invalidateQueries.mock.calls[0][0];
    expect(typeof predicate).toBe("function");

    expect(
      predicate({ queryKey: [CASE_LATEST_EXECUTION_QUERY_KEY_ROOT, 100] })
    ).toBe(true);
    expect(
      predicate({ queryKey: [CASE_LATEST_EXECUTION_QUERY_KEY_ROOT, 200] })
    ).toBe(false);
    expect(predicate({ queryKey: ["requirementCoveringCases", 5, 100] })).toBe(
      false
    );
  });

  it("omits caseId to invalidate every open case latest-execution query", () => {
    const invalidateQueries = vi.fn();
    const queryClient = { invalidateQueries } as any;

    invalidateCaseLatestExecution(queryClient);

    const { predicate } = invalidateQueries.mock.calls[0][0];
    expect(
      predicate({ queryKey: [CASE_LATEST_EXECUTION_QUERY_KEY_ROOT, 100] })
    ).toBe(true);
    expect(
      predicate({ queryKey: [CASE_LATEST_EXECUTION_QUERY_KEY_ROOT, 200] })
    ).toBe(true);
    expect(predicate({ queryKey: ["requirementCoverage", 100] })).toBe(false);
  });
});
