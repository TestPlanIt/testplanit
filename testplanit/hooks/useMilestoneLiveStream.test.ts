import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetMilestoneStreamsForTests,
  useMilestoneLiveStream,
  useProjectMilestoneStream,
} from "./useMilestoneLiveStream";

/**
 * The hook pair shares EventSources through a refcounted registry (one
 * connection per stream URL per window, D-14/D-15): multiple subscribers of
 * the same milestone/project stream — detail page + overflow panel, or
 * StrictMode double-mounts — must never hold more than one connection, and
 * closing is deferred by a short grace period so remount churn reuses the
 * live connection. Per-mount EventSources previously saturated the
 * browser's ~6-connection-per-origin HTTP/1.1 cap across tabs, starving
 * ordinary fetches (the hover Jira-details regression).
 *
 * See: .planning/phases/19-webhooks-lifecycle/19-VALIDATION.md (19-02-T3),
 *      hooks/issueUpdateStreamManager.ts (the pattern being mirrored).
 */

interface MockEventSource {
  url: string;
  onmessage: ((msg: MessageEvent) => void) | null;
  onerror: ((err: Event) => void) | null;
  close: ReturnType<typeof vi.fn>;
}

const created: MockEventSource[] = [];
const OriginalEventSource = globalThis.EventSource;

beforeEach(() => {
  vi.useFakeTimers();
  created.length = 0;
  // Replace with a constructor that records each instance.
  (globalThis as { EventSource: unknown }).EventSource = function (
    url: string
  ) {
    const inst: MockEventSource = {
      url,
      onmessage: null,
      onerror: null,
      close: vi.fn(),
    };
    created.push(inst);
    return inst;
  } as unknown as typeof globalThis.EventSource;
});

afterEach(() => {
  __resetMilestoneStreamsForTests();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  (globalThis as { EventSource: unknown }).EventSource =
    OriginalEventSource as unknown;
});

/** Flush the registry's deferred-close grace window. */
function flushCloseGrace() {
  vi.advanceTimersByTime(300);
}

describe("useMilestoneLiveStream", () => {
  it("opens an EventSource on /api/milestones/{milestoneId}/stream for a valid milestoneId", () => {
    const onWakeUp = vi.fn();
    renderHook(() => useMilestoneLiveStream({ milestoneId: 42, onWakeUp }));
    expect(created).toHaveLength(1);
    expect(created[0]!.url).toBe("/api/milestones/42/stream");
  });

  it("does not open a stream when disabled", () => {
    renderHook(() =>
      useMilestoneLiveStream({
        milestoneId: 42,
        enabled: false,
        onWakeUp: vi.fn(),
      })
    );
    expect(created).toHaveLength(0);
  });

  it("does not open a stream for a null or zero milestoneId", () => {
    renderHook(() =>
      useMilestoneLiveStream({ milestoneId: null, onWakeUp: vi.fn() })
    );
    expect(created).toHaveLength(0);
    renderHook(() =>
      useMilestoneLiveStream({ milestoneId: 0, onWakeUp: vi.fn() })
    );
    expect(created).toHaveLength(0);
  });

  it("invokes onWakeUp with the parsed payload on each message", () => {
    const onWakeUp = vi.fn();
    renderHook(() => useMilestoneLiveStream({ milestoneId: 7, onWakeUp }));
    const es = created[0]!;
    es.onmessage!({
      data: '{"event":"milestone.updated","milestoneId":7,"projectId":3}',
    } as MessageEvent);
    expect(onWakeUp).toHaveBeenCalledWith({
      event: "milestone.updated",
      milestoneId: 7,
      projectId: 3,
    });
  });

  it("swallows malformed (non-JSON) messages without throwing", () => {
    const onWakeUp = vi.fn();
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderHook(() => useMilestoneLiveStream({ milestoneId: 7, onWakeUp }));
    const es = created[0]!;
    es.onmessage!({ data: "not-json" } as MessageEvent);
    expect(onWakeUp).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("SHARES one EventSource across multiple subscribers of the same milestone (detail page + overflow panel, D-14)", () => {
    const a = vi.fn();
    const b = vi.fn();
    renderHook(() => useMilestoneLiveStream({ milestoneId: 7, onWakeUp: a }));
    renderHook(() => useMilestoneLiveStream({ milestoneId: 7, onWakeUp: b }));
    expect(created).toHaveLength(1);
    created[0]!.onmessage!({
      data: '{"event":"milestone.updated","milestoneId":7,"projectId":3}',
    } as MessageEvent);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("keeps the stream open while any subscriber remains, closes after the last unmount (post grace)", () => {
    const first = renderHook(() =>
      useMilestoneLiveStream({ milestoneId: 7, onWakeUp: vi.fn() })
    );
    const second = renderHook(() =>
      useMilestoneLiveStream({ milestoneId: 7, onWakeUp: vi.fn() })
    );
    const es = created[0]!;
    first.unmount();
    flushCloseGrace();
    expect(es.close).not.toHaveBeenCalled();
    second.unmount();
    flushCloseGrace();
    expect(es.close).toHaveBeenCalled();
  });

  it("reuses the live connection across unmount/remount churn within the grace window (StrictMode)", () => {
    const first = renderHook(() =>
      useMilestoneLiveStream({ milestoneId: 7, onWakeUp: vi.fn() })
    );
    first.unmount();
    // Remount immediately — before the grace window elapses.
    renderHook(() =>
      useMilestoneLiveStream({ milestoneId: 7, onWakeUp: vi.fn() })
    );
    flushCloseGrace();
    expect(created).toHaveLength(1);
    expect(created[0]!.close).not.toHaveBeenCalled();
  });

  it("closes the EventSource after unmount once the grace window elapses", () => {
    const { unmount } = renderHook(() =>
      useMilestoneLiveStream({ milestoneId: 7, onWakeUp: vi.fn() })
    );
    const es = created[0]!;
    unmount();
    expect(es.close).not.toHaveBeenCalled(); // deferred
    flushCloseGrace();
    expect(es.close).toHaveBeenCalled();
  });

  it("recreates the EventSource when milestoneId changes", () => {
    const onWakeUp = vi.fn();
    const { rerender } = renderHook(
      (args: { milestoneId: number }) =>
        useMilestoneLiveStream({ milestoneId: args.milestoneId, onWakeUp }),
      { initialProps: { milestoneId: 1 } }
    );
    expect(created).toHaveLength(1);
    expect(created[0]!.url).toBe("/api/milestones/1/stream");
    rerender({ milestoneId: 2 });
    expect(created).toHaveLength(2);
    expect(created[1]!.url).toBe("/api/milestones/2/stream");
    flushCloseGrace();
    expect(created[0]!.close).toHaveBeenCalled();
  });

  it("does not recreate the connection when onWakeUp identity changes (latest-ref pattern)", () => {
    const { rerender } = renderHook(
      (args: { onWakeUp: () => void }) =>
        useMilestoneLiveStream({ milestoneId: 1, onWakeUp: args.onWakeUp }),
      { initialProps: { onWakeUp: vi.fn() } }
    );
    expect(created).toHaveLength(1);
    const closesBefore = created[0]!.close.mock.calls.length;
    rerender({ onWakeUp: vi.fn() });
    expect(created).toHaveLength(1);
    expect(created[0]!.close.mock.calls.length).toBe(closesBefore);
  });
});

describe("useProjectMilestoneStream", () => {
  it("opens a single EventSource on /api/projects/{projectId}/milestones/stream", () => {
    renderHook(() =>
      useProjectMilestoneStream({ projectId: 293, onWakeUp: vi.fn() })
    );
    expect(created).toHaveLength(1);
    expect(created[0]!.url).toBe("/api/projects/293/milestones/stream");
  });

  it("does not open the stream when disabled", () => {
    renderHook(() =>
      useProjectMilestoneStream({
        projectId: 1,
        enabled: false,
        onWakeUp: vi.fn(),
      })
    );
    expect(created).toHaveLength(0);
  });

  it("does not open the stream for a null/zero/negative projectId", () => {
    renderHook(() =>
      useProjectMilestoneStream({ projectId: null, onWakeUp: vi.fn() })
    );
    expect(created).toHaveLength(0);
    renderHook(() =>
      useProjectMilestoneStream({ projectId: 0, onWakeUp: vi.fn() })
    );
    expect(created).toHaveLength(0);
    renderHook(() =>
      useProjectMilestoneStream({ projectId: -1, onWakeUp: vi.fn() })
    );
    expect(created).toHaveLength(0);
  });

  it("invokes onWakeUp with the parsed payload (including milestoneId) for each message", () => {
    const onWakeUp = vi.fn();
    renderHook(() => useProjectMilestoneStream({ projectId: 293, onWakeUp }));
    const es = created[0]!;
    es.onmessage!({
      data: '{"event":"milestone.updated","milestoneId":18,"projectId":293,"targetId":555}',
    } as MessageEvent);
    es.onmessage!({
      data: '{"event":"milestone.membership_changed","milestoneId":19,"projectId":293}',
    } as MessageEvent);
    expect(onWakeUp).toHaveBeenCalledTimes(2);
    expect(onWakeUp).toHaveBeenCalledWith({
      event: "milestone.updated",
      milestoneId: 18,
      projectId: 293,
      targetId: 555,
    });
    expect(onWakeUp).toHaveBeenCalledWith({
      event: "milestone.membership_changed",
      milestoneId: 19,
      projectId: 293,
    });
  });

  it("swallows malformed (non-JSON) messages without throwing", () => {
    const onWakeUp = vi.fn();
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderHook(() => useProjectMilestoneStream({ projectId: 1, onWakeUp }));
    created[0]!.onmessage!({ data: "not-json" } as MessageEvent);
    expect(onWakeUp).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("SHARES one EventSource across multiple subscribers of the same project", () => {
    renderHook(() =>
      useProjectMilestoneStream({ projectId: 5, onWakeUp: vi.fn() })
    );
    renderHook(() =>
      useProjectMilestoneStream({ projectId: 5, onWakeUp: vi.fn() })
    );
    expect(created).toHaveLength(1);
  });

  it("closes the EventSource after unmount once the grace window elapses", () => {
    const { unmount } = renderHook(() =>
      useProjectMilestoneStream({ projectId: 1, onWakeUp: vi.fn() })
    );
    const es = created[0]!;
    unmount();
    expect(es.close).not.toHaveBeenCalled(); // deferred
    flushCloseGrace();
    expect(es.close).toHaveBeenCalled();
  });

  it("recreates the EventSource when projectId changes", () => {
    const onWakeUp = vi.fn();
    const { rerender } = renderHook(
      (args: { projectId: number }) =>
        useProjectMilestoneStream({ projectId: args.projectId, onWakeUp }),
      { initialProps: { projectId: 1 } }
    );
    expect(created).toHaveLength(1);
    expect(created[0]!.url).toBe("/api/projects/1/milestones/stream");
    rerender({ projectId: 2 });
    expect(created).toHaveLength(2);
    expect(created[1]!.url).toBe("/api/projects/2/milestones/stream");
    flushCloseGrace();
    expect(created[0]!.close).toHaveBeenCalled();
  });

  it("does not recreate the connection when onWakeUp identity changes (latest-ref pattern)", () => {
    // Regression: invalidate-on-wake-up loops change the callback's
    // identity on every wake-up. Without the latest-ref pattern, every
    // wake-up would resubscribe — the exact thrash this pattern prevents.
    const { rerender } = renderHook(
      (args: { onWakeUp: () => void }) =>
        useProjectMilestoneStream({ projectId: 1, onWakeUp: args.onWakeUp }),
      { initialProps: { onWakeUp: vi.fn() } }
    );
    expect(created).toHaveLength(1);
    const closesBefore = created[0]!.close.mock.calls.length;
    rerender({ onWakeUp: vi.fn() });
    expect(created).toHaveLength(1);
    expect(created[0]!.close.mock.calls.length).toBe(closesBefore);
  });

  // D-15: all milestone surfaces (list cards, detail fields/badge/member
  // table/coverage, import picker) subscribe via this SAME hook pair —
  // the only additional export is the test-only registry reset.
  it("is the single shared hook pair for all milestone live-update surfaces — no bespoke third variant per D-15", async () => {
    const moduleExports = await import("./useMilestoneLiveStream");
    expect(Object.keys(moduleExports).sort()).toEqual(
      [
        "__resetMilestoneStreamsForTests",
        "useMilestoneLiveStream",
        "useProjectMilestoneStream",
      ].sort()
    );
  });
});
