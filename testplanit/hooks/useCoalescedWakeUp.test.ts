import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCoalescedWakeUp, WAKE_UP_COALESCE_MS } from "./useCoalescedWakeUp";
import type { TestRunWakeUp } from "./useTestRunLiveStream";

/**
 * Result rows publish one wake-up each (sideEffectsPlugin loops over the
 * written rows), so a reporter streaming a suite delivers a burst. Each
 * wake-up that reaches a consumer costs a round of refetches — on the runs
 * list that round is one request per mounted tile.
 */

const wakeUp = (runId?: number): TestRunWakeUp => ({
  event: "test_run.result_added",
  runId,
});

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout"],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCoalescedWakeUp", () => {
  it("collapses a burst into one flush carrying every run id seen", () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() => useCoalescedWakeUp(onFlush));

    act(() => {
      result.current(wakeUp(7));
      result.current(wakeUp(8));
      result.current(wakeUp(7));
    });
    expect(onFlush).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(WAKE_UP_COALESCE_MS);
    });
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0]).toEqual(new Set([7, 8]));
  });

  it("drops the sync checkpoint without scheduling a flush", () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() => useCoalescedWakeUp(onFlush));

    act(() => {
      result.current({ event: "sync" });
      vi.advanceTimersByTime(WAKE_UP_COALESCE_MS * 4);
    });
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("reports a missing run id as null so consumers can refetch broadly", () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() => useCoalescedWakeUp(onFlush));

    act(() => {
      result.current(wakeUp());
      vi.advanceTimersByTime(WAKE_UP_COALESCE_MS);
    });
    expect(onFlush.mock.calls[0][0]).toEqual(new Set([null]));
  });

  it("keeps flushing under a sustained stream rather than starving", () => {
    // The window runs from the first wake-up, not the latest — a debounce
    // that restarted on each one would never fire while results stream in.
    const onFlush = vi.fn();
    const { result } = renderHook(() => useCoalescedWakeUp(onFlush));

    for (let i = 0; i < 4; i++) {
      act(() => {
        result.current(wakeUp(1));
        vi.advanceTimersByTime(WAKE_UP_COALESCE_MS / 2);
        result.current(wakeUp(1));
        vi.advanceTimersByTime(WAKE_UP_COALESCE_MS / 2);
      });
    }
    expect(onFlush).toHaveBeenCalledTimes(4);
  });

  it("starts each window empty so a stale run id can't leak forward", () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() => useCoalescedWakeUp(onFlush));

    act(() => {
      result.current(wakeUp(7));
      vi.advanceTimersByTime(WAKE_UP_COALESCE_MS);
      result.current(wakeUp(9));
      vi.advanceTimersByTime(WAKE_UP_COALESCE_MS);
    });
    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush.mock.calls[1][0]).toEqual(new Set([9]));
  });

  it("uses the latest onFlush without resubscribing", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ cb }) => useCoalescedWakeUp(cb),
      { initialProps: { cb: first } }
    );
    const handler = result.current;

    act(() => {
      handler(wakeUp(3));
    });
    rerender({ cb: second });
    act(() => {
      vi.advanceTimersByTime(WAKE_UP_COALESCE_MS);
    });

    expect(result.current).toBe(handler);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending flush on unmount", () => {
    const onFlush = vi.fn();
    const { result, unmount } = renderHook(() => useCoalescedWakeUp(onFlush));

    act(() => {
      result.current(wakeUp(5));
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(WAKE_UP_COALESCE_MS * 2);
    });
    expect(onFlush).not.toHaveBeenCalled();
  });
});
