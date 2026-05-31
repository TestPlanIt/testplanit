"use client";

import { useEffect } from "react";

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
        onWakeUp(payload);
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
  }, [runId, enabled, onWakeUp]);
}
