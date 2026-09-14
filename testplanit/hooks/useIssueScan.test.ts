import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockToastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    info: (...args: unknown[]) => mockToastInfo(...args),
    error: vi.fn(),
  },
}));

import { useIssueScan } from "./useIssueScan";

const messages = {
  started: "Queued",
  cancelRequested: "Cancelling",
  stillRunning: "Still running",
  failedToStart: "Could not start",
  networkError: "Network error",
};

const target = { repositoryId: 3, configId: 11, full: true };

describe("useIssueScan", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("queues the scan and polls until the report stops running", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ queued: true }),
    });
    const refetchConfig = vi
      .fn()
      .mockResolvedValueOnce({ data: { issueScanReport: { running: true } } })
      .mockResolvedValueOnce({ data: { issueScanReport: { running: true } } })
      .mockResolvedValueOnce({
        data: { issueScanReport: { scannedAt: "2026-09-13T00:00:00Z" } },
      });
    const { result } = renderHook(() =>
      useIssueScan({ refetchConfig, messages, pollIntervalMs: 0 })
    );

    await act(async () => {
      await result.current.startScan(target);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/code-repositories/3/scan-issues",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ projectConfigId: 11, full: true }),
      })
    );
    expect(mockToastInfo).toHaveBeenCalledWith("Queued");
    expect(refetchConfig).toHaveBeenCalledTimes(3);
    expect(result.current.isScanning).toBe(false);
    expect(result.current.scanError).toBeNull();
  });

  it("surfaces the server's refusal without polling", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Configuration not found" }),
    });
    const refetchConfig = vi.fn();
    const { result } = renderHook(() =>
      useIssueScan({ refetchConfig, messages, pollIntervalMs: 0 })
    );

    await act(async () => {
      await result.current.startScan(target);
    });

    expect(result.current.scanError).toBe("Configuration not found");
    expect(refetchConfig).not.toHaveBeenCalled();
  });

  it("gives up polling after the cap and says the scan is still running", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ queued: true }),
    });
    const refetchConfig = vi
      .fn()
      .mockResolvedValue({ data: { issueScanReport: { running: true } } });
    const { result } = renderHook(() =>
      useIssueScan({
        refetchConfig,
        messages,
        pollIntervalMs: 0,
        maxPolls: 2,
      })
    );

    await act(async () => {
      await result.current.startScan(target);
    });

    expect(mockToastInfo).toHaveBeenCalledWith("Still running");
    expect(result.current.isScanning).toBe(false);
  });

  it("asks the server to cancel and refetches the report", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ cancelling: true }),
    });
    const refetchConfig = vi
      .fn()
      .mockResolvedValue({ data: { issueScanReport: { running: true } } });
    const { result } = renderHook(() =>
      useIssueScan({ refetchConfig, messages, pollIntervalMs: 0 })
    );

    await act(async () => {
      await result.current.cancelScan({ repositoryId: 3, configId: 11 });
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/code-repositories/3/scan-issues/cancel",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ projectConfigId: 11 }),
      })
    );
    expect(mockToastInfo).toHaveBeenCalledWith("Cancelling");
    expect(refetchConfig).toHaveBeenCalledTimes(1);
  });

  it("follows a scan that was already running", async () => {
    const refetchConfig = vi
      .fn()
      .mockResolvedValueOnce({ data: { issueScanReport: { running: true } } })
      .mockResolvedValueOnce({ data: { issueScanReport: { created: 1 } } });
    const { result } = renderHook(() =>
      useIssueScan({ refetchConfig, messages, pollIntervalMs: 0 })
    );

    await act(async () => {
      await result.current.followScan();
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(refetchConfig).toHaveBeenCalledTimes(2);
    expect(result.current.isScanning).toBe(false);
    expect(result.current.isFollowing).toBe(false);
  });
});
