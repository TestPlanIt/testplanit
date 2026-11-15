import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeExecutionTimer,
  enterExecutionTimer,
  executionTimerElapsed,
  executionTimerKey,
  leaveExecutionTimer,
  pauseExecutionTimer,
  readExecutionTimer,
  resetExecutionTimersForTest,
  resumeExecutionTimer,
  setExecutionTimer,
  useExecutionTimer,
} from "./useExecutionTimer";

const KEY = executionTimerKey(7, 42);
const STORAGE_KEY = "testplanit:execution-timers";

describe("execution timers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
    window.sessionStorage.clear();
    resetExecutionTimersForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("names a run case, and an iteration of it, differently", () => {
    expect(executionTimerKey(7, 42)).toBe("run:7:case:42");
    expect(executionTimerKey(7, 42, 3)).toBe("run:7:case:42:iter:3");
    expect(executionTimerKey(7, 42, null)).toBe("run:7:case:42");
  });

  it("starts counting when a case is shown, without being asked", () => {
    enterExecutionTimer(KEY);
    vi.advanceTimersByTime(12_400);
    expect(readExecutionTimer(KEY)).toBe(12);
  });

  it("counts from the clock, so time passes even when nothing ticks", () => {
    enterExecutionTimer(KEY);
    // A hidden tab runs no timers; only the wall clock moves.
    vi.setSystemTime(new Date("2026-11-15T10:05:30Z"));
    expect(readExecutionTimer(KEY)).toBe(330);
  });

  it("pauses and resumes at the tester's request", () => {
    enterExecutionTimer(KEY);
    vi.advanceTimersByTime(5_000);
    pauseExecutionTimer(KEY);
    vi.advanceTimersByTime(60_000);
    expect(readExecutionTimer(KEY)).toBe(5);

    resumeExecutionTimer(KEY);
    vi.advanceTimersByTime(3_000);
    expect(readExecutionTimer(KEY)).toBe(8);
  });

  it("stops when the case is left and continues when it is shown again", () => {
    enterExecutionTimer(KEY);
    vi.advanceTimersByTime(10_000);
    leaveExecutionTimer(KEY);
    vi.advanceTimersByTime(60_000);
    expect(readExecutionTimer(KEY)).toBe(10);

    enterExecutionTimer(KEY);
    vi.advanceTimersByTime(2_000);
    expect(readExecutionTimer(KEY)).toBe(12);
  });

  it("keeps running while anything still shows the case", () => {
    enterExecutionTimer(KEY); // the case sheet
    enterExecutionTimer(KEY); // the Add Result dialog
    vi.advanceTimersByTime(4_000);
    leaveExecutionTimer(KEY); // the dialog closes
    vi.advanceTimersByTime(4_000);
    expect(readExecutionTimer(KEY)).toBe(8);
  });

  it("does not restart a clock the tester paused when the case is reopened", () => {
    enterExecutionTimer(KEY);
    vi.advanceTimersByTime(5_000);
    pauseExecutionTimer(KEY);
    leaveExecutionTimer(KEY);

    enterExecutionTimer(KEY);
    vi.advanceTimersByTime(30_000);
    expect(readExecutionTimer(KEY)).toBe(5);
  });

  it("shows a typed time and stops there", () => {
    enterExecutionTimer(KEY);
    vi.advanceTimersByTime(5_000);
    setExecutionTimer(KEY, 90);
    vi.advanceTimersByTime(10_000);
    expect(readExecutionTimer(KEY)).toBe(90);
  });

  it("forgets a glance of under a second", () => {
    enterExecutionTimer(KEY);
    vi.advanceTimersByTime(400);
    leaveExecutionTimer(KEY);
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("gives null, not zero, when there is no time to save", () => {
    expect(executionTimerElapsed(null)).toBeNull();
    expect(executionTimerElapsed(KEY)).toBeNull();
    enterExecutionTimer(KEY);
    vi.advanceTimersByTime(2_000);
    expect(executionTimerElapsed(KEY)).toBe(2);
  });

  it("starts over from zero after a result when the case is still open", () => {
    enterExecutionTimer(KEY);
    vi.advanceTimersByTime(20_000);
    consumeExecutionTimer(KEY);
    vi.advanceTimersByTime(3_000);
    expect(readExecutionTimer(KEY)).toBe(3);
  });

  it("drops the timer after a result when the case is no longer open", () => {
    enterExecutionTimer(KEY);
    vi.advanceTimersByTime(20_000);
    leaveExecutionTimer(KEY);
    consumeExecutionTimer(KEY);
    expect(readExecutionTimer(KEY)).toBe(0);
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("survives a reload within the tab", () => {
    enterExecutionTimer(KEY);
    vi.advanceTimersByTime(15_000);
    window.dispatchEvent(new Event("pagehide"));

    resetExecutionTimersForTest(); // the page loads again
    expect(readExecutionTimer(KEY)).toBe(15);
    enterExecutionTimer(KEY);
    vi.advanceTimersByTime(5_000);
    expect(readExecutionTimer(KEY)).toBe(20);
  });

  it("drops a stored timer that is more than a day old", () => {
    enterExecutionTimer(KEY);
    vi.advanceTimersByTime(15_000);
    leaveExecutionTimer(KEY);

    resetExecutionTimersForTest();
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);
    expect(readExecutionTimer(KEY)).toBe(0);
  });

  it("ignores storage it cannot read", () => {
    window.sessionStorage.setItem(STORAGE_KEY, "{not json");
    expect(readExecutionTimer(KEY)).toBe(0);
  });

  describe("useExecutionTimer", () => {
    it("times the case while mounted and redraws each second", () => {
      const { result, unmount } = renderHook(() => useExecutionTimer(KEY));
      expect(result.current).toMatchObject({
        tracking: true,
        running: true,
        seconds: 0,
      });

      act(() => {
        vi.advanceTimersByTime(3_000);
      });
      expect(result.current.seconds).toBe(3);

      act(() => result.current.pause());
      expect(result.current.running).toBe(false);
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(result.current.seconds).toBe(3);

      act(() => result.current.set(75));
      expect(result.current.seconds).toBe(75);

      act(() => result.current.resume());
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(result.current.seconds).toBe(77);

      unmount();
      vi.advanceTimersByTime(10_000);
      expect(readExecutionTimer(KEY)).toBe(77);
    });

    it("times nothing without a key", () => {
      const { result } = renderHook(() => useExecutionTimer(null));
      act(() => {
        vi.advanceTimersByTime(3_000);
      });
      expect(result.current).toMatchObject({
        tracking: false,
        running: false,
        seconds: 0,
      });
    });

    it("moves to the next case's timer when the key changes", () => {
      const next = executionTimerKey(7, 43);
      const { result, rerender } = renderHook(
        ({ timerKey }) => useExecutionTimer(timerKey),
        { initialProps: { timerKey: KEY } }
      );
      act(() => {
        vi.advanceTimersByTime(6_000);
      });
      rerender({ timerKey: next });
      act(() => {
        vi.advanceTimersByTime(2_000);
      });

      expect(result.current.seconds).toBe(2);
      expect(readExecutionTimer(KEY)).toBe(6);
    });
  });
});
