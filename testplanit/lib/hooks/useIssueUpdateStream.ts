"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * Subscribe a project's issue list / detail views to live updates from
 * the inbound webhook → system sync pipeline. Mirrors the pattern from
 * `components/NotificationBell.tsx`:
 *   - Open an EventSource against the project-scoped SSE route.
 *   - On each event, invalidate any active React Query that targets the
 *     `Issue` model. The actual re-fetch goes through `useFindManyIssue`
 *     / `useFindUniqueIssue` (ZenStack-generated hooks), which run
 *     access-policy-checked reads via `getEnhancedDb`. SSE pub/sub is
 *     untrusted plumbing (Architectural Directive 2 — same posture as
 *     notifications); the wake-up just signals "refetch."
 *   - EventSource auto-reconnects on transport drops; the server emits
 *     `{event: "sync"}` immediately after subscribe completes, so the
 *     onmessage handler fires once per (re)connect to catch anything
 *     missed during the disconnect window.
 *
 * Pass `undefined` / `null` projectId when the view doesn't have one
 * (e.g., server-rendered passes, intermediate states); the hook
 * no-ops in that case.
 *
 * No-op on the server (no window / EventSource), so safe to import
 * from any client component.
 */
export function useIssueUpdateStream(projectId: number | null | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!projectId || projectId <= 0) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }

    const eventSource = new EventSource(
      `/api/issues/stream?projectId=${projectId}`
    );

    eventSource.onmessage = () => {
      // Invalidate every active query whose key contains the literal
      // `"Issue"` segment — covers `useFindManyIssue`,
      // `useFindUniqueIssue`, `useCountIssue`, etc. without coupling to
      // ZenStack's internal queryKey shape. No-op for queries that
      // aren't currently observed (React Query's default behavior).
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey.some(
            (segment) => typeof segment === "string" && segment === "Issue"
          ),
      });
    };

    eventSource.onerror = (err) => {
      // EventSource handles transport-level reconnects internally. Log
      // for visibility but don't surface to the user — transient network
      // blips are expected and the auto-reconnect closes the loop.
      console.warn("[useIssueUpdateStream] SSE transport error", err);
    };

    return () => {
      eventSource.close();
    };
  }, [projectId, queryClient]);
}
