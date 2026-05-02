"use client";

/**
 * Refcounted singleton EventSource manager for the project-scoped
 * issue-update SSE stream.
 *
 * Components anywhere in the tree (issue badges, lists, popovers,
 * detail views) call `subscribeToProjectIssueUpdates(projectId, fn)`
 * to register interest in updates for a project. Multiple subscribers
 * for the same projectId share a single EventSource — the SSE route's
 * per-user connection cap (default 8) bounds simultaneously-watched
 * PROJECTS, not number of subscribers.
 *
 * Lifecycle:
 *   - First subscriber for a project → opens the EventSource.
 *   - Each subsequent subscriber → registered as a listener; no new
 *     network connection.
 *   - Last subscriber unmounts → closes the EventSource and forgets
 *     the entry so the next subscriber starts fresh.
 *
 * SSR-safe: returns a no-op unsubscribe when window/EventSource are
 * unavailable (server-render, jsdom test envs without polyfill, etc.).
 */

type IssueUpdateListener = () => void;

interface StreamEntry {
  es: EventSource;
  listeners: Set<IssueUpdateListener>;
}

const streams: Map<number, StreamEntry> = new Map();

export function subscribeToProjectIssueUpdates(
  projectId: number,
  onUpdate: IssueUpdateListener
): () => void {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    return () => undefined;
  }
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return () => undefined;
  }

  let entry = streams.get(projectId);
  if (!entry) {
    const es = new EventSource(
      `/api/issues/stream?projectId=${projectId}`
    );
    const created: StreamEntry = { es, listeners: new Set() };
    es.onmessage = () => {
      // Snapshot the listener set so a listener that triggers another
      // subscribe/unsubscribe (e.g., re-renders that re-mount badges)
      // doesn't mutate what we're iterating.
      for (const listener of [...created.listeners]) {
        try {
          listener();
        } catch (err) {
          console.warn(
            "[issueUpdateStreamManager] listener threw",
            err
          );
        }
      }
    };
    es.onerror = (err) => {
      // EventSource auto-reconnects on transport drops. Log for
      // visibility but don't surface — the server's `{event:"sync"}`
      // first byte after subscribe ensures listeners refetch on
      // reconnect and catch anything missed.
      console.warn(
        `[issueUpdateStreamManager] SSE transport error for project ${projectId}`,
        err
      );
    };
    streams.set(projectId, created);
    entry = created;
  }
  entry.listeners.add(onUpdate);

  return () => {
    const current = streams.get(projectId);
    if (!current) return;
    current.listeners.delete(onUpdate);
    if (current.listeners.size === 0) {
      current.es.close();
      streams.delete(projectId);
    }
  };
}

/**
 * Test-only: drop all active subscriptions and connections. Used by
 * the unit suite's `beforeEach` so each test starts with an empty
 * registry. Production code never calls this.
 */
export function __resetIssueUpdateStreamsForTests(): void {
  for (const entry of streams.values()) {
    try {
      entry.es.close();
    } catch {
      /* swallow */
    }
  }
  streams.clear();
}
