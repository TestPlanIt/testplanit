"use client";

/**
 * Single shared EventSource for the notification stream
 * (`/api/notifications/stream`) across every consumer on the page.
 *
 * The bell, the review inbox button and the compact-header alert counts all
 * wake up off the same user-scoped stream. Each used to open its own
 * EventSource, so one tab held 2–3 of the user's per-pod connection slots
 * (`SSE_PER_USER_CAP`). With a few tabs open the server evicted the oldest
 * stream to admit the newest, the evicted tab's EventSource auto-reconnected,
 * that reconnect evicted another, and so on without end — every reconnect
 * fanning a `{event:"sync"}` into a ReviewRequest refetch and a fresh Valkey
 * subscriber. `issueUpdateStreamManager.ts` fixed the same loop on the issues
 * stream; this file is its notification-stream counterpart.
 *
 * Two mechanisms:
 *
 * 1. Refcounted singleton. The first subscriber opens the connection, later
 *    subscribers share it, the last unsubscribe closes it. One stream per tab.
 * 2. Eviction is terminal. When the route evicts this connection it sends a
 *    named `superseded` event first. On it the manager closes the underlying
 *    EventSource — so the browser does NOT auto-reconnect — and goes dormant.
 *    The stream reopens only when the tab becomes visible (or focused) again,
 *    and the route's sync-on-connect then refreshes that tab's data.
 *
 * Every parsed message is fanned out to every listener; the consumers decide
 * what to refetch. SSR-safe: returns a no-op unsubscribe when window or
 * EventSource is unavailable.
 */

import { useEffect, useRef } from "react";
import {
  createDeferredEventSource,
  type DeferredEventSource,
} from "./deferredEventSource";

export interface NotificationStreamMessage {
  event?: string;
  id?: string;
  [key: string]: unknown;
}

export type NotificationStreamListener = (
  msg: NotificationStreamMessage
) => void;

const STREAM_URL = "/api/notifications/stream";

const listeners: Set<NotificationStreamListener> = new Set();
let es: DeferredEventSource | null = null;
// Set when the server evicted this connection; cleared when the tab regains
// visibility and the stream reopens.
let dormant = false;
let wakeHandlersAttached = false;

function callListener(
  listener: NotificationStreamListener,
  msg: NotificationStreamMessage
) {
  try {
    listener(msg);
  } catch (err) {
    console.warn("[notificationStreamManager] listener threw", err);
  }
}

function notify(msg: NotificationStreamMessage) {
  // Snapshot — a listener may subscribe/unsubscribe mid-iteration.
  for (const listener of [...listeners]) callListener(listener, msg);
}

function closeStream() {
  if (!es) return;
  try {
    es.close();
  } catch {
    /* swallow */
  }
  es = null;
}

function open() {
  if (es) return;
  const next = createDeferredEventSource(STREAM_URL);
  next.onmessage = (ev) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    notify(parsed as NotificationStreamMessage);
  };
  next.onerror = (err) => {
    // Transport drops auto-reconnect; the route's sync-on-connect makes the
    // listeners refetch, so just log.
    console.warn("[notificationStreamManager] SSE transport error", err);
  };
  next.addEventListener("superseded", () => {
    // The server closed this connection to admit a newer one for the same
    // user. Closing here is what stops the browser from reconnecting and
    // restarting the eviction cycle; the tab resyncs when it is next looked at.
    if (next !== es) return;
    closeStream();
    dormant = true;
    attachWakeHandlers();
  });
  es = next;
}

function wake() {
  if (!dormant) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden")
    return;
  dormant = false;
  if (listeners.size > 0) open();
}

function onVisibilityChange() {
  wake();
}

function attachWakeHandlers() {
  if (wakeHandlersAttached || typeof window === "undefined") return;
  wakeHandlersAttached = true;
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("focus", wake);
}

function detachWakeHandlers() {
  if (!wakeHandlersAttached) return;
  wakeHandlersAttached = false;
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("focus", wake);
}

/**
 * Register a listener for notification-stream messages. Returns an
 * idempotent unsubscribe. All subscribers share ONE EventSource; it opens with
 * the first subscriber and closes with the last.
 */
export function subscribeToNotificationStream(
  listener: NotificationStreamListener
): () => void {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    return () => undefined;
  }

  listeners.add(listener);
  if (!dormant) open();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    listeners.delete(listener);
    if (listeners.size === 0) {
      closeStream();
      dormant = false;
      detachWakeHandlers();
    }
  };
}

/**
 * Subscribe a component to the shared notification stream while `enabled`.
 * The latest `listener` is read at dispatch time, so callers may pass an
 * inline function without resubscribing on every render.
 */
export function useNotificationStream(
  listener: NotificationStreamListener,
  enabled = true
): void {
  const listenerRef = useRef(listener);
  useEffect(() => {
    listenerRef.current = listener;
  });

  useEffect(() => {
    if (!enabled) return;
    return subscribeToNotificationStream((msg) => listenerRef.current(msg));
  }, [enabled]);
}

/**
 * Test-only: drop all state + the active connection so each test starts clean.
 * Production code never calls this.
 */
export function __resetNotificationStreamForTests(): void {
  closeStream();
  listeners.clear();
  dormant = false;
  detachWakeHandlers();
}
