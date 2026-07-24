"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { subscribeToIssueUpdates } from "./issueUpdateStreamManager";

/**
 * Subscribe an issue display component to live updates from the inbound
 * webhook → SyncService publish pipeline. Mounts in any component that
 * renders Issue data — issue badges, lists, popovers, detail views,
 * test case forms — and refetches React Query whenever an upstream
 * event lands on the relevant project's SSE channel.
 *
 * Connection management is handled by the singleton
 * `issueUpdateStreamManager`, which keeps ONE multiplexed EventSource
 * subscribed to the union of every project any mounted subscriber is
 * watching. So a page with 50 badges in project 7 opens one stream —
 * and, crucially, a cross-project list (global `/issues`,
 * `/admin/issues`) spanning many projects ALSO opens just one stream,
 * instead of one per project (which stormed past the server's per-user
 * connection cap).
 *
 * `projectIds` accepts an array because some Issue rows surface in
 * multi-project contexts (`IssuesDisplay.projectIds: number[]`). All of
 * the caller's ids fold into the shared connection's project union.
 *
 * Auth + read-policy enforcement happens at refetch time via
 * `useFindManyIssue` / `useFindUniqueIssue` going through
 * `getEnhancedDb` (Architectural Directive 2 — pub/sub is untrusted
 * plumbing).
 */
// Issue + its explicit link tables — rows here ARE issue data regardless
// of the query's args.
const ISSUE_FAMILY_MODELS = new Set([
  "issue",
  "milestoneissue",
  "repositorycaseissue",
]);

// Coalesce invalidation bursts. One SSE event fans out to EVERY mounted
// subscriber (a page with 39 issue badges gets 39 onUpdate callbacks for a
// single upstream event), and several events can land close together.
// Uninhibited, each callback issues its own invalidateQueries and
// invalidations arriving while a refetch is already in flight re-mark the
// queries stale — producing 2-3 back-to-back refetch/render cycles (visible
// as popover/badge flicker). A single fixed-window schedule turns any burst
// into exactly one invalidation pass. Exported for tests.
const INVALIDATE_COALESCE_MS = 200;
let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
let pendingQueryClient: QueryClient | null = null;

export function scheduleIssueInvalidation(queryClient: QueryClient): void {
  pendingQueryClient = queryClient;
  if (invalidateTimer !== null) return; // burst already scheduled
  invalidateTimer = setTimeout(() => {
    invalidateTimer = null;
    const client = pendingQueryClient;
    pendingQueryClient = null;
    void client?.invalidateQueries(
      {
        predicate: (query) => isIssueBearingQueryKey(query.queryKey),
      },
      // cancelRefetch:false is load-bearing, not a tweak. TanStack's default
      // (true) ABORTS the in-flight request and restarts it on every
      // invalidation pass. When a matched query is slower than the interval
      // between issue events, it is cancelled and restarted forever and never
      // resolves — a livelock, not just churn.
      //
      // That is exactly what took prod down on 2026-07-23: a Jira sync burst
      // published issue events continuously while a browser sat on
      // /projects/repository/:projectId/:caseId. Both heavy findFirst queries
      // on that page are issue-bearing (they pull `caseIssues` / `issues`) and
      // take 17-25s server-side, so each 200ms pass killed the in-flight
      // request and issued a new one: 677 requests for a single case in three
      // minutes, every one of them aborted (nginx 499), each still holding a
      // pg pool slot until the server noticed the abort. The pool (10) stayed
      // saturated and every other route queued behind it.
      //
      // With cancelRefetch:false an in-flight fetch is left alone to finish;
      // the invalidation still marks the query stale, so it refetches once the
      // current attempt settles. Slow queries make progress instead of
      // starving, and the request rate is bounded by completion rather than by
      // the event rate.
      { cancelRefetch: false }
    );
  }, INVALIDATE_COALESCE_MS);
}

/**
 * True when a React Query key belongs to a ZenStack query that carries
 * Issue data — either an issue-family model, or any model whose query
 * args reference an issue relation. Exported for tests.
 */
export function isIssueBearingQueryKey(queryKey: unknown): boolean {
  if (!Array.isArray(queryKey) || queryKey[0] !== "zenstack") return false;
  const model = queryKey[1];
  if (typeof model !== "string") return false;
  if (ISSUE_FAMILY_MODELS.has(model.toLowerCase())) return true;
  try {
    return JSON.stringify(queryKey.slice(2)).toLowerCase().includes("issue");
  } catch {
    // Unserializable args — err on the side of refetching.
    return true;
  }
}

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
      // ZenStack's queryKey shape is `["zenstack", model, operation, args,
      // options]` (verified against the v2.22 / v3.6 runtimes). An Issue
      // update only affects queries that actually carry Issue data, so the
      // invalidation is scoped by `isIssueBearingQueryKey` instead of the
      // former `["zenstack"]` prefix (which refetched EVERY ZenStack query
      // on the page — nav-bar notifications, project lists, color tables —
      // ~30 refetches per hover-sync on a busy page):
      //
      //   1. Issue-family models (Issue + its explicit link tables) are
      //      always issue-bearing.
      //   2. Any other model's query is issue-bearing when its serialized
      //      args mention an issue relation (`include: { issues }`,
      //      `caseIssues`, `milestoneIssues`, ... — every Issue relation
      //      name in schema.zmodel contains "issue"). Substring false
      //      positives just cause a harmless extra refetch.
      //
      // Non-ZenStack queries (REST calls from `app/api/...` routes etc.)
      // are NOT touched — their keys don't start with "zenstack".
      //
      // The call is coalesced: any burst of subscriber callbacks / SSE
      // events within the window produces ONE invalidation pass.
      scheduleIssueInvalidation(queryClient);
    };

    const ids = depKey.split(",").map((s) => Number(s));
    return subscribeToIssueUpdates(ids, onUpdate);
  }, [depKey, queryClient]);
}
