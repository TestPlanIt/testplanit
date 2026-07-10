"use client";

import { useEffect, useRef } from "react";
import type { MilestoneWakeUpEvent } from "~/lib/live/publish";

/**
 * Client-side parse shape for messages arriving on the milestone SSE
 * stream. Widens the strict server-side `MilestoneWakeUp` publish payload
 * (`lib/live/publish.ts`) with the `"sync"` checkpoint event the route
 * sends immediately after subscribing (see route.ts `sendEvent({event:
 * "sync"})`) and relaxes `milestoneId`/`projectId` to optional since the
 * sync checkpoint carries neither. Mirrors `TestRunWakeUp` in
 * `useTestRunLiveStream.ts` verbatim.
 */
export interface MilestoneWakeUp {
  event: MilestoneWakeUpEvent | "sync";
  milestoneId?: number;
  projectId?: number;
  targetId?: number;
}

type MilestoneWakeUpListener = (event: MilestoneWakeUp) => void;

/**
 * Shared, refcounted EventSource registry keyed by stream URL.
 *
 * Multiple components on one page legitimately subscribe to the SAME
 * milestone stream (detail page + overflow panel), and React StrictMode
 * double-mounts every subscriber in dev. Without sharing, each mount held
 * its own EventSource — long-lived SSE connections that count against the
 * browser's ~6-connection-per-origin HTTP/1.1 cap ACROSS ALL TABS. With a
 * milestones list tab and a detail tab open, the pool saturated and
 * ordinary fetches (e.g. the issue-hover Jira-details request) queued
 * indefinitely — the exact D-14 failure mode this pattern exists to
 * prevent. One EventSource per URL per window, no matter how many
 * subscribers mount.
 *
 * Closing is deferred by a short grace period so unmount/remount churn
 * (StrictMode, section collapse/expand) reuses the live connection instead
 * of thrashing reconnects — mirrors issueUpdateStreamManager's debounced
 * reconcile.
 */
interface StreamEntry {
  es: EventSource;
  listeners: Set<MilestoneWakeUpListener>;
  refCount: number;
  closeHandle: ReturnType<typeof setTimeout> | null;
}

const streams: Map<string, StreamEntry> = new Map();

const CLOSE_GRACE_MS = 250;

function subscribeToMilestoneStream(
  url: string,
  listener: MilestoneWakeUpListener
): () => void {
  let entry = streams.get(url);
  if (entry) {
    if (entry.closeHandle != null) {
      clearTimeout(entry.closeHandle);
      entry.closeHandle = null;
    }
  } else {
    const es = new EventSource(url);
    const created: StreamEntry = {
      es,
      listeners: new Set(),
      refCount: 0,
      closeHandle: null,
    };
    es.onmessage = (msg) => {
      let payload: MilestoneWakeUp;
      try {
        payload = JSON.parse(msg.data) as MilestoneWakeUp;
      } catch (err) {
        console.warn("[useMilestoneLiveStream] malformed wake-up", err);
        return;
      }
      // Snapshot — a listener may unsubscribe/resubscribe mid-iteration.
      for (const l of [...created.listeners]) {
        try {
          l(payload);
        } catch (err) {
          console.warn("[useMilestoneLiveStream] listener threw", err);
        }
      }
    };
    es.onerror = (err) => {
      // EventSource auto-reconnects on transport drop. A user-visible
      // toast would be noisy on transient blips.
      console.warn("[useMilestoneLiveStream] SSE transport error", err);
    };
    streams.set(url, created);
    entry = created;
  }

  entry.refCount += 1;
  entry.listeners.add(listener);

  let released = false;
  return () => {
    if (released) return; // idempotent
    released = true;
    const current = streams.get(url);
    if (!current) return;
    current.listeners.delete(listener);
    current.refCount -= 1;
    if (current.refCount <= 0 && current.closeHandle == null) {
      current.closeHandle = setTimeout(() => {
        const stale = streams.get(url);
        if (!stale || stale.refCount > 0) return;
        try {
          stale.es.close();
        } catch {
          /* swallow */
        }
        streams.delete(url);
      }, CLOSE_GRACE_MS);
    }
  };
}

/**
 * Test-only: drop all shared streams so each test starts clean. Production
 * code never calls this.
 */
export function __resetMilestoneStreamsForTests(): void {
  for (const entry of streams.values()) {
    if (entry.closeHandle != null) clearTimeout(entry.closeHandle);
    try {
      entry.es.close();
    } catch {
      /* swallow */
    }
  }
  streams.clear();
}

function useSharedMilestoneStream(
  url: string | null,
  enabled: boolean,
  onWakeUp: MilestoneWakeUpListener
): void {
  // Latest-ref pattern so callers don't have to memoize their onWakeUp.
  // Without this, a caller whose onWakeUp captures state that changes on
  // wake-up (e.g. an invalidate-on-fetch loop where invalidation triggers
  // refetch which changes deps which regenerates the callback) would
  // resubscribe on every wake-up.
  const onWakeUpRef = useRef(onWakeUp);
  useEffect(() => {
    onWakeUpRef.current = onWakeUp;
  }, [onWakeUp]);

  useEffect(() => {
    if (!enabled || !url) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }
    return subscribeToMilestoneStream(url, (payload) => {
      onWakeUpRef.current(payload);
    });
  }, [url, enabled]);
}

/**
 * Subscribe to the SSE wake-up stream for one milestone and invoke
 * `onWakeUp` for every event received.
 *
 * All subscribers of the same milestone share ONE EventSource through the
 * refcounted registry above (D-14/D-15 hard constraint — thin wake-ups,
 * bounded connection count). `onWakeUp` receives the parsed `{ event,
 * milestoneId, projectId, targetId? }` payload the server published; the
 * consumer typically uses it to trigger one or more React-Query refetches.
 *
 * The hook is intentionally inert on the server and in test environments
 * without EventSource — there's nothing to subscribe to. The subscription
 * is gated on `enabled` so callers can keep the stream dormant while a
 * milestone isn't actively being watched.
 */
export interface UseMilestoneLiveStreamArgs {
  milestoneId: number | null | undefined;
  enabled?: boolean;
  onWakeUp: (event: MilestoneWakeUp) => void;
}

export function useMilestoneLiveStream({
  milestoneId,
  enabled = true,
  onWakeUp,
}: UseMilestoneLiveStreamArgs): void {
  const url =
    milestoneId && milestoneId > 0
      ? `/api/milestones/${milestoneId}/stream`
      : null;
  useSharedMilestoneStream(url, enabled, onWakeUp);
}

/**
 * Project-level wake-up stream. Used by the milestones list page and the
 * import picker (D-15): ONE EventSource covers every milestone in the
 * project, regardless of how many are being tracked/synced.
 *
 * Per-milestone streams hit the browser's HTTP/1.1 6-connection-per-origin
 * cap on busy projects. This stream sidesteps that by multiplexing at the
 * Valkey-channel layer: publishers fan out each wake-up to both the
 * per-milestone channel and the per-project channel, so detail-page
 * consumers see one EventSource and list-page consumers see one
 * EventSource, never N.
 *
 * The wake-up payload includes `milestoneId`, so the list page consumer
 * can still invalidate per-milestone queries when desired (or invalidate
 * the batched list query and re-fetch everything at once).
 *
 * Same null/non-browser guards and shared-registry semantics as the
 * per-milestone hook.
 */
export function useProjectMilestoneStream({
  projectId,
  enabled = true,
  onWakeUp,
}: {
  projectId: number | null | undefined;
  enabled?: boolean;
  onWakeUp: (event: MilestoneWakeUp) => void;
}): void {
  const url =
    projectId && projectId > 0
      ? `/api/projects/${projectId}/milestones/stream`
      : null;
  useSharedMilestoneStream(url, enabled, onWakeUp);
}
