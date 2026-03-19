import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Mock the server actions before importing the hooks
vi.mock("~/app/actions/repositoryCasesWithLastResult", () => ({
  fetchRepositoryCasesWithLastResult: vi.fn(),
  countRepositoryCasesWithLastResult: vi.fn(),
}));

import {
  fetchRepositoryCasesWithLastResult,
  countRepositoryCasesWithLastResult,
} from "~/app/actions/repositoryCasesWithLastResult";
import {
  useRepositoryCasesWithLastResult,
  useCountRepositoryCasesWithLastResult,
} from "./useRepositoryCasesWithLastResult";

// ---- Test helpers ----

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
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

// ---- Test data ----

const mockCase1 = {
  id: 1,
  name: "Test Case 1",
  projectId: 42,
  lastTestResult: null,
};

const mockCase2 = {
  id: 2,
  name: "Test Case 2",
  projectId: 42,
  lastTestResult: {
    statusName: "Passed",
    color: "#00ff00",
    executedAt: new Date("2024-01-15"),
  },
};

const defaultArgs = {
  where: { projectId: 42, isDeleted: false, isArchived: false },
  skip: 0,
  take: 25,
};

// ---- Tests ----

describe("useRepositoryCasesWithLastResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when server action returns success with empty data", async () => {
    (fetchRepositoryCasesWithLastResult as any).mockResolvedValue({
      success: true,
      data: [],
    });

    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useRepositoryCasesWithLastResult(defaultArgs),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });

  it("returns case data array when server action returns success with data", async () => {
    (fetchRepositoryCasesWithLastResult as any).mockResolvedValue({
      success: true,
      data: [mockCase1, mockCase2],
    });

    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useRepositoryCasesWithLastResult(defaultArgs),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data).toEqual([mockCase1, mockCase2]);
  });

  it("returns empty array when server action returns success=false (select transform)", async () => {
    (fetchRepositoryCasesWithLastResult as any).mockResolvedValue({
      success: false,
      error: "Unauthorized",
      data: [],
    });

    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useRepositoryCasesWithLastResult(defaultArgs),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // select function: (response) => (response.success ? response.data : [])
    // success=false → returns []
    expect(result.current.data).toEqual([]);
  });

  it("uses correct query key including args object", async () => {
    (fetchRepositoryCasesWithLastResult as any).mockResolvedValue({
      success: true,
      data: [mockCase1],
    });

    const wrapper = createWrapper();
    renderHook(
      () => useRepositoryCasesWithLastResult(defaultArgs),
      { wrapper }
    );

    await waitFor(() => {
      expect(fetchRepositoryCasesWithLastResult).toHaveBeenCalledWith(defaultArgs);
    });
    expect(fetchRepositoryCasesWithLastResult).toHaveBeenCalledTimes(1);
  });

  it("calls server action again on refetch", async () => {
    (fetchRepositoryCasesWithLastResult as any).mockResolvedValue({
      success: true,
      data: [mockCase1],
    });

    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useRepositoryCasesWithLastResult(defaultArgs),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchRepositoryCasesWithLastResult).toHaveBeenCalledTimes(1);

    // Trigger refetch
    await result.current.refetch();

    expect(fetchRepositoryCasesWithLastResult).toHaveBeenCalledTimes(2);
  });

  it("passes different args to different query instances", async () => {
    const args1 = { where: { projectId: 1, isDeleted: false } };
    const args2 = { where: { projectId: 2, isDeleted: false } };

    (fetchRepositoryCasesWithLastResult as any).mockResolvedValue({
      success: true,
      data: [],
    });

    const wrapper = createWrapper();

    const { result: result1 } = renderHook(
      () => useRepositoryCasesWithLastResult(args1),
      { wrapper }
    );

    const { result: result2 } = renderHook(
      () => useRepositoryCasesWithLastResult(args2),
      { wrapper }
    );

    await waitFor(() => {
      expect(result1.current.isSuccess).toBe(true);
      expect(result2.current.isSuccess).toBe(true);
    });

    // Both should have called the server action with their respective args
    expect(fetchRepositoryCasesWithLastResult).toHaveBeenCalledWith(args1);
    expect(fetchRepositoryCasesWithLastResult).toHaveBeenCalledWith(args2);
  });
});

describe("useCountRepositoryCasesWithLastResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns count number when server action returns success with count", async () => {
    (countRepositoryCasesWithLastResult as any).mockResolvedValue({
      success: true,
      count: 42,
    });

    const where = { projectId: 42, isDeleted: false };
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useCountRepositoryCasesWithLastResult(where),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBe(42);
  });

  it("returns 0 when server action returns success=false with count=0", async () => {
    (countRepositoryCasesWithLastResult as any).mockResolvedValue({
      success: false,
      error: "Failed to count cases",
      count: 0,
    });

    const where = { projectId: 42, isDeleted: false };
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useCountRepositoryCasesWithLastResult(where),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // select function: (response) => response.count
    // count=0 on failure → returns 0
    expect(result.current.data).toBe(0);
  });

  it("passes where clause to server action", async () => {
    (countRepositoryCasesWithLastResult as any).mockResolvedValue({
      success: true,
      count: 10,
    });

    const where = {
      projectId: 99,
      isDeleted: false,
      isArchived: false,
      folderId: 5,
    };

    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useCountRepositoryCasesWithLastResult(where),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(countRepositoryCasesWithLastResult).toHaveBeenCalledWith(where);
    expect(countRepositoryCasesWithLastResult).toHaveBeenCalledTimes(1);
  });

  it("returns correct count for zero cases", async () => {
    (countRepositoryCasesWithLastResult as any).mockResolvedValue({
      success: true,
      count: 0,
    });

    const where = { projectId: 42, isDeleted: false };
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useCountRepositoryCasesWithLastResult(where),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBe(0);
  });

  it("uses correct query key with where clause", async () => {
    (countRepositoryCasesWithLastResult as any).mockResolvedValue({
      success: true,
      count: 5,
    });

    const where1 = { projectId: 1, isDeleted: false };
    const where2 = { projectId: 2, isDeleted: false };

    const wrapper = createWrapper();

    const { result: result1 } = renderHook(
      () => useCountRepositoryCasesWithLastResult(where1),
      { wrapper }
    );

    const { result: result2 } = renderHook(
      () => useCountRepositoryCasesWithLastResult(where2),
      { wrapper }
    );

    await waitFor(() => {
      expect(result1.current.isSuccess).toBe(true);
      expect(result2.current.isSuccess).toBe(true);
    });

    // Both hooks should have called the server action with their respective where clauses
    expect(countRepositoryCasesWithLastResult).toHaveBeenCalledWith(where1);
    expect(countRepositoryCasesWithLastResult).toHaveBeenCalledWith(where2);
  });
});
