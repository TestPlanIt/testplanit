import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

vi.mock("~/app/actions/caseIdsByLatestStatus", () => ({
  fetchCaseIdsByLatestStatus: mockFetch,
}));

import { useCaseIdsByLatestStatus } from "./useCaseIdsByLatestStatus";

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useCaseIdsByLatestStatus", () => {
  it("returns null and fetches nothing while disabled", () => {
    const { result } = renderHook(
      () =>
        useCaseIdsByLatestStatus({
          where: { folderId: 1 },
          direction: "asc",
          enabled: false,
        }),
      { wrapper }
    );
    expect(result.current.pageIds).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns the sorted page ids on success", async () => {
    mockFetch.mockResolvedValue({ success: true, ids: [3, 1, 2] });
    const { result } = renderHook(
      () =>
        useCaseIdsByLatestStatus({
          where: { folderId: 1 },
          direction: "desc",
          enabled: true,
        }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.pageIds).toEqual([3, 1, 2]));
  });

  it("surfaces a server error as null, never as an empty page", async () => {
    // Regression guard: an error returned as [] used to read as "the sorted
    // page is genuinely empty", sticking the table on "No test cases".
    mockFetch.mockResolvedValue({ success: false, error: "boom" });
    const { result } = renderHook(
      () =>
        useCaseIdsByLatestStatus({
          where: { folderId: 1 },
          direction: "asc",
          enabled: true,
        }),
      { wrapper }
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.pageIds).toBeNull();
  });

  it("does not serve the previous filter's ids while a new where is in flight", async () => {
    // Regression guard for the removed placeholderData: ids computed for the
    // old folder must never be intersected with the new folder's rows.
    let release!: (v: { success: true; ids: number[] }) => void;
    mockFetch
      .mockResolvedValueOnce({ success: true, ids: [1, 2] })
      .mockImplementationOnce(
        () => new Promise((resolve) => (release = resolve))
      );

    const { result, rerender } = renderHook(
      ({ where }: { where: unknown }) =>
        useCaseIdsByLatestStatus({ where, direction: "asc", enabled: true }),
      { wrapper, initialProps: { where: { folderId: 1 } as unknown } }
    );

    await waitFor(() => expect(result.current.pageIds).toEqual([1, 2]));

    rerender({ where: { folderId: 2 } });
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    // In-flight for the new folder: null (fall back to unsorted), NOT [1, 2].
    expect(result.current.pageIds).toBeNull();

    release({ success: true, ids: [9] });
    await waitFor(() => expect(result.current.pageIds).toEqual([9]));
  });
});
