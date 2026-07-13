"use client";

/**
 * Single multiplexed EventSource for issue-update SSE across ALL watched
 * projects.
 *
 * Every subscriber registers the set of project ids it cares about; the
 * manager keeps ONE connection subscribed to the union of those ids
 * (`/api/issues/stream?projectIds=<csv>`) and reconnects only when that union
 * changes. Reconciliation is debounced so a page whose badges mount in a
 * single commit (e.g. a 25-row issues list spanning 15 projects) collapses to
 * ONE connection rather than one per project.
 *
 * This replaces the previous one-EventSource-per-project model. That model
 * stormed on cross-project list pages (global `/issues`, `/admin/issues`):
 * the client opened more connections than the SSE route's per-user cap (8),
 * the server LRU-closed the overflow, `EventSource` auto-reconnected on the
 * drop, the server closed another to make room, and the cycle span up a fresh
 * IORedis subscriber on every reconnect — ballooning server memory until the
 * whole dev process wedged.
 *
 * Messages carry `{event, issueId, projectId}`; the manager routes each to the
 * listeners that registered interest in that `projectId`.
 *
 * SSR-safe: returns a no-op unsubscribe when window/EventSource are
 * unavailable (server render, jsdom without polyfill).
 */

import {
  createDeferredEventSource,
  type DeferredEventSource,
} from "./deferredEventSource";

type IssueUpdateListener = () => void;

// How many active subscribers currently watch each project id.
const projectRefCounts: Map<number, number> = new Map();
// Listeners registered per project id (a subscriber appears under each id it
// passed). Message routing keys on the event's projectId.
const listenersByProject: Map<number, Set<IssueUpdateListener>> = new Map();

let es: DeferredEventSource | null = null;
// Sorted csv of the project ids the current `es` is subscribed to ("" = none).
let connectedKey = "";
let reconcileHandle: ReturnType<typeof setTimeout> | null = null;

// Debounce window. Long enough to batch a page's worth of badge mounts (and to
// coalesce the mount/unmount churn of a future virtualized list) into a single
// reconnect; short enough that live updates start flowing promptly.
const RECONCILE_DEBOUNCE_MS = 250;

function unionKey(): string {
  const ids: number[] = [];
  for (const [id, rc] of projectRefCounts) {
    if (rc > 0) ids.push(id);
  }
  ids.sort((a, b) => a - b);
  return ids.join(",");
}

function callListener(listener: IssueUpdateListener) {
  try {
    listener();
  } catch (err) {
    console.warn("[issueUpdateStreamManager] listener threw", err);
  }
}

function notify(projectId: number | undefined) {
  // Snapshot each listener set — a listener may trigger a subscribe/unsubscribe
  // (re-mounting badges) that mutates the set mid-iteration.
  if (typeof projectId === "number") {
    const set = listenersByProject.get(projectId);
    if (set) {
      for (const listener of [...set]) callListener(listener);
    }
    return;
  }
  // Event without a projectId — notify everyone (defensive; keeps parity with
  // the previous per-project manager, which fanned any message to that stream's
  // listeners regardless of payload shape).
  for (const set of listenersByProject.values()) {
    for (const listener of [...set]) callListener(listener);
  }
}

function reconcile() {
  reconcileHandle = null;
  const key = unionKey();
  if (key === connectedKey) return;

  // Drop the old connection before opening the new one so we never hold two.
  if (es) {
    es.close();
    es = null;
    connectedKey = "";
  }
  if (!key) return;

  const next = createDeferredEventSource(
    `/api/issues/stream?projectIds=${key}`
  );
  next.onmessage = (ev) => {
    // The route emits `{event:"sync"}` as its first byte (a ready handshake);
    // it carries no issueId, so it's skipped here — broad invalidation on sync
    // would thrash (invalidate → refetch → badges remount → reconnect → sync…).
    let parsed: {
      event?: string;
      issueId?: number;
      projectId?: number;
    } | null = null;
    try {
      parsed = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (!parsed || typeof parsed.issueId !== "number") return;
    notify(parsed.projectId);
  };
  next.onerror = (err) => {
    // EventSource auto-reconnects on transport drops; the route's post-subscribe
    // sync byte makes listeners refetch on reconnect, so just log.
    console.warn("[issueUpdateStreamManager] SSE transport error", err);
  };
  es = next;
  connectedKey = key;
}

function scheduleReconcile() {
  if (reconcileHandle != null) return; // already pending — coalesce
  reconcileHandle = setTimeout(reconcile, RECONCILE_DEBOUNCE_MS);
}

/**
 * Register interest in issue updates for a set of projects. Returns an
 * idempotent unsubscribe. Multiple subscribers share the single multiplexed
 * EventSource; the connection reconnects (debounced) when the union of watched
 * projects changes and closes when the last subscriber for every project goes
 * away.
 */
export function subscribeToIssueUpdates(
  projectIds: number | number[] | null | undefined,
  onUpdate: IssueUpdateListener
): () => void {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    return () => undefined;
  }

  const raw = Array.isArray(projectIds)
    ? projectIds
    : projectIds != null
      ? [projectIds]
      : [];
  const ids = [
    ...new Set(
      raw.filter((id): id is number => Number.isInteger(id) && id > 0)
    ),
  ];
  if (ids.length === 0) return () => undefined;

  for (const id of ids) {
    projectRefCounts.set(id, (projectRefCounts.get(id) ?? 0) + 1);
    let set = listenersByProject.get(id);
    if (!set) {
      set = new Set();
      listenersByProject.set(id, set);
    }
    set.add(onUpdate);
  }
  scheduleReconcile();

  let released = false;
  return () => {
    if (released) return; // idempotent
    released = true;
    for (const id of ids) {
      const rc = (projectRefCounts.get(id) ?? 1) - 1;
      if (rc <= 0) projectRefCounts.delete(id);
      else projectRefCounts.set(id, rc);
      const set = listenersByProject.get(id);
      if (set) {
        set.delete(onUpdate);
        if (set.size === 0) listenersByProject.delete(id);
      }
    }
    scheduleReconcile();
  };
}

/**
 * Test-only: drop all state + the active connection so each test starts clean.
 * Production code never calls this.
 */
export function __resetIssueUpdateStreamsForTests(): void {
  if (reconcileHandle != null) {
    clearTimeout(reconcileHandle);
    reconcileHandle = null;
  }
  if (es) {
    try {
      es.close();
    } catch {
      /* swallow */
    }
    es = null;
  }
  connectedKey = "";
  projectRefCounts.clear();
  listenersByProject.clear();
}
