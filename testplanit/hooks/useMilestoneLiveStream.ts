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

/**
 * Subscribe to the SSE wake-up stream for one milestone and invoke
 * `onWakeUp` for every event received.
 *
 * Verbatim mirror of `useTestRunLiveStream` (D-14/D-15 hard constraint —
 * this hook pair is the ONLY milestone live-update subscriber; no bespoke
 * third variant, no singleton-manager complexity like the Issue-badge
 * pattern, since milestones have exactly one detail subscriber and one
 * project subscriber, not a high-multiplicity-mount problem).
 *
 * The browser opens at most one EventSource per `(milestoneId, mount)`
 * pair; EventSource handles transport reconnects on its own. When the
 * milestoneId changes or the consumer unmounts, the connection is closed
 * cleanly. `onWakeUp` receives the parsed `{ event, milestoneId,
 * projectId, targetId? }` payload the server published; the consumer
 * typically uses it to trigger one or more React-Query refetches.
 *
 * The hook is intentionally inert on the server and in test environments
 * without EventSource — there's nothing to subscribe to.
 *
 * The connection is gated on `enabled` so callers can keep the stream
 * dormant while a milestone isn't actively being watched.
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
  // Latest-ref pattern so callers don't have to memoize their onWakeUp.
  // Without this, a caller whose onWakeUp captures state that changes on
  // wake-up (e.g. an invalidate-on-fetch loop where invalidation triggers
  // refetch which changes deps which regenerates the callback) would
  // close + reopen the EventSource on every wake-up, thrashing the server.
  const onWakeUpRef = useRef(onWakeUp);
  useEffect(() => {
    onWakeUpRef.current = onWakeUp;
  }, [onWakeUp]);

  useEffect(() => {
    if (!enabled) return;
    if (!milestoneId || milestoneId <= 0) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }

    const eventSource = new EventSource(
      `/api/milestones/${milestoneId}/stream`
    );

    eventSource.onmessage = (msg) => {
      try {
        const payload = JSON.parse(msg.data) as MilestoneWakeUp;
        onWakeUpRef.current(payload);
      } catch (err) {
        console.warn("[useMilestoneLiveStream] malformed wake-up", err);
      }
    };

    eventSource.onerror = (err) => {
      // EventSource auto-reconnects on transport drop. A user-visible
      // toast would be noisy on transient blips.
      console.warn("[useMilestoneLiveStream] SSE transport error", err);
    };

    return () => {
      eventSource.close();
    };
  }, [milestoneId, enabled]);
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
 * Same null/non-browser guards as the per-milestone hook.
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
  // Latest-ref so callers don't have to memoize. See the singular hook's
  // comment for why this matters: invalidate-on-wake-up loops naturally
  // change the callback's closure identity on every wake-up, and without
  // a ref every wake-up would tear down and reopen the EventSource.
  const onWakeUpRef = useRef(onWakeUp);
  useEffect(() => {
    onWakeUpRef.current = onWakeUp;
  }, [onWakeUp]);

  useEffect(() => {
    if (!enabled) return;
    if (!projectId || projectId <= 0) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }

    const eventSource = new EventSource(
      `/api/projects/${projectId}/milestones/stream`
    );

    eventSource.onmessage = (msg) => {
      try {
        const payload = JSON.parse(msg.data) as MilestoneWakeUp;
        onWakeUpRef.current(payload);
      } catch (err) {
        console.warn("[useProjectMilestoneStream] malformed wake-up", err);
      }
    };

    eventSource.onerror = (err) => {
      console.warn("[useProjectMilestoneStream] SSE transport error", err);
    };

    return () => {
      eventSource.close();
    };
  }, [projectId, enabled]);
}
