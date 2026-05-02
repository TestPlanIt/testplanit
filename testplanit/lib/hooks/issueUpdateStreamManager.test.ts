import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetIssueUpdateStreamsForTests,
  subscribeToProjectIssueUpdates,
} from "./issueUpdateStreamManager";

/**
 * Verifies the refcounted singleton contract. Multiple subscribers for
 * the same project must share a single EventSource; subscribers for
 * different projects must each get their own; releasing the last
 * subscriber for a project must close the connection.
 *
 * Uses a fake EventSource constructor installed on globalThis so we can
 * inspect call counts and trigger onmessage manually.
 */

interface FakeES {
  url: string;
  closed: boolean;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  close: () => void;
  // Test helpers — fire onmessage from outside.
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

beforeEach(() => {
  constructed.length = 0;
  // Install fake. globalThis.EventSource normally only exists in browsers;
  // we attach it for the duration of the test.
  (globalThis as any).EventSource = FakeEventSource as unknown as typeof EventSource;
});

afterEach(() => {
  __resetIssueUpdateStreamsForTests();
  delete (globalThis as any).EventSource;
});

describe("subscribeToProjectIssueUpdates", () => {
  it("opens exactly ONE EventSource per project regardless of subscriber count", () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();

    subscribeToProjectIssueUpdates(7, a);
    subscribeToProjectIssueUpdates(7, b);
    subscribeToProjectIssueUpdates(7, c);

    expect(constructed.length).toBe(1);
    expect(constructed[0]!.url).toBe("/api/issues/stream?projectId=7");
  });

  it("opens distinct EventSources for distinct projectIds", () => {
    subscribeToProjectIssueUpdates(7, vi.fn());
    subscribeToProjectIssueUpdates(8, vi.fn());

    expect(constructed.length).toBe(2);
    expect(constructed[0]!.url).toBe("/api/issues/stream?projectId=7");
    expect(constructed[1]!.url).toBe("/api/issues/stream?projectId=8");
  });

  it("fans an SSE message out to every subscriber for that project", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeToProjectIssueUpdates(7, a);
    subscribeToProjectIssueUpdates(7, b);

    constructed[0]!.__fire('{"event":"issue-updated","issueId":1,"projectId":7}');

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("does NOT fan messages from project 7 out to subscribers of project 8", () => {
    const sevenSub = vi.fn();
    const eightSub = vi.fn();
    subscribeToProjectIssueUpdates(7, sevenSub);
    subscribeToProjectIssueUpdates(8, eightSub);

    constructed[0]!.__fire('{"event":"issue-updated","issueId":1,"projectId":7}');

    expect(sevenSub).toHaveBeenCalledTimes(1);
    expect(eightSub).not.toHaveBeenCalled();
  });

  it("closes the EventSource only when the LAST subscriber unmounts", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeToProjectIssueUpdates(7, a);
    const unsubB = subscribeToProjectIssueUpdates(7, b);

    unsubA();
    expect(constructed[0]!.closed).toBe(false);

    unsubB();
    expect(constructed[0]!.closed).toBe(true);
  });

  it("starts a fresh EventSource when a new subscriber arrives after the previous one was released", () => {
    const a = vi.fn();
    const unsubA = subscribeToProjectIssueUpdates(7, a);
    unsubA();
    expect(constructed[0]!.closed).toBe(true);

    subscribeToProjectIssueUpdates(7, vi.fn());
    expect(constructed.length).toBe(2);
    expect(constructed[1]!.closed).toBe(false);
  });

  it("returns a no-op unsubscribe for invalid projectIds (no EventSource opened)", () => {
    const unsub = subscribeToProjectIssueUpdates(0, vi.fn());
    expect(constructed.length).toBe(0);
    expect(() => unsub()).not.toThrow();

    const unsubNeg = subscribeToProjectIssueUpdates(-3, vi.fn());
    expect(constructed.length).toBe(0);
    expect(() => unsubNeg()).not.toThrow();
  });

  it("a listener throwing does NOT prevent other listeners from being called", () => {
    const bad = vi.fn(() => {
      throw new Error("listener crashed");
    });
    const good = vi.fn();
    subscribeToProjectIssueUpdates(7, bad);
    subscribeToProjectIssueUpdates(7, good);

    constructed[0]!.__fire('{"event":"issue-updated","issueId":42}');

    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("ignores the server's `{event:'sync'}` connection handshake (no issueId) — prevents thundering-herd loops", async () => {
    const listener = vi.fn();
    subscribeToProjectIssueUpdates(7, listener);

    // Server's first-byte sync envelope after subscribe completes.
    constructed[0]!.__fire('{"event":"sync"}');

    expect(listener).not.toHaveBeenCalled();

    // Real update with issueId still fans out.
    constructed[0]!.__fire(
      '{"event":"issue-updated","issueId":1,"projectId":7}'
    );
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("ignores malformed JSON without throwing", () => {
    const listener = vi.fn();
    subscribeToProjectIssueUpdates(7, listener);

    expect(() => constructed[0]!.__fire("not json {[")).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });
});
