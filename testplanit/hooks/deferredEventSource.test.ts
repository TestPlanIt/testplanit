import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeferredEventSource } from "./deferredEventSource";

interface MockES {
  url: string;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  close: ReturnType<typeof vi.fn>;
}

const created: MockES[] = [];
const OriginalEventSource = globalThis.EventSource;
// The shared vitest setup installs a synchronous requestIdleCallback so the
// stream hooks' tests connect without plumbing timers. Here we swap in a
// controllable scheduler so we can assert the DEFERRAL itself, then restore it.
const originalRIC = (globalThis as Record<string, unknown>).requestIdleCallback;
const originalCIC = (globalThis as Record<string, unknown>).cancelIdleCallback;

let idleQueue: Array<() => void>;
let cancelled: Set<number>;

beforeEach(() => {
  created.length = 0;
  idleQueue = [];
  cancelled = new Set();

  (globalThis as { EventSource: unknown }).EventSource = function (
    url: string
  ) {
    const inst: MockES = {
      url,
      onmessage: null,
      onerror: null,
      close: vi.fn(),
    };
    created.push(inst);
    return inst;
  } as unknown as typeof globalThis.EventSource;

  let handle = 0;
  (globalThis as Record<string, unknown>).requestIdleCallback = (
    cb: () => void
  ) => {
    const id = ++handle;
    idleQueue.push(() => {
      if (!cancelled.has(id)) cb();
    });
    return id;
  };
  (globalThis as Record<string, unknown>).cancelIdleCallback = (id: number) => {
    cancelled.add(id);
  };
});

afterEach(() => {
  (globalThis as { EventSource: unknown }).EventSource =
    OriginalEventSource as unknown;
  (globalThis as Record<string, unknown>).requestIdleCallback = originalRIC;
  (globalThis as Record<string, unknown>).cancelIdleCallback = originalCIC;
});

/** Run every idle callback recorded so far (the browser going idle). */
function flushIdle() {
  const q = idleQueue;
  idleQueue = [];
  for (const run of q) run();
}

describe("createDeferredEventSource", () => {
  it("does not open the connection until the browser is idle", () => {
    createDeferredEventSource("/api/x/stream");
    expect(created).toHaveLength(0);
    flushIdle();
    expect(created).toHaveLength(1);
    expect(created[0]!.url).toBe("/api/x/stream");
  });

  it("routes messages to a handler assigned before the connection opened", () => {
    const src = createDeferredEventSource("/api/x/stream");
    const onMsg = vi.fn();
    src.onmessage = onMsg;
    flushIdle();
    const ev = { data: "hi" } as MessageEvent;
    created[0]!.onmessage!(ev);
    expect(onMsg).toHaveBeenCalledWith(ev);
  });

  it("routes errors to a handler assigned after the connection opened", () => {
    const src = createDeferredEventSource("/api/x/stream");
    flushIdle();
    const onErr = vi.fn();
    src.onerror = onErr;
    const ev = new Event("error");
    created[0]!.onerror!(ev);
    expect(onErr).toHaveBeenCalledWith(ev);
  });

  it("cancels the pending open when closed before idle — never connects", () => {
    const src = createDeferredEventSource("/api/x/stream");
    src.close();
    flushIdle();
    expect(created).toHaveLength(0);
  });

  it("closes the underlying connection when closed after it opened", () => {
    const src = createDeferredEventSource("/api/x/stream");
    flushIdle();
    expect(created).toHaveLength(1);
    src.close();
    expect(created[0]!.close).toHaveBeenCalled();
  });

  it("falls back to setTimeout when requestIdleCallback is unavailable", () => {
    vi.useFakeTimers();
    (globalThis as Record<string, unknown>).requestIdleCallback = undefined;
    try {
      createDeferredEventSource("/api/x/stream");
      expect(created).toHaveLength(0);
      vi.advanceTimersByTime(1000);
      expect(created).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
