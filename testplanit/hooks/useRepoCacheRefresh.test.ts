import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockToastSuccess = vi.fn();
const mockToastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    info: (...args: unknown[]) => mockToastInfo(...args),
    error: vi.fn(),
  },
}));

import { useRepoCacheRefresh } from "./useRepoCacheRefresh";

const messages = {
  pending: "Refreshing...",
  listingFiles: "Listing files…",
  cachingFiles: (count: number) => `Caching ${count} files…`,
  contentsError: "Failed to cache file contents",
  networkError: "Network error",
  refreshComplete: (fileCount: number) => `Done: ${fileCount}`,
  refreshInProgress: "Still running",
};

const target = { repositoryId: 3, configId: 11 };

describe("useRepoCacheRefresh", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues the refresh for the config and polls until the worker reports success", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ queued: true }),
    });
    const refetchConfig = vi
      .fn()
      .mockResolvedValueOnce({ data: { cacheStatus: "pending" } })
      .mockResolvedValueOnce({
        data: { cacheStatus: "pending", cacheFileCount: 40 },
      })
      .mockResolvedValueOnce({
        data: { cacheStatus: "success", cacheFileCount: 42 },
      });
    const { result } = renderHook(() =>
      useRepoCacheRefresh({
        refetchConfig,
        messages,
        pollIntervalMs: 0,
      })
    );

    await act(async () => {
      await result.current.refreshCache(target);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/code-repositories/3/refresh-cache",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ projectConfigId: 11 }),
      })
    );
    expect(refetchConfig).toHaveBeenCalledTimes(3);
    expect(mockToastSuccess).toHaveBeenCalledWith("Done: 42");
    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.refreshStep).toBe("");
    expect(result.current.refreshError).toBeNull();
  });

  it("reports the enqueue failure and refetches the config without polling", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Repository not found" }),
    });
    const refetchConfig = vi.fn().mockResolvedValue({ data: null });
    const { result } = renderHook(() =>
      useRepoCacheRefresh({ refetchConfig, messages, pollIntervalMs: 0 })
    );

    await act(async () => {
      await result.current.refreshCache(target);
    });

    expect(result.current.refreshError).toBe("Repository not found");
    expect(refetchConfig).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("shows the worker's cacheError, falling back to the contents error message", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    const refetchConfig = vi
      .fn()
      .mockResolvedValueOnce({
        data: { cacheStatus: "error", cacheError: "Rate limited" },
      })
      .mockResolvedValueOnce({ data: { cacheStatus: "error" } });
    const { result } = renderHook(() =>
      useRepoCacheRefresh({ refetchConfig, messages, pollIntervalMs: 0 })
    );

    await act(async () => {
      await result.current.refreshCache(target);
    });
    expect(result.current.refreshError).toBe("Rate limited");

    await act(async () => {
      await result.current.refreshCache(target);
    });
    expect(result.current.refreshError).toBe("Failed to cache file contents");
  });

  it("gives up polling after maxPolls and tells the user it continues in the background", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    const refetchConfig = vi
      .fn()
      .mockResolvedValue({ data: { cacheStatus: "pending" } });
    const { result } = renderHook(() =>
      useRepoCacheRefresh({
        refetchConfig,
        messages,
        pollIntervalMs: 0,
        maxPolls: 2,
      })
    );

    await act(async () => {
      await result.current.refreshCache(target);
    });

    expect(refetchConfig).toHaveBeenCalledTimes(2);
    expect(mockToastInfo).toHaveBeenCalledWith("Still running");
    expect(result.current.isRefreshing).toBe(false);
  });

  it("uses the thrown error's message when the request itself fails", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("offline")
    );
    const refetchConfig = vi.fn();
    const { result } = renderHook(() =>
      useRepoCacheRefresh({ refetchConfig, messages, pollIntervalMs: 0 })
    );

    await act(async () => {
      await result.current.refreshCache(target);
    });

    expect(result.current.refreshError).toBe("offline");
    expect(refetchConfig).not.toHaveBeenCalled();
  });
});
