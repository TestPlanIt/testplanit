"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { ArrowRight, Inbox } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { RelativeTimeTooltip } from "~/components/RelativeTimeTooltip";
import { SessionNameDisplay } from "~/components/SessionNameDisplay";
import { CaseDisplay } from "~/components/tables/CaseDisplay";
import { TestRunNameDisplay } from "~/components/TestRunNameDisplay";
import { WorkflowStateDisplay } from "~/components/WorkflowStateDisplay";
import { Link } from "~/lib/navigation";

import type { PendingReviewSummaryRequest } from "./types";

/**
 * Rows past this point are summarized by a "view all" link rather than
 * rendered. The section sits at the top of the home page's "Your Assignments"
 * card, so an unbounded queue would push the runs/sessions it shares the card
 * with off-screen. The inbox at /reviews is the full, filterable surface.
 */
const MAX_VISIBLE_ROWS = 5;

interface PendingReviewsSummaryProps {
  requests: PendingReviewSummaryRequest[];
}

/**
 * Resolves the polymorphic entities behind a list of review requests.
 *
 * The ReviewRequest row carries `entityType` + `entityId` but no relation to
 * the entity itself — so entity names are side-fetched per type and joined
 * client-side, the same shape `/reviews` uses. Each fetch is `enabled` only
 * when the current rows reference that type. Shared by the dashboard card and
 * the profile page's compact Assignments section, feeding
 * {@link PendingReviewEntity}.
 */
export function usePendingReviewEntityMaps(
  requests: PendingReviewSummaryRequest[]
) {
  const caseIds = useMemo(
    () =>
      requests.filter((r) => r.entityType === "CASE").map((r) => r.entityId),
    [requests]
  );
  const runIds = useMemo(
    () => requests.filter((r) => r.entityType === "RUN").map((r) => r.entityId),
    [requests]
  );
  const sessionIds = useMemo(
    () =>
      requests.filter((r) => r.entityType === "SESSION").map((r) => r.entityId),
    [requests]
  );

  const { data: caseRows } = useClientQueries(
    schema
  ).repositoryCases.useFindMany(
    {
      where: { id: { in: caseIds }, isDeleted: false },
      select: {
        id: true,
        name: true,
        source: true,
        automated: true,
        hasParameters: true,
        isDeleted: true,
      },
    } as any,
    { enabled: caseIds.length > 0 } as any
  );
  const { data: runRows } = useClientQueries(schema).testRuns.useFindMany(
    {
      where: { id: { in: runIds }, isDeleted: false },
      select: {
        id: true,
        name: true,
        isDeleted: true,
        compositionLockedAt: true,
      },
    } as any,
    { enabled: runIds.length > 0 } as any
  );
  const { data: sessionRows } = useClientQueries(schema).sessions.useFindMany(
    {
      where: { id: { in: sessionIds }, isDeleted: false },
      select: { id: true, name: true, isDeleted: true },
    } as any,
    { enabled: sessionIds.length > 0 } as any
  );

  const caseById = useMemo(() => {
    const m = new Map<number, any>();
    for (const c of (caseRows as any[] | undefined) ?? []) m.set(c.id, c);
    return m;
  }, [caseRows]);
  const runById = useMemo(() => {
    const m = new Map<number, any>();
    for (const r of (runRows as any[] | undefined) ?? []) m.set(r.id, r);
    return m;
  }, [runRows]);
  const sessionById = useMemo(() => {
    const m = new Map<number, any>();
    for (const s of (sessionRows as any[] | undefined) ?? []) m.set(s.id, s);
    return m;
  }, [sessionRows]);

  return { caseById, runById, sessionById };
}

/**
 * Compact "reviews waiting on you" queue for the home dashboard.
 *
 * Rows link to the entity, not to the inbox: the entity page hosts the
 * `ReviewStatusBanner` with the Approve / Request changes / Reject cluster,
 * plus the comment thread explaining what the requester wants looked at.
 */
export function PendingReviewsSummary({
  requests,
}: PendingReviewsSummaryProps) {
  const t = useTranslations();

  const visibleRequests = useMemo(
    () => requests.slice(0, MAX_VISIBLE_ROWS),
    [requests]
  );
  const hiddenCount = requests.length - visibleRequests.length;

  const { caseById, runById, sessionById } =
    usePendingReviewEntityMaps(visibleRequests);

  if (requests.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="dashboard-pending-reviews">
      {/* Count-first plural heading, shared with the profile page's compact
          Assignments section. */}
      <h3
        className="flex items-center gap-1 font-semibold"
        data-testid="dashboard-pending-reviews-count"
      >
        <Inbox className="w-5 h-5 text-muted-foreground" />
        {t("users.profile.assignments.reviews", { count: requests.length })}
      </h3>
      <div className="space-y-4 ps-6">
        {visibleRequests.map((request) => (
          <div
            key={request.id}
            className="border p-3 rounded-md"
            data-testid={`dashboard-pending-review-${request.id}`}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="font-medium min-w-0 max-w-[75%]">
                <PendingReviewEntity
                  request={request}
                  caseById={caseById}
                  runById={runById}
                  sessionById={sessionById}
                />
              </div>
              <span className="text-xs text-muted-foreground ms-2 max-w-[25%] truncate">
                {request.project?.name}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 [&_.truncate]:max-w-[8rem]">
                <WorkflowStateDisplay
                  state={request.fromState as any}
                  size="sm"
                />
                <ArrowRight className="w-3 h-3 shrink-0" aria-hidden="true" />
                <WorkflowStateDisplay
                  state={request.toState as any}
                  size="sm"
                />
              </span>
              <span className="truncate">
                {t("common.by")}{" "}
                {request.requestedBy?.name ?? t("common.labels.unknown")}
              </span>
              <RelativeTimeTooltip date={request.createdAt} />
            </div>
          </div>
        ))}
      </div>
      {hiddenCount > 0 && (
        <div className="ps-6">
          <Link
            href="/reviews"
            className="text-sm text-primary hover:underline"
            data-testid="dashboard-pending-reviews-view-all"
          >
            {t("common.actions.viewAll")}
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * Resolves a polymorphic entity ref into the canonical display component for
 * its type. Falls back to a monospace `TYPE #id` label when the side-fetch
 * hasn't landed yet, or when the entity is soft-deleted and therefore filtered
 * out of the lookup.
 */
export function PendingReviewEntity({
  request,
  caseById,
  runById,
  sessionById,
}: {
  request: PendingReviewSummaryRequest;
  caseById: Map<number, any>;
  runById: Map<number, any>;
  sessionById: Map<number, any>;
}) {
  const { entityType, entityId, projectId } = request;

  if (entityType === "CASE") {
    const c = caseById.get(entityId);
    if (!c) return <EntityFallback label={`CASE #${entityId}`} />;
    return (
      <CaseDisplay
        id={c.id}
        name={c.name}
        source={c.source}
        automated={c.automated}
        hasParameters={c.hasParameters}
        isDeleted={c.isDeleted}
        link={`/projects/repository/${projectId}/${c.id}`}
        size="medium"
        maxLines={1}
      />
    );
  }

  if (entityType === "RUN") {
    const r = runById.get(entityId);
    if (!r) return <EntityFallback label={`RUN #${entityId}`} />;
    return <TestRunNameDisplay testRun={r} projectId={projectId} showIcon />;
  }

  const s = sessionById.get(entityId);
  if (!s) return <EntityFallback label={`SESSION #${entityId}`} />;
  return (
    <Link
      href={`/projects/sessions/${projectId}/${s.id}`}
      className="flex items-center gap-1 min-w-0 hover:underline"
    >
      <SessionNameDisplay session={s} showIcon />
    </Link>
  );
}

function EntityFallback({ label }: { label: string }) {
  return (
    <span className="font-mono text-xs text-muted-foreground">{label}</span>
  );
}
