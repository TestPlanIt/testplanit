/**
 * Unit tests for the useCopyMoveJob hook.
 * Tests cover the full job lifecycle: preflight, submit, progress polling,
 * completion, cancellation, error handling, and cleanup on unmount.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted() for stable mock refs to prevent OOM infinite useEffect loops
// when hook return values are used as React dependency arrays.
const fetchMock = vi.hoisted(() => vi.fn());

vi.stubGlobal("fetch", fetchMock);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a standard ok fetch response with JSON body */
function okResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response);
}

/** Build a failed fetch response */
function errorResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

// ─────────────────────────────────────────────────────────────────────────────

// Import AFTER vi.stubGlobal so the hook picks up the mocked fetch
import { useCopyMoveJob } from "./useCopyMoveJob";

const PREFLIGHT_ARGS = {
  operation: "copy" as const,
  caseIds: [1, 2, 3],
  sourceProjectId: 10,
  targetProjectId: 20,
};

const SUBMIT_ARGS = {
  operation: "copy" as const,
  caseIds: [1, 2, 3],
  sourceProjectId: 10,
  targetProjectId: 20,
  targetFolderId: 5,
  conflictResolution: "skip" as const,
  sharedStepGroupResolution: "reuse" as const,
};

describe("useCopyMoveJob", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Initial state ─────────────────────────────────────────────────────────

  it("initializes with idle status and null state", () => {
    const { result } = renderHook(() => useCopyMoveJob());

    expect(result.current.status).toBe("idle");
    expect(result.current.jobId).toBeNull();
    expect(result.current.progress).toBeNull();
    expect(result.current.result).toBeNull();
    expect(result.current.preflight).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isPrefighting).toBe(false);
    expect(result.current.isSubmitting).toBe(false);
  });

  it("exposes all required actions", () => {
    const { result } = renderHook(() => useCopyMoveJob());

    expect(typeof result.current.runPreflight).toBe("function");
    expect(typeof result.current.submit).toBe("function");
    expect(typeof result.current.cancel).toBe("function");
    expect(typeof result.current.reset).toBe("function");
  });

  // ── runPreflight ──────────────────────────────────────────────────────────

  it("runPreflight calls POST /api/repository/copy-move/preflight with correct body", async () => {
    const preflightResponse = {
      hasSourceReadAccess: true,
      hasTargetWriteAccess: true,
      hasSourceUpdateAccess: true,
      templateMismatch: false,
      missingTemplates: [],
      canAutoAssignTemplates: true,
      workflowMappings: [],
      unmappedStates: [],
      collisions: [],
      targetRepositoryId: 1,
      targetDefaultWorkflowStateId: 2,
      targetTemplateId: 3,
    };

    fetchMock.mockResolvedValueOnce(okResponse(preflightResponse));

    const { result } = renderHook(() => useCopyMoveJob());

    await act(async () => {
      await result.current.runPreflight(PREFLIGHT_ARGS);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/repository/copy-move/preflight",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify(PREFLIGHT_ARGS),
      }),
    );
    expect(result.current.preflight).toEqual(preflightResponse);
  });

  it("runPreflight sets isPrefighting=true during fetch and false after", async () => {
    let resolvePrefligh!: (v: unknown) => void;
    const preflightPromise = new Promise((resolve) => {
      resolvePrefligh = resolve;
    });
    fetchMock.mockReturnValueOnce(
      preflightPromise.then(() => ({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ hasSourceReadAccess: true }),
      })),
    );

    const { result } = renderHook(() => useCopyMoveJob());

    act(() => {
      result.current.runPreflight(PREFLIGHT_ARGS);
    });

    expect(result.current.isPrefighting).toBe(true);

    await act(async () => {
      resolvePrefligh(undefined);
      await Promise.resolve();
    });

    expect(result.current.isPrefighting).toBe(false);
  });

  it("runPreflight sets error on non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(403, { error: "Access denied" }),
    );

    const { result } = renderHook(() => useCopyMoveJob());

    await act(async () => {
      await result.current.runPreflight(PREFLIGHT_ARGS);
    });

    expect(result.current.error).toBe("Access denied");
    expect(result.current.isPrefighting).toBe(false);
  });

  // ── submit ────────────────────────────────────────────────────────────────

  it("submit calls POST /api/repository/copy-move with correct body and sets jobId", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse({ jobId: "job-cm-001" }))
      // immediate poll after jobId set
      .mockResolvedValueOnce(okResponse({ state: "waiting", progress: null }));

    const { result } = renderHook(() => useCopyMoveJob());

    await act(async () => {
      await result.current.submit(SUBMIT_ARGS);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/repository/copy-move",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify(SUBMIT_ARGS),
      }),
    );
    expect(result.current.jobId).toBe("job-cm-001");
    expect(result.current.isSubmitting).toBe(false);
  });

  it("submit sets isSubmitting=true during inflight then false after", async () => {
    let resolveSubmit!: (v: unknown) => void;
    const submitPromise = new Promise((resolve) => {
      resolveSubmit = resolve;
    });
    fetchMock.mockReturnValueOnce(
      submitPromise.then(() => ({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ jobId: "job-cm-002" }),
      })),
    );

    const { result } = renderHook(() => useCopyMoveJob());

    act(() => {
      result.current.submit(SUBMIT_ARGS);
    });

    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      resolveSubmit(undefined);
      await Promise.resolve();
    });

    expect(result.current.isSubmitting).toBe(false);
  });

  it("after submit sets jobId, polling begins (fetch called for status endpoint)", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse({ jobId: "job-cm-003" }))
      .mockResolvedValueOnce(
        okResponse({ state: "active", progress: { processed: 1, total: 3 } }),
      );

    const { result } = renderHook(() => useCopyMoveJob());

    await act(async () => {
      await result.current.submit(SUBMIT_ARGS);
    });

    // Polling fires immediately after jobId is set
    const statusCall = fetchMock.mock.calls.find(([url]: any) =>
      url.includes("copy-move/status"),
    );
    expect(statusCall).toBeDefined();
    expect(statusCall![0]).toContain("/api/repository/copy-move/status/job-cm-003");
  });

  // ── Polling ───────────────────────────────────────────────────────────────

  it("polling updates progress with {processed, total} when status is active", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse({ jobId: "job-poll-1" }))
      // first poll: waiting
      .mockResolvedValueOnce(
        okResponse({ state: "waiting", progress: { processed: 0, total: 5 } }),
      )
      // second poll: active with progress
      .mockResolvedValueOnce(
        okResponse({ state: "active", progress: { processed: 2, total: 5 } }),
      );

    const { result } = renderHook(() => useCopyMoveJob());

    await act(async () => {
      await result.current.submit(SUBMIT_ARGS);
    });

    // Advance past poll interval to trigger second poll
    await act(async () => {
      vi.advanceTimersByTime(2500);
      await Promise.resolve();
    });

    expect(result.current.progress).toMatchObject({ processed: 2, total: 5 });
    expect(result.current.status).toBe("active");
  });

  it("polling sets status=completed and result when state is completed", async () => {
    const jobResult = {
      copiedCount: 3,
      movedCount: 0,
      skippedCount: 0,
      droppedLinkCount: 0,
      errors: [],
    };

    fetchMock
      .mockResolvedValueOnce(okResponse({ jobId: "job-complete-1" }))
      .mockResolvedValueOnce(
        okResponse({
          state: "completed",
          progress: { processed: 3, total: 3 },
          result: jobResult,
        }),
      );

    const { result } = renderHook(() => useCopyMoveJob());

    await act(async () => {
      await result.current.submit(SUBMIT_ARGS);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe("completed");
    expect(result.current.result).toEqual(jobResult);
  });

  it("polling sets status=failed and error when state is failed", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse({ jobId: "job-fail-1" }))
      .mockResolvedValueOnce(
        okResponse({
          state: "failed",
          failedReason: "Copy operation failed: permission denied",
        }),
      );

    const { result } = renderHook(() => useCopyMoveJob());

    await act(async () => {
      await result.current.submit(SUBMIT_ARGS);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe("failed");
    expect(result.current.error).toBe("Copy operation failed: permission denied");
  });

  it("polling stops (clearInterval) on completed state", async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    fetchMock
      .mockResolvedValueOnce(okResponse({ jobId: "job-stop-1" }))
      .mockResolvedValueOnce(
        okResponse({
          state: "completed",
          result: { copiedCount: 1, movedCount: 0, skippedCount: 0, droppedLinkCount: 0, errors: [] },
        }),
      );

    const { result } = renderHook(() => useCopyMoveJob());

    await act(async () => {
      await result.current.submit(SUBMIT_ARGS);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(clearIntervalSpy).toHaveBeenCalled();

    // Advance timers to confirm no more polls fire after completion
    const fetchCountBefore = fetchMock.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(6000);
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.length).toBe(fetchCountBefore);
  });

  // ── cancel ────────────────────────────────────────────────────────────────

  it("cancel calls POST /api/repository/copy-move/cancel/{jobId} and resets all state", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse({ jobId: "job-cancel-1" }))
      // immediate poll
      .mockResolvedValueOnce(
        okResponse({ state: "active", progress: { processed: 1, total: 3 } }),
      )
      // cancel endpoint
      .mockResolvedValueOnce(okResponse({ cancelled: true }));

    const { result } = renderHook(() => useCopyMoveJob());

    await act(async () => {
      await result.current.submit(SUBMIT_ARGS);
    });

    await act(async () => {
      await result.current.cancel();
    });

    const cancelCall = fetchMock.mock.calls.find(([url]: any) =>
      url.includes("copy-move/cancel"),
    );
    expect(cancelCall).toBeDefined();
    expect(cancelCall![0]).toBe("/api/repository/copy-move/cancel/job-cancel-1");
    expect(cancelCall![1]).toMatchObject({ method: "POST" });

    expect(result.current.status).toBe("idle");
    expect(result.current.jobId).toBeNull();
    expect(result.current.progress).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isSubmitting).toBe(false);
  });

  it("cancel aborts in-flight submit via AbortController", async () => {
    // Simulate the fetch rejecting with AbortError when signal is aborted
    let rejectFetch!: (err: Error) => void;
    const fetchPromise = new Promise<Response>((_resolve, reject) => {
      rejectFetch = reject;
    });
    fetchMock.mockReturnValueOnce(fetchPromise);

    const { result } = renderHook(() => useCopyMoveJob());

    // Start submit (in flight)
    act(() => {
      result.current.submit(SUBMIT_ARGS);
    });

    expect(result.current.isSubmitting).toBe(true);

    // Cancel immediately — abort the in-flight submit, then reject the fetch
    await act(async () => {
      await result.current.cancel();
      // Simulate the fetch rejecting with AbortError (what browsers do on abort)
      const abortErr = new Error("The operation was aborted");
      abortErr.name = "AbortError";
      rejectFetch(abortErr);
      await Promise.resolve();
    });

    // After abort, state should remain idle (set by cancel(), not overwritten by AbortError handler)
    expect(result.current.status).toBe("idle");
    expect(result.current.jobId).toBeNull();
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  it("reset clears all state and stops polling", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse({ jobId: "job-reset-1" }))
      .mockResolvedValueOnce(
        okResponse({
          state: "completed",
          result: { copiedCount: 2, movedCount: 0, skippedCount: 0, droppedLinkCount: 0, errors: [] },
        }),
      );

    const { result } = renderHook(() => useCopyMoveJob());

    await act(async () => {
      await result.current.submit(SUBMIT_ARGS);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe("completed");

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.jobId).toBeNull();
    expect(result.current.progress).toBeNull();
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isPrefighting).toBe(false);
    expect(result.current.isSubmitting).toBe(false);
  });

  // ── Progress equality check ───────────────────────────────────────────────

  it("progress equality check prevents unnecessary re-renders (same values return same ref)", async () => {
    const sameProgress = { processed: 2, total: 5 };

    fetchMock
      .mockResolvedValueOnce(okResponse({ jobId: "job-eq-1" }))
      // first poll: active
      .mockResolvedValueOnce(
        okResponse({ state: "active", progress: sameProgress }),
      )
      // second poll: same values
      .mockResolvedValueOnce(
        okResponse({ state: "active", progress: { processed: 2, total: 5 } }),
      );

    const { result } = renderHook(() => useCopyMoveJob());

    await act(async () => {
      await result.current.submit(SUBMIT_ARGS);
    });

    // First poll sets progress
    await act(async () => {
      await Promise.resolve();
    });

    const progressRefAfterFirstPoll = result.current.progress;

    // Second poll (same values) should return same object reference
    await act(async () => {
      vi.advanceTimersByTime(2500);
      await Promise.resolve();
    });

    // Same reference means no re-render triggered
    expect(result.current.progress).toBe(progressRefAfterFirstPoll);
  });

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  it("stops polling interval on unmount", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse({ jobId: "job-unmount-1" }))
      .mockResolvedValue(
        okResponse({ state: "active", progress: { processed: 1, total: 5 } }),
      );

    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    const { result, unmount } = renderHook(() => useCopyMoveJob());

    await act(async () => {
      await result.current.submit(SUBMIT_ARGS);
    });

    const fetchCountBefore = fetchMock.mock.calls.length;

    unmount();

    await act(async () => {
      vi.advanceTimersByTime(6000);
      await Promise.resolve();
    });

    const fetchCountAfter = fetchMock.mock.calls.length;
    expect(fetchCountAfter).toBe(fetchCountBefore);
    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
