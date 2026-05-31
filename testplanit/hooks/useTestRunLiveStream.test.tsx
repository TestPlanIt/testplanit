import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestRunLiveStream } from "./useTestRunLiveStream";

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
