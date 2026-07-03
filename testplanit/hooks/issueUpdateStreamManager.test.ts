import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetIssueUpdateStreamsForTests,
  subscribeToIssueUpdates,
} from "./issueUpdateStreamManager";

/**
 * Verifies the multiplexed singleton contract: ONE EventSource carries the
 * union of every watched project (so a cross-project list opens one stream,
 * not one per project); the connection reconnects when the union changes and
 * closes when the last subscriber leaves; messages route to the listeners for
 * the event's projectId.
 *
 * Reconciliation is debounced, so tests use fake timers and flush after each
 * (un)subscribe. A fake EventSource on globalThis lets us inspect connections
 * and fire messages manually.
 */

interface FakeES {
  url: string;
  closed: boolean;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  close: () => void;
  __fire: (data: string) => void;
}

const constructed: FakeES[] = [];

class FakeEventSource implements Pick<EventSource, "close"> {
  url: string;
  closed = false;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    const self = this as unknown as FakeES;
    self.__fire = (data: string) => {
      if (this.onmessage) this.onmessage({ data } as MessageEvent);
    };
    constructed.push(self);
  }
  close() {
    this.closed = true;
  }
}

// Flush the debounced reconcile.
function flush() {
  vi.runOnlyPendingTimers();
}

beforeEach(() => {
  vi.useFakeTimers();
  constructed.length = 0;
  (globalThis as any).EventSource =
    FakeEventSource as unknown as typeof EventSource;
});

afterEach(() => {
  __resetIssueUpdateStreamsForTests();
  delete (globalThis as any).EventSource;
  vi.useRealTimers();
});

const openStreams = () => constructed.filter((es) => !es.closed);
const latestOpen = () => openStreams().at(-1)!;

describe("subscribeToIssueUpdates (multiplexed)", () => {
  it("opens ONE EventSource for many subscribers in the same project", () => {
    subscribeToIssueUpdates(7, vi.fn());
    subscribeToIssueUpdates(7, vi.fn());
    subscribeToIssueUpdates(7, vi.fn());
    flush();

    expect(openStreams().length).toBe(1);
    expect(latestOpen().url).toBe("/api/issues/stream?projectIds=7");
  });

  it("multiplexes distinct projects into ONE connection over their union", () => {
    subscribeToIssueUpdates(7, vi.fn());
    subscribeToIssueUpdates(8, vi.fn());
    subscribeToIssueUpdates([9, 8], vi.fn());
    flush();

    expect(openStreams().length).toBe(1);
    // Sorted, deduped union.
    expect(latestOpen().url).toBe("/api/issues/stream?projectIds=7,8,9");
  });

  it("batches a single commit's subscribes into one connection (no per-project storm)", () => {
    // 15 badges across 15 projects mounting together.
    for (let p = 1; p <= 15; p++) subscribeToIssueUpdates(p, vi.fn());
    flush();

    expect(constructed.length).toBe(1);
    expect(latestOpen().url).toBe(
      "/api/issues/stream?projectIds=1,2,3,4,5,6,7,8,9,10,11,12,13,14,15"
    );
  });

  it("reconnects with the new union when a fresh project is added", () => {
    subscribeToIssueUpdates(7, vi.fn());
    flush();
    expect(latestOpen().url).toBe("/api/issues/stream?projectIds=7");

    subscribeToIssueUpdates(8, vi.fn());
    flush();

    // Old connection closed, new one covers the union.
    expect(constructed.length).toBe(2);
    expect(constructed[0]!.closed).toBe(true);
    expect(latestOpen().url).toBe("/api/issues/stream?projectIds=7,8");
  });

  it("routes a message to the listeners for its projectId only", () => {
    const sevenA = vi.fn();
    const sevenB = vi.fn();
    const eight = vi.fn();
    subscribeToIssueUpdates(7, sevenA);
    subscribeToIssueUpdates(7, sevenB);
    subscribeToIssueUpdates(8, eight);
    flush();

    latestOpen().__fire('{"event":"issue-updated","issueId":1,"projectId":7}');

    expect(sevenA).toHaveBeenCalledTimes(1);
    expect(sevenB).toHaveBeenCalledTimes(1);
    expect(eight).not.toHaveBeenCalled();
  });

  it("does not reconnect when the union is unchanged (extra subscriber same project)", () => {
    subscribeToIssueUpdates(7, vi.fn());
    flush();
    const first = latestOpen();

    subscribeToIssueUpdates(7, vi.fn());
    flush();

    expect(openStreams().length).toBe(1);
    expect(latestOpen()).toBe(first);
    expect(first.closed).toBe(false);
  });

  it("closes the connection when the last subscriber for every project leaves", () => {
    const unsubA = subscribeToIssueUpdates(7, vi.fn());
    const unsubB = subscribeToIssueUpdates(7, vi.fn());
    flush();
    const es = latestOpen();

    unsubA();
    flush();
    expect(es.closed).toBe(false); // one subscriber remains

    unsubB();
    flush();
    expect(es.closed).toBe(true);
    expect(openStreams().length).toBe(0);
  });

  it("returns a no-op unsubscribe for invalid ids (no connection opened)", () => {
    const unsub = subscribeToIssueUpdates(0, vi.fn());
    const unsubNeg = subscribeToIssueUpdates(-3, vi.fn());
    const unsubEmpty = subscribeToIssueUpdates([], vi.fn());
    flush();

    expect(constructed.length).toBe(0);
    expect(() => {
      unsub();
      unsubNeg();
      unsubEmpty();
    }).not.toThrow();
  });

  it("a throwing listener does not prevent others from being called", () => {
    const bad = vi.fn(() => {
      throw new Error("listener crashed");
    });
    const good = vi.fn();
    subscribeToIssueUpdates(7, bad);
    subscribeToIssueUpdates(7, good);
    flush();

    latestOpen().__fire('{"event":"issue-updated","issueId":42,"projectId":7}');

    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("ignores the `{event:'sync'}` handshake (no issueId) — prevents herd loops", () => {
    const listener = vi.fn();
    subscribeToIssueUpdates(7, listener);
    flush();

    latestOpen().__fire('{"event":"sync"}');
    expect(listener).not.toHaveBeenCalled();

    latestOpen().__fire('{"event":"issue-updated","issueId":1,"projectId":7}');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("ignores malformed JSON without throwing", () => {
    const listener = vi.fn();
    subscribeToIssueUpdates(7, listener);
    flush();

    expect(() => latestOpen().__fire("not json {[")).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it("idempotent unsubscribe does not double-decrement the refcount", () => {
    const unsubA = subscribeToIssueUpdates(7, vi.fn());
    subscribeToIssueUpdates(7, vi.fn());
    flush();
    const es = latestOpen();

    unsubA();
    unsubA(); // second call must be a no-op
    flush();

    // The other subscriber still holds project 7 open.
    expect(es.closed).toBe(false);
  });
});
