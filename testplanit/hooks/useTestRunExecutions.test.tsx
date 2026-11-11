import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTestRunExecutions } from "./useTestRunExecutions";

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

vi.mock("~/lib/basePath", () => ({ apiFetch: mockApiFetch }));

const execution = (id: number, status: string) => ({ id, status });

const respondWith = (executions: unknown[]) =>
  mockApiFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ executions }),
  });

const renderExecutions = (runId: number | null) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useTestRunExecutions(runId), { wrapper });
};

describe("useTestRunExecutions", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it("returns the run's executions with the newest as latest", async () => {
    respondWith([execution(2, "COMPLETED"), execution(1, "FAILED")]);

    const { result } = renderExecutions(7);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/test-runs/7/executions?limit=25"
    );
    expect(result.current.executions.map((row) => row.id)).toEqual([2, 1]);
    expect(result.current.latest?.id).toBe(2);
  });

  it("keeps the same refetch function across renders and data updates", async () => {
    respondWith([execution(1, "COMPLETED")]);

    const { result, rerender } = renderExecutions(7);
    const initialRefetch = result.current.refetch;

    await waitFor(() => expect(result.current.executions).toHaveLength(1));
    rerender();

    expect(result.current.refetch).toBe(initialRefetch);
  });

  it("refetches when refetch is called", async () => {
    respondWith([execution(1, "COMPLETED")]);

    const { result } = renderExecutions(7);
    await waitFor(() => expect(result.current.executions).toHaveLength(1));

    respondWith([execution(2, "COMPLETED"), execution(1, "COMPLETED")]);
    result.current.refetch();

    await waitFor(() => expect(result.current.executions).toHaveLength(2));
  });

  it("does not fetch without a run", () => {
    renderExecutions(null);

    expect(mockApiFetch).not.toHaveBeenCalled();
  });
});
