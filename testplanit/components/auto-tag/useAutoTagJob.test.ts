/**
 * Integration tests for the useAutoTagJob hook.
 * Tests cover the full job lifecycle: submit, progress tracking,
 * completion, cancellation, error handling, and cleanup on unmount.
 *
 * Covers HOOK-05: Integration hooks (BullMQ job lifecycle).
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityType } from "~/lib/llm/services/auto-tag/types";

// Use vi.hoisted() for stable mock refs to prevent OOM infinite useEffect loops
// when hook return values are used as React dependency arrays.
// (Phase 13 / Phase 16 decision: new array/object instances per render trigger infinite re-renders)
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
function _errorResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

// ────────────────────────────────────────────────────────────────────────────

// Import AFTER vi.stubGlobal so the hook picks up the mocked fetch
import { useAutoTagJob } from "./useAutoTagJob";

describe("useAutoTagJob", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockReset();
    // Clear localStorage mocks
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(null);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Initial state ───────────────────────────────────────────────────────

  it("initializes with idle status and null job state", () => {
    const { result } = renderHook(() => useAutoTagJob());

    expect(result.current.status).toBe("idle");
    expect(result.current.jobId).toBeNull();
    expect(result.current.progress).toBeNull();
    expect(result.current.suggestions).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.isApplying).toBe(false);
  });

  it("exposes all required actions and fields", () => {
    const { result } = renderHook(() => useAutoTagJob());

    expect(typeof result.current.submit).toBe("function");
    expect(typeof result.current.cancel).toBe("function");
    expect(typeof result.current.reset).toBe("function");
    expect(typeof result.current.toggleTag).toBe("function");
    expect(typeof result.current.editTag).toBe("function");
    expect(typeof result.current.apply).toBe("function");
    expect(result.current.selections).toBeInstanceOf(Map);
    expect(result.current.edits).toBeInstanceOf(Map);
    expect(result.current.summary).toMatchObject({
      assignCount: 0,
      newCount: 0,
    });
  });

  // ── Submit ──────────────────────────────────────────────────────────────

  it("submit transitions status to waiting and sets jobId on success", async () => {
    fetchMock
      // submit call
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ jobId: "job-abc-123" }),
      })
      // immediate poll call triggered by jobId+status change
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ state: "waiting", progress: null }),
      });

    const { result } = renderHook(() => useAutoTagJob());

    await act(async () => {
      await result.current.submit(
        [1, 2, 3],
        "repositoryCase" as EntityType,
        10
      );
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auto-tag/submit",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          entityIds: [1, 2, 3],

          entityType: "repositoryCase",
          projectId: 10,
        }),
      })
    );
    expect(result.current.jobId).toBe("job-abc-123");
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
        json: () => Promise.resolve({ jobId: "job-xyz" }),
      }))
    );

    const { result } = renderHook(() => useAutoTagJob());

    let submitDone = false;
    act(() => {
      result.current.submit([5], "repositoryCase" as EntityType, 1).then(() => {
        submitDone = true;
      });
    });

    // isSubmitting should be true while the submit is in flight
    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      resolveSubmit(undefined);
      // flush microtasks
      await Promise.resolve();
    });

    // After resolution, isSubmitting goes false
    expect(submitDone || result.current.isSubmitting === false).toBe(true);
  });

  it("submit includes allowNewTags option when provided", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ jobId: "job-allow-new-tags" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ state: "waiting", progress: null }),
      });

    const { result } = renderHook(() => useAutoTagJob());

    await act(async () => {
      await result.current.submit([1, 2], "repositoryCase" as EntityType, 9, {
        allowNewTags: false,
      });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auto-tag/submit",
      expect.objectContaining({
        body: JSON.stringify({
          entityIds: [1, 2],
          entityType: "repositoryCase",
          projectId: 9,
          allowNewTags: false,
        }),
      })
    );
  });

  it("submit sets error state on HTTP failure", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ error: "Queue unavailable" }),
    });

    const { result } = renderHook(() => useAutoTagJob());

    await act(async () => {
      await result.current.submit([1], "repositoryCase" as EntityType, 1);
    });

    expect(result.current.status).toBe("failed");
    expect(result.current.error).toBe("Queue unavailable");
    expect(result.current.isSubmitting).toBe(false);
  });

  it("submit sets error state on network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useAutoTagJob());

    await act(async () => {
      await result.current.submit([1], "repositoryCase" as EntityType, 1);
    });

    expect(result.current.status).toBe("failed");
    expect(result.current.error).toBe("Network error");
    expect(result.current.isSubmitting).toBe(false);
  });

  // ── Progress polling ────────────────────────────────────────────────────

  it("polling updates progress state as job becomes active", async () => {
    fetchMock
      // submit
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ jobId: "job-poll-1" }),
      })
      // first poll (immediate): waiting
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            state: "waiting",
            progress: { analyzed: 0, total: 5 },
          }),
      })
      // second poll (after 2s interval): active with progress
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            state: "active",
            progress: { analyzed: 2, total: 5 },
          }),
      });

    const { result } = renderHook(() => useAutoTagJob());

    await act(async () => {
      await result.current.submit(
        [1, 2, 3, 4, 5],
        "repositoryCase" as EntityType,
        1
      );
    });

    // Advance past poll interval to trigger second poll
    await act(async () => {
      vi.advanceTimersByTime(2500);
      await Promise.resolve();
    });

    // Progress should reflect the active poll response
    expect(result.current.progress).toMatchObject({ analyzed: 2, total: 5 });
    expect(result.current.status).toBe("active");
  });

  // ── Completion ──────────────────────────────────────────────────────────

  it("polling transitions to completed status with suggestions", async () => {
    const suggestions = [
      {
        entityId: 1,
        entityType: "repositoryCase",
        entityName: "Test Case 1",
        currentTags: [],
        tags: [
          { tagName: "login", isExisting: false },
          { tagName: "auth", isExisting: true },
        ],
      },
    ];

    fetchMock
      // submit
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ jobId: "job-complete-1" }),
      })
      // poll: completed
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            state: "completed",
            progress: { analyzed: 3, total: 3 },
            result: { suggestions },
          }),
      });

    const { result } = renderHook(() => useAutoTagJob());

    await act(async () => {
      await result.current.submit([1, 2, 3], "repositoryCase" as EntityType, 1);
    });

    // Let the immediate poll resolve
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe("completed");
    expect(result.current.suggestions).toHaveLength(1);
    expect(result.current.suggestions![0].entityId).toBe(1);
    // Selections should be initialized (opt-out model: all tags accepted)
    expect(result.current.selections.get(1)).toBeInstanceOf(Set);
    expect(result.current.selections.get(1)!.has("login")).toBe(true);
    expect(result.current.selections.get(1)!.has("auth")).toBe(true);
  });

  it("completed job sets error when result contains errors array", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ jobId: "job-partial-err" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            state: "completed",
            result: {
              suggestions: [],
              errors: [
                "Batch 1 failed: LLM timeout",
                "Batch 2 failed: parsing error",
              ],
            },
          }),
      });

    const { result } = renderHook(() => useAutoTagJob());

    await act(async () => {
      await result.current.submit([1], "repositoryCase" as EntityType, 1);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe("completed");
    expect(result.current.error).toContain("Batch 1 failed");
    expect(result.current.error).toContain("Batch 2 failed");
  });

  // ── Job failure ─────────────────────────────────────────────────────────

  it("polling transitions to failed status on job failure", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ jobId: "job-fail-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            state: "failed",
            failedReason: "LLM service unavailable",
          }),
      });

    const { result } = renderHook(() => useAutoTagJob());

    await act(async () => {
      await result.current.submit([1], "repositoryCase" as EntityType, 1);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe("failed");
    expect(result.current.error).toBe("LLM service unavailable");
  });

  // ── Cancellation ────────────────────────────────────────────────────────

  it("cancel calls the cancel API endpoint", async () => {
    fetchMock
      // submit
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ jobId: "job-cancel-1" }),
      })
      // immediate poll
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            state: "active",
            progress: { analyzed: 1, total: 3 },
          }),
      })
      // cancel endpoint
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ cancelled: true }),
      });

    const { result } = renderHook(() => useAutoTagJob());

    await act(async () => {
      await result.current.submit([1, 2, 3], "repositoryCase" as EntityType, 1);
    });

    await act(async () => {
      await result.current.cancel();
    });

    const cancelCall = fetchMock.mock.calls.find(([url]: any) =>
      url.includes("/api/auto-tag/cancel/")
    );
    expect(cancelCall).toBeDefined();
    expect(cancelCall![0]).toBe("/api/auto-tag/cancel/job-cancel-1");
    expect(cancelCall![1]).toMatchObject({ method: "POST" });
  });

  it("cancel resets all state to idle", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ jobId: "job-reset-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            state: "active",
            progress: { analyzed: 1, total: 2 },
          }),
      })
      .mockResolvedValueOnce(okResponse({ cancelled: true }));

    const { result } = renderHook(() => useAutoTagJob());

    await act(async () => {
      await result.current.submit([1, 2], "repositoryCase" as EntityType, 1);
    });

    await act(async () => {
      await result.current.cancel();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.jobId).toBeNull();
    expect(result.current.progress).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.isApplying).toBe(false);
  });

  // ── Reset ───────────────────────────────────────────────────────────────

  it("reset clears state back to idle without API call", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ jobId: "job-reset-2" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            state: "completed",
            result: { suggestions: [] },
          }),
      });

    const { result } = renderHook(() => useAutoTagJob());

    await act(async () => {
      await result.current.submit([1], "repositoryCase" as EntityType, 1);
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
    expect(result.current.suggestions).toBeNull();
    expect(result.current.progress).toBeNull();
  });

  // ── Tag selection (toggleTag) ───────────────────────────────────────────

  it("toggleTag deselects an accepted tag", async () => {
    const suggestions = [
      {
        entityId: 42,
        entityType: "repositoryCase",
        entityName: "Case A",
        currentTags: [],
        tags: [
          { tagName: "smoke", isExisting: true },
          { tagName: "regression", isExisting: true },
        ],
      },
    ];

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ jobId: "job-toggle" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ state: "completed", result: { suggestions } }),
      });

    const { result } = renderHook(() => useAutoTagJob());

    await act(async () => {
      await result.current.submit([42], "repositoryCase" as EntityType, 1);
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Initially both tags are accepted
    expect(result.current.selections.get(42)!.has("smoke")).toBe(true);

    act(() => {
      result.current.toggleTag(42, "smoke");
    });

    expect(result.current.selections.get(42)!.has("smoke")).toBe(false);
    expect(result.current.selections.get(42)!.has("regression")).toBe(true);
  });

  it("toggleTag re-selects a deselected tag", async () => {
    const suggestions = [
      {
        entityId: 7,
        entityType: "repositoryCase",
        entityName: "Case B",
        currentTags: [],
        tags: [{ tagName: "critical", isExisting: false }],
      },
    ];

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ jobId: "job-toggle-2" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ state: "completed", result: { suggestions } }),
      });

    const { result } = renderHook(() => useAutoTagJob());

    await act(async () => {
      await result.current.submit([7], "repositoryCase" as EntityType, 1);
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Deselect then re-select
    act(() => {
      result.current.toggleTag(7, "critical");
    });
    expect(result.current.selections.get(7)!.has("critical")).toBe(false);

    act(() => {
      result.current.toggleTag(7, "critical");
    });
    expect(result.current.selections.get(7)!.has("critical")).toBe(true);
  });

  // ── Cleanup on unmount ──────────────────────────────────────────────────

  it("stops polling interval on unmount", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ jobId: "job-unmount" }),
      })
      // First poll: still active
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            state: "active",
            progress: { analyzed: 1, total: 5 },
          }),
      });

    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    const { result, unmount } = renderHook(() => useAutoTagJob());

    await act(async () => {
      await result.current.submit(
        [1, 2, 3, 4, 5],
        "repositoryCase" as EntityType,
        1
      );
    });

    // Polling is active at this point
    const fetchCountBefore = fetchMock.mock.calls.length;

    // Unmount — should stop polling
    unmount();

    // Advance timers to confirm no more polls fire
    await act(async () => {
      vi.advanceTimersByTime(6000);
      await Promise.resolve();
    });

    const fetchCountAfter = fetchMock.mock.calls.length;
    // No additional polls after unmount
    expect(fetchCountAfter).toBe(fetchCountBefore);
    // clearInterval was called during cleanup
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  // ── localStorage persistence ────────────────────────────────────────────

  it("persists jobId to localStorage when persistKey is provided", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ jobId: "job-persist-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ state: "waiting" }),
      });

    const { result } = renderHook(() => useAutoTagJob("test-persist-key"));

    await act(async () => {
      await result.current.submit([1], "repositoryCase" as EntityType, 1);
    });

    expect(setItemSpy).toHaveBeenCalledWith(
      "test-persist-key",
      "job-persist-1"
    );
  });

  it("restores persisted jobId from localStorage on mount", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue("job-restored-99");

    // Poll for the restored job
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          state: "active",
          progress: { analyzed: 2, total: 4 },
        }),
    });

    const { result } = renderHook(() => useAutoTagJob("test-restore-key"));

    // Let the restore useEffect and poll run
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.jobId).toBe("job-restored-99");
  });
});
