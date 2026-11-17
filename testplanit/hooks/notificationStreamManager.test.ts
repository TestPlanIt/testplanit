import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetNotificationStreamForTests,
  subscribeToNotificationStream,
} from "./notificationStreamManager";

/**
 * Verifies the shared-stream contract: every subscriber on the page shares
 * ONE EventSource to /api/notifications/stream (opened by the first, closed
 * by the last); every parsed message reaches every listener; and a server
 * `superseded` event closes the stream for good until the tab is looked at
 * again — the browser must not auto-reconnect into the eviction loop.
 *
 * A fake EventSource on globalThis lets us inspect connections and fire
 * messages / named events manually. The shared vitest setup makes
 * requestIdleCallback synchronous, so the deferred wrapper connects at once.
 */

interface FakeES {
  url: string;
  closed: boolean;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  close: () => void;
  __fire: (data: string) => void;
  __fireNamed: (type: string) => void;
}

const constructed: FakeES[] = [];

class FakeEventSource implements Pick<EventSource, "close"> {
  url: string;
  closed = false;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  private named: Map<string, Set<(ev: MessageEvent) => void>> = new Map();
  constructor(url: string) {
    this.url = url;
    const self = this as unknown as FakeES;
    self.__fire = (data: string) => {
      if (this.onmessage) this.onmessage({ data } as MessageEvent);
    };
    self.__fireNamed = (type: string) => {
      for (const l of this.named.get(type) ?? []) {
        l({ data: "{}" } as MessageEvent);
      }
    };
    constructed.push(self);
  }
  addEventListener(type: string, listener: (ev: MessageEvent) => void) {
    let set = this.named.get(type);
    if (!set) {
      set = new Set();
      this.named.set(type, set);
    }
    set.add(listener);
  }
  close() {
    this.closed = true;
  }
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  constructed.length = 0;
  (globalThis as any).EventSource =
    FakeEventSource as unknown as typeof EventSource;
  setVisibility("visible");
});

afterEach(() => {
  __resetNotificationStreamForTests();
  delete (globalThis as any).EventSource;
});

const openStreams = () => constructed.filter((es) => !es.closed);
const latestOpen = () => openStreams().at(-1)!;

describe("subscribeToNotificationStream (shared)", () => {
  it("opens ONE EventSource for many subscribers", () => {
    subscribeToNotificationStream(vi.fn());
    subscribeToNotificationStream(vi.fn());
    subscribeToNotificationStream(vi.fn());

    expect(constructed.length).toBe(1);
    expect(latestOpen().url).toBe("/api/notifications/stream");
  });

  it("closes the connection only when the last subscriber leaves", () => {
    const unsubA = subscribeToNotificationStream(vi.fn());
    const unsubB = subscribeToNotificationStream(vi.fn());
    const es = latestOpen();

    unsubA();
    expect(es.closed).toBe(false);

    unsubB();
    expect(es.closed).toBe(true);
    expect(openStreams().length).toBe(0);
  });

  it("delivers every parsed message to every listener", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeToNotificationStream(a);
    subscribeToNotificationStream(b);

    latestOpen().__fire('{"event":"sync"}');
    latestOpen().__fire('{"id":"n1","event":"REVIEW_REQUESTED"}');

    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenLastCalledWith({ id: "n1", event: "REVIEW_REQUESTED" });
  });

  it("ignores malformed JSON without throwing", () => {
    const listener = vi.fn();
    subscribeToNotificationStream(listener);

    expect(() => latestOpen().__fire("not json {[")).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it("a throwing listener does not prevent others from being called", () => {
    const bad = vi.fn(() => {
      throw new Error("listener crashed");
    });
    const good = vi.fn();
    subscribeToNotificationStream(bad);
    subscribeToNotificationStream(good);

    latestOpen().__fire('{"event":"sync"}');

    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("`superseded` closes the stream and does NOT reopen it while subscribers remain", () => {
    subscribeToNotificationStream(vi.fn());
    const es = latestOpen();

    es.__fireNamed("superseded");

    expect(es.closed).toBe(true);
    // Dormant: nothing reconnects, and a new subscriber joins the dormant
    // state rather than opening a fresh connection.
    subscribeToNotificationStream(vi.fn());
    expect(constructed.length).toBe(1);
  });

  it("reopens a superseded stream when the tab becomes visible again", () => {
    const listener = vi.fn();
    subscribeToNotificationStream(listener);
    latestOpen().__fireNamed("superseded");
    expect(openStreams().length).toBe(0);

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(openStreams().length).toBe(0); // still hidden — stay dormant

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(openStreams().length).toBe(1);
    expect(constructed.length).toBe(2);

    // The new connection's sync reaches the surviving listener.
    latestOpen().__fire('{"event":"sync"}');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reopens a superseded stream on window focus", () => {
    subscribeToNotificationStream(vi.fn());
    latestOpen().__fireNamed("superseded");

    window.dispatchEvent(new Event("focus"));
    expect(openStreams().length).toBe(1);
  });

  it("does not reopen a superseded stream once every subscriber has left", () => {
    const unsub = subscribeToNotificationStream(vi.fn());
    latestOpen().__fireNamed("superseded");
    unsub();

    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(constructed.length).toBe(1);
  });

  it("a stale `superseded` from an already-replaced connection is ignored", () => {
    subscribeToNotificationStream(vi.fn());
    const first = latestOpen();
    first.__fireNamed("superseded");
    window.dispatchEvent(new Event("focus"));
    const second = latestOpen();

    first.__fireNamed("superseded"); // late event from the dead connection
    expect(second.closed).toBe(false);
  });

  it("idempotent unsubscribe does not close a stream another subscriber holds", () => {
    const unsubA = subscribeToNotificationStream(vi.fn());
    subscribeToNotificationStream(vi.fn());
    const es = latestOpen();

    unsubA();
    unsubA();

    expect(es.closed).toBe(false);
  });

  it("returns a no-op unsubscribe when EventSource is unavailable", () => {
    delete (globalThis as any).EventSource;
    const unsub = subscribeToNotificationStream(vi.fn());

    expect(constructed.length).toBe(0);
    expect(() => unsub()).not.toThrow();
  });
});
