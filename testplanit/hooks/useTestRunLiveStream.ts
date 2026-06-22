"use client";

import { useEffect, useRef } from "react";

/**
 * Subscribe to the SSE wake-up stream for one test run and invoke
 * `onWakeUp` for every event received.
 *
 * The browser opens at most one EventSource per `(runId, mount)` pair;
 * EventSource handles transport reconnects on its own. When the runId
 * changes or the consumer unmounts, the connection is closed cleanly.
 * `onWakeUp` receives the parsed `{ event, runId, targetId? }` payload
 * the server published; the consumer typically uses it to trigger one
 * or more React-Query refetches.
 *
 * The hook is intentionally inert on the server and in test
 * environments without EventSource — there's nothing to subscribe to.
 *
 * The connection is gated on `enabled` so callers can keep the stream
 * dormant while a test run isn't actively being watched (the polling
 * code it replaces was similarly gated on the run's workflowType).
 */

export interface TestRunWakeUp {
  event:
    | "sync"
    | "test_run.created"
    | "test_run.result_added"
    | "test_run.state_changed"
    | "test_run.completed"
    | "test_run.case.status_changed";
  runId?: number;
  targetId?: number;
}

export interface UseTestRunLiveStreamArgs {
  runId: number | null | undefined;
  enabled?: boolean;
  onWakeUp: (event: TestRunWakeUp) => void;
}

export function useTestRunLiveStream({
  runId,
  enabled = true,
  onWakeUp,
}: UseTestRunLiveStreamArgs): void {
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
    if (!runId || runId <= 0) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }

    const eventSource = new EventSource(`/api/test-runs/${runId}/stream`);

    eventSource.onmessage = (msg) => {
      try {
        const payload = JSON.parse(msg.data) as TestRunWakeUp;
        onWakeUpRef.current(payload);
      } catch (err) {
        console.warn("[useTestRunLiveStream] malformed wake-up", err);
      }
    };

    eventSource.onerror = (err) => {
      // EventSource auto-reconnects on transport drop. A user-visible
      // toast would be noisy on transient blips.
      console.warn("[useTestRunLiveStream] SSE transport error", err);
    };

    return () => {
      eventSource.close();
    };
  }, [runId, enabled]);
}

/**
 * Project-level wake-up stream. Used by the runs list page: ONE
 * EventSource covers every in-progress run in the project, regardless
 * of how many runs are active.
 *
 * Per-run streams hit the browser's HTTP/1.1 6-connection-per-origin
 * cap on busy projects (e.g. 22 in-progress runs → no connection slots
 * left for the page document or its data). This stream sidesteps that
 * by multiplexing at the Valkey-channel layer: publishers fan out each
 * wake-up to both the per-run channel and the per-project channel, so
 * detail-page consumers see one EventSource and list-page consumers
 * see one EventSource, never N.
 *
 * The wake-up payload includes `runId`, so the list page consumer can
 * still invalidate per-run queries when desired (or invalidate the
 * batched summary query and re-fetch everything at once).
 *
 * Same null/non-browser guards as the per-run hook.
 */
export function useProjectTestRunStream({
  projectId,
  enabled = true,
  onWakeUp,
}: {
  projectId: number | null | undefined;
  enabled?: boolean;
  onWakeUp: (event: TestRunWakeUp) => void;
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
      `/api/projects/${projectId}/test-runs/stream`
    );

    eventSource.onmessage = (msg) => {
      try {
        const payload = JSON.parse(msg.data) as TestRunWakeUp;
        onWakeUpRef.current(payload);
      } catch (err) {
        console.warn("[useProjectTestRunStream] malformed wake-up", err);
      }
    };

    eventSource.onerror = (err) => {
      console.warn("[useProjectTestRunStream] SSE transport error", err);
    };

    return () => {
      eventSource.close();
    };
  }, [projectId, enabled]);
}
