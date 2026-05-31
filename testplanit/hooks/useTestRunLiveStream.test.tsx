import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useProjectTestRunStream,
  useTestRunLiveStream,
} from "./useTestRunLiveStream";

interface MockEventSource {
  url: string;
  onmessage: ((msg: MessageEvent) => void) | null;
  onerror: ((err: Event) => void) | null;
  close: ReturnType<typeof vi.fn>;
}

const created: MockEventSource[] = [];
const OriginalEventSource = globalThis.EventSource;

beforeEach(() => {
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
  (globalThis as { EventSource: unknown }).EventSource =
    OriginalEventSource as unknown;
});

describe("useTestRunLiveStream", () => {
  it("opens an EventSource on the right URL for a valid runId", () => {
    const onWakeUp = vi.fn();
    renderHook(() => useTestRunLiveStream({ runId: 42, onWakeUp }));
    expect(created).toHaveLength(1);
    expect(created[0]!.url).toBe("/api/test-runs/42/stream");
  });

  it("does not open a stream when disabled", () => {
    renderHook(() =>
      useTestRunLiveStream({ runId: 42, enabled: false, onWakeUp: vi.fn() })
    );
    expect(created).toHaveLength(0);
  });

  it("does not open a stream for a null or zero runId", () => {
    renderHook(() => useTestRunLiveStream({ runId: null, onWakeUp: vi.fn() }));
    expect(created).toHaveLength(0);
    renderHook(() => useTestRunLiveStream({ runId: 0, onWakeUp: vi.fn() }));
    expect(created).toHaveLength(0);
  });

  it("invokes onWakeUp with the parsed payload on each message", () => {
    const onWakeUp = vi.fn();
    renderHook(() => useTestRunLiveStream({ runId: 7, onWakeUp }));
    const es = created[0]!;
    es.onmessage!({
      data: '{"event":"test_run.result_added","runId":7,"targetId":99}',
    } as MessageEvent);
    expect(onWakeUp).toHaveBeenCalledWith({
      event: "test_run.result_added",
      runId: 7,
      targetId: 99,
    });
  });

  it("swallows malformed payloads without throwing", () => {
    const onWakeUp = vi.fn();
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderHook(() => useTestRunLiveStream({ runId: 7, onWakeUp }));
    const es = created[0]!;
    es.onmessage!({ data: "not-json" } as MessageEvent);
    expect(onWakeUp).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() =>
      useTestRunLiveStream({ runId: 7, onWakeUp: vi.fn() })
    );
    const es = created[0]!;
    unmount();
    expect(es.close).toHaveBeenCalled();
  });

  it("recreates the EventSource when runId changes", () => {
    const onWakeUp = vi.fn();
    const { rerender } = renderHook(
      (args: { runId: number }) =>
        useTestRunLiveStream({ runId: args.runId, onWakeUp }),
      { initialProps: { runId: 1 } }
    );
    expect(created).toHaveLength(1);
    expect(created[0]!.url).toBe("/api/test-runs/1/stream");
    rerender({ runId: 2 });
    expect(created).toHaveLength(2);
    expect(created[0]!.close).toHaveBeenCalled();
    expect(created[1]!.url).toBe("/api/test-runs/2/stream");
  });
});

describe("useProjectTestRunStream", () => {
  it("opens a single EventSource on the project-stream URL", () => {
    renderHook(() =>
      useProjectTestRunStream({ projectId: 293, onWakeUp: vi.fn() })
    );
    expect(created).toHaveLength(1);
    expect(created[0]!.url).toBe("/api/projects/293/test-runs/stream");
  });

  it("does not open the stream when disabled", () => {
    renderHook(() =>
      useProjectTestRunStream({
        projectId: 1,
        enabled: false,
        onWakeUp: vi.fn(),
      })
    );
    expect(created).toHaveLength(0);
  });

  it("does not open the stream for a null/zero/negative projectId", () => {
    renderHook(() =>
      useProjectTestRunStream({ projectId: null, onWakeUp: vi.fn() })
    );
    expect(created).toHaveLength(0);
    renderHook(() =>
      useProjectTestRunStream({ projectId: 0, onWakeUp: vi.fn() })
    );
    expect(created).toHaveLength(0);
    renderHook(() =>
      useProjectTestRunStream({ projectId: -1, onWakeUp: vi.fn() })
    );
    expect(created).toHaveLength(0);
  });

  it("invokes onWakeUp with the parsed payload (including runId) for each message", () => {
    const onWakeUp = vi.fn();
    renderHook(() => useProjectTestRunStream({ projectId: 293, onWakeUp }));
    const es = created[0]!;
    es.onmessage!({
      data: '{"event":"test_run.result_added","runId":18,"projectId":293,"targetId":555}',
    } as MessageEvent);
    es.onmessage!({
      data: '{"event":"test_run.state_changed","runId":19,"projectId":293}',
    } as MessageEvent);
    expect(onWakeUp).toHaveBeenCalledTimes(2);
    expect(onWakeUp).toHaveBeenCalledWith({
      event: "test_run.result_added",
      runId: 18,
      projectId: 293,
      targetId: 555,
    });
    expect(onWakeUp).toHaveBeenCalledWith({
      event: "test_run.state_changed",
      runId: 19,
      projectId: 293,
    });
  });

  it("swallows malformed payloads without throwing", () => {
    const onWakeUp = vi.fn();
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderHook(() => useProjectTestRunStream({ projectId: 1, onWakeUp }));
    created[0]!.onmessage!({ data: "not-json" } as MessageEvent);
    expect(onWakeUp).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("closes the EventSource on unmount", () => {
    const { unmount } = renderHook(() =>
      useProjectTestRunStream({ projectId: 1, onWakeUp: vi.fn() })
    );
    const es = created[0]!;
    unmount();
    expect(es.close).toHaveBeenCalled();
  });

  it("recreates the EventSource when projectId changes", () => {
    const onWakeUp = vi.fn();
    const { rerender } = renderHook(
      (args: { projectId: number }) =>
        useProjectTestRunStream({ projectId: args.projectId, onWakeUp }),
      { initialProps: { projectId: 1 } }
    );
    expect(created).toHaveLength(1);
    expect(created[0]!.url).toBe("/api/projects/1/test-runs/stream");
    rerender({ projectId: 2 });
    expect(created).toHaveLength(2);
    expect(created[0]!.close).toHaveBeenCalled();
    expect(created[1]!.url).toBe("/api/projects/2/test-runs/stream");
  });

  it("does not recreate the connection when onWakeUp identity changes", () => {
    // Regression: invalidate-on-wake-up loops change the callback's
    // identity on every wake-up. Without the latest-ref pattern, every
    // wake-up would close + reopen the EventSource — the exact server
    // thrash this whole refactor is meant to prevent.
    const { rerender } = renderHook(
      (args: { onWakeUp: () => void }) =>
        useProjectTestRunStream({ projectId: 1, onWakeUp: args.onWakeUp }),
      { initialProps: { onWakeUp: vi.fn() } }
    );
    expect(created).toHaveLength(1);
    const closesBefore = created[0]!.close.mock.calls.length;
    rerender({ onWakeUp: vi.fn() });
    expect(created).toHaveLength(1);
    expect(created[0]!.close.mock.calls.length).toBe(closesBefore);
  });

  it("invokes the latest onWakeUp identity, not the one from the original render", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      (args: { onWakeUp: (e: unknown) => void }) =>
        useProjectTestRunStream({
          projectId: 1,
          onWakeUp: args.onWakeUp,
        }),
      { initialProps: { onWakeUp: first as (e: unknown) => void } }
    );
    rerender({ onWakeUp: second as (e: unknown) => void });
    created[0]!.onmessage!({
      data: '{"event":"test_run.result_added","runId":7,"projectId":1}',
    } as MessageEvent);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
