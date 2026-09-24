import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCreateFrozenReportLink } from "./useCreateFrozenReportLink";

const mockFetch = vi.fn();

function setup() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useCreateFrozenReportLink(), {
    wrapper,
  });
  return { result, invalidate };
}

const input = {
  entityType: "REPORT" as const,
  reportConfig: { reportType: "test-execution" },
  projectId: 7,
  title: "Sprint 2",
};

describe("useCreateFrozenReportLink", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch;
  });

  it("posts the input and returns the created link", async () => {
    const link = { id: "l1", shareKey: "k1", frozen: { truncated: false } };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => link,
    });
    const { result, invalidate } = setup();

    let outcome;
    await act(async () => {
      outcome = await result.current.createFrozenLink(input);
    });

    expect(outcome).toEqual({ status: "created", link });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/reports/frozen-links");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(input);
    // The link was written server-side; ShareLink lists refresh.
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["zenstack", "ShareLink"],
    });
    expect(result.current.isCreatingFrozen).toBe(false);
  });

  it("reports an over-the-cap report as truncation-required", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        code: "SNAPSHOT_TRUNCATION_REQUIRED",
        totalRowCount: 12000,
        maxRows: 10000,
      }),
    });
    const { result, invalidate } = setup();

    let outcome;
    await act(async () => {
      outcome = await result.current.createFrozenLink(input);
    });

    expect(outcome).toEqual({
      status: "truncation-required",
      truncation: { totalRowCount: 12000, maxRows: 10000 },
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("throws the server's error and clears the busy flag", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: "Forbidden" }),
    });
    const { result } = setup();

    await act(async () => {
      await expect(result.current.createFrozenLink(input)).rejects.toThrow(
        "Forbidden"
      );
    });
    expect(result.current.isCreatingFrozen).toBe(false);
  });

  it("falls back to a generic error for a non-JSON failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    });
    const { result } = setup();

    await act(async () => {
      await expect(result.current.createFrozenLink(input)).rejects.toThrow(
        "Failed to create frozen report"
      );
    });
  });
});
