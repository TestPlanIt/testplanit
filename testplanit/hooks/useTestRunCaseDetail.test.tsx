import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTestRunCaseDetail } from "./useTestRunCaseDetail";

const { mockApiFetch, mockFilterOrphanedFieldValues } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockFilterOrphanedFieldValues: vi.fn(),
}));

vi.mock("~/lib/basePath", () => ({ apiFetch: mockApiFetch }));
vi.mock("./useRepositoryCasesWithFilteredFields", () => ({
  filterOrphanedFieldValues: mockFilterOrphanedFieldValues,
}));

const renderDetail = (caseId: number | null, testRunId?: number) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useTestRunCaseDetail(caseId, testRunId), { wrapper });
};

describe("useTestRunCaseDetail", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockFilterOrphanedFieldValues.mockReset();
    mockFilterOrphanedFieldValues.mockImplementation((testcase) => ({
      ...testcase,
      filtered: true,
    }));
  });

  it("loads the case and returns it with orphaned field values filtered", async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ testcase: { id: 5, name: "Login" } }),
    });

    const { result } = renderDetail(5, 9);

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/test-runs/case-detail?caseId=5&testRunId=9"
    );
    expect(result.current.data).toEqual({
      id: 5,
      name: "Login",
      filtered: true,
    });
  });

  it("exposes only the case and its loading state", async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ testcase: { id: 5 } }),
    });

    const { result } = renderDetail(5);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(Object.keys(result.current).sort()).toEqual(["data", "isLoading"]);
  });

  it("does not fetch without a case", () => {
    const { result } = renderDetail(null);

    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });
});
