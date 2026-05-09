"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { subscribeToProjectIssueUpdates } from "./issueUpdateStreamManager";

/**
 * Subscribe an issue display component to live updates from the inbound
 * webhook → SyncService publish pipeline. Mounts in any component that
 * renders Issue data — issue badges, lists, popovers, detail views,
 * test case forms — and refetches React Query whenever an upstream
 * event lands on the relevant project's SSE channel.
 *
 * Connection management is handled by the singleton
 * `issueUpdateStreamManager`: every component asking for the same
 * projectId shares ONE EventSource (refcounted), and the connection
 * auto-closes when the last subscriber unmounts. So putting this hook
 * in `IssuesDisplay` (the per-issue badge) is correct — a page with
 * 50 issue badges all in project 7 still opens just one stream.
 *
 * `projectIds` accepts an array because some Issue rows surface in
 * multi-project contexts (`IssuesDisplay.projectIds: number[]`). The
 * hook subscribes to every distinct project id in the array. For the
 * common single-project case, callers can pass `issue.projectId` and
 * the array machinery degenerates to one subscription.
 *
 * Auth + read-policy enforcement happens at refetch time via
 * `useFindManyIssue` / `useFindUniqueIssue` going through
 * `getEnhancedDb` (Architectural Directive 2 — pub/sub is untrusted
 * plumbing).
 */
export function useIssueUpdateStream(
  projectIds: number | number[] | null | undefined
) {
  const queryClient = useQueryClient();

  // Stable string key so the effect dep array doesn't see a fresh
  // array reference on every render (callers passing inline arrays
  // would otherwise re-subscribe on every parent rerender).
  const ids = Array.isArray(projectIds)
    ? projectIds
    : projectIds != null
      ? [projectIds]
      : [];
  const validIds = ids.filter(
    (id): id is number => Number.isInteger(id) && id > 0
  );
  const depKey = validIds.length === 0 ? "" : validIds.slice().sort().join(",");

  useEffect(() => {
    if (depKey === "") return;
    const onUpdate = () => {
      console.log(`[useIssueUpdateStream] SSE fired for projects=${depKey}`);
      // ZenStack's queryKey shape is `["zenstack", model, operation, args,
      // options]` (verified against the v2.22 / v3.6 runtimes). React
      // Query treats a partial key as a prefix, so `["zenstack"]` matches
      // every ZenStack-issued query on the page — `useFindManyIssue`,
      // `useFindUniqueIssue`, AND every parent-model query that may
      // include Issue data via a relation (e.g.
      // `useFindManyRepositoryCaseVersions` with `include: { issues }`,
      // `useFindManySessions` w/ included issues, etc.).
      //
      // Why so broad: an Issue update changes data the user sees in many
      // shapes — the issue badge title, a row showing "linked issues
      // count", a popover of related sessions, a test run's failure
      // panel. Tracking every consumer's queryKey shape is brittle; the
      // alternative is "anything fetched via ZenStack might be affected,
      // refetch the active ones." React Query's invalidation is cheap
      // (refetch only fires on queries with active observers — i.e.
      // queries actually mounted on the current page).
      //
      // Non-ZenStack queries (REST calls from `app/api/...` routes etc.)
      // are NOT touched — their keys don't start with "zenstack".
      void queryClient.invalidateQueries({
        queryKey: ["zenstack"],
      });
    };

    const unsubs = depKey
      .split(",")
      .map((s) => Number(s))
      .map((id) => subscribeToProjectIssueUpdates(id, onUpdate));

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [depKey, queryClient]);
}
