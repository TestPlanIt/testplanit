"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { History, Inbox } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { DataTable } from "@/components/tables/DataTable";
import { useQueryClient } from "@tanstack/react-query";
import {
  commentsQueryKey,
  reviewableEntityTypeToCommentEntityType,
} from "~/components/comments/commentsQueryKey";
import {
  ApproveDialog,
  RejectDialog,
  RequestChangesDialog,
  type ReviewableEntityType,
} from "~/components/reviews/ReviewDecisionDialogs";
import { useReviewAssigneeRoleIds } from "~/hooks/useReviewAssigneeRoleIds";
import { useReviewFeatureEnabled } from "~/hooks/useReviewFeatureEnabled";
import { useRouter } from "~/lib/navigation";

import {
  useColumns,
  type ExtendedReviewRequest,
  type InboxActionHandlers,
  type InboxCaseRow,
  type InboxSessionRow,
  type InboxTableRow,
  type InboxTestRunRow,
  type InboxView,
} from "./columns";

type EntityTypeFilter = "all" | "CASE" | "RUN" | "SESSION";
type ProjectFilter = "all" | number;
type Decision = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

interface ActiveDialogState {
  decision: Decision;
  row: ExtendedReviewRequest;
}

/**
 * Top-level entry point. Mirrors `app/[locale]/admin/audit-logs/page.tsx`'s
 * structure (Guard → Content) but with no admin gate: per D-09 the inbox is
 * visible to every authenticated user.
 */
export default function ReviewsInboxPage() {
  return <ReviewsInboxGuard />;
}

function ReviewsInboxGuard() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  if (status === "loading") return null;
  if (!session) return null;

  return <ReviewsInboxContent userId={session.user.id} />;
}

/**
 * Inbox content shell — runs only when a session is in hand. The visible
 * surface is a `<DataTable>` so the inbox inherits the same pagination,
 * sortable headers, column visibility, and resize/pinning affordances every
 * other table in the app already speaks. Three things stay local to this
 * page:
 *
 *   1. The base where-clause (PENDING + isDeleted + assignee OR
 *      assigneeRole-in-list) plus the two filter narrowings.
 *   2. The sort config — pushed down into the ReviewRequest `orderBy`
 *      rather than sorted client-side so the database does the work and
 *      pagination remains correct.
 *   3. Per-row decision dialog state. The action callbacks the column defs
 *      receive open an `<ApproveDialog>` / `<RequestChangesDialog>` /
 *      `<RejectDialog>` here at the page root; on success both the
 *      ReviewRequest cache and the per-entity Comments thread are
 *      invalidated so the row leaves the queue and any open entity page
 *      picks up the paired REVIEW_DECISION Comment without a manual reload.
 *
 * Per RESEARCH Pitfall 4 the listing fires `refetchOnWindowFocus: true` so
 * a reviewer returning from another tab sees fresh data.
 */
function ReviewsInboxContent({ userId }: { userId: string }) {
  // Cast `useTranslations()` to a plain key-to-string function so the
  // accumulated phase-2 message-keys union doesn't trip TS2590 / TS2554.
  const t = useTranslations() as (
    key: string,
    params?: Record<string, unknown>
  ) => string;
  const queryClient = useQueryClient();
  const { enabled: featureEnabled, isLoading: featureLoading } =
    useReviewFeatureEnabled();

  const [entityTypeFilter, setEntityTypeFilter] =
    useState<EntityTypeFilter>("all");
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");

  // Tab state — Pending (queue I still need to act on) vs Decided
  // (history of what I've already approved / requested changes on /
  // rejected). Per-tab sort defaults differ: pending sorts oldest-first
  // (most-overdue at the top), decided sorts most-recently-decided first.
  const [view, setView] = useState<InboxView>("pending");

  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "requestedAt", direction: "asc" });
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  const handleSortChange = (columnId: string) => {
    setSortConfig((prev) => ({
      column: columnId,
      direction:
        prev.column === columnId && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const handleViewChange = (next: InboxView) => {
    setView(next);
    // Reset sort to the natural default for the new tab so the column
    // header arrow makes sense after the switch.
    setSortConfig(
      next === "pending"
        ? { column: "requestedAt", direction: "asc" }
        : { column: "decidedAt", direction: "desc" }
    );
  };

  // Role IDs the viewer can be reached through as an assignee (global +
  // SPECIFIC_ROLE), flattened by the shared hook the header badge also uses.
  const currentUserRoleIds = useReviewAssigneeRoleIds(userId);

  const { data: projects } = useClientQueries(schema).projects.useFindMany({
    where: { isDeleted: false },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const whereClause = useMemo(() => {
    // Pending tab → PENDING + (I'm the direct assignee OR I hold one of
    // the assigned roles). Decided tab → rows I've decided regardless of
    // the resulting status. The two scopes are mutually exclusive so the
    // queue and the history never double-count a row.
    //
    // Project-flag scoping: hide requests from projects whose review
    // workflow toggle is OFF. Stale rows persist in the table (cancel +
    // decide flips status; a project toggling its review workflow off
    // doesn't touch existing rows) so the filter has to live at query
    // time. The system-level kill switch short-circuits the whole query
    // via `enabled: featureEnabled === true` below.
    const conditions: any[] =
      view === "pending"
        ? [
            { status: "PENDING" },
            { isDeleted: false },
            { project: { reviewWorkflowEnabled: true } },
            {
              OR: [
                { assigneeUserId: userId },
                { assigneeRoleId: { in: currentUserRoleIds } },
              ],
            },
          ]
        : [
            { decidedByUserId: userId },
            {
              status: {
                in: ["APPROVED", "CHANGES_REQUESTED", "REJECTED"] as const,
              },
            },
            { isDeleted: false },
            { project: { reviewWorkflowEnabled: true } },
          ];
    if (entityTypeFilter !== "all") {
      conditions.push({ entityType: entityTypeFilter });
    }
    if (projectFilter !== "all") {
      conditions.push({ projectId: projectFilter });
    }
    return { AND: conditions };
  }, [view, userId, currentUserRoleIds, entityTypeFilter, projectFilter]);

  // Map DataTable's column id → ReviewRequest orderBy field. Anything that
  // doesn't have a server-side analog (custom render-only column) falls back
  // to the natural per-tab default (createdAt for pending, decidedAt for
  // decided) so the query stays valid.
  const orderBy = useMemo(() => {
    const dir = sortConfig.direction;
    switch (sortConfig.column) {
      case "entity":
        return { entityId: dir };
      case "project":
        return { projectId: dir };
      case "requester":
        return { requestedByUserId: dir };
      case "transitionFrom":
        return { fromStateId: dir };
      case "transitionTo":
        return { toStateId: dir };
      case "status":
        return { status: dir };
      case "decidedAt":
        return { decidedAt: dir };
      case "requestedAt":
        return { createdAt: dir };
      default:
        return view === "decided" ? { decidedAt: dir } : { createdAt: dir };
    }
  }, [sortConfig, view]);

  const { data: rows } = useClientQueries(schema).reviewRequest.useFindMany(
    {
      where: whereClause,
      orderBy,
      include: {
        project: { select: { id: true, name: true, iconUrl: true } },
        requestedBy: { select: { id: true, name: true, image: true } },
        fromState: {
          select: {
            id: true,
            name: true,
            requiresReview: true,
            icon: { select: { name: true } },
            color: { select: { value: true } },
          },
        },
        toState: {
          select: {
            id: true,
            name: true,
            requiresReview: true,
            icon: { select: { name: true } },
            color: { select: { value: true } },
          },
        },
        assigneeUser: { select: { id: true, name: true, image: true } },
        assigneeRole: { select: { id: true, name: true } },
      },
    },
    {
      // Skip the inbox query entirely when the system-level kill switch is
      // off (L2 in the audit). The featureDisabled empty state already
      // covers the UI surface; running the query would just be wasted RTT.
      enabled: featureEnabled === true,
      refetchOnWindowFocus: true,
    } as any
  );

  const featureDisabled = featureLoading ? false : featureEnabled === false;
  const inboxRows: ExtendedReviewRequest[] = featureDisabled
    ? []
    : ((rows as ExtendedReviewRequest[] | undefined) ?? []);

  // Side-fetch entity names + chrome so the column cells can render the
  // canonical CaseDisplay / TestRunNameDisplay / SessionNameDisplay
  // components instead of bare IDs. Each fetch is `enabled` only when the
  // current row set has matching ids; TanStack Query caches by key so
  // re-renders are cheap.
  const caseIds = useMemo(
    () =>
      inboxRows.filter((r) => r.entityType === "CASE").map((r) => r.entityId),
    [inboxRows]
  );
  const runIds = useMemo(
    () =>
      inboxRows.filter((r) => r.entityType === "RUN").map((r) => r.entityId),
    [inboxRows]
  );
  const sessionIds = useMemo(
    () =>
      inboxRows
        .filter((r) => r.entityType === "SESSION")
        .map((r) => r.entityId),
    [inboxRows]
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
    const m = new Map<number, InboxCaseRow>();
    for (const c of (caseRows as InboxCaseRow[] | undefined) ?? []) {
      m.set(c.id, c);
    }
    return m;
  }, [caseRows]);
  const testRunById = useMemo(() => {
    const m = new Map<number, InboxTestRunRow>();
    for (const r of (runRows as InboxTestRunRow[] | undefined) ?? []) {
      m.set(r.id, r);
    }
    return m;
  }, [runRows]);
  const sessionById = useMemo(() => {
    const m = new Map<number, InboxSessionRow>();
    for (const s of (sessionRows as InboxSessionRow[] | undefined) ?? []) {
      m.set(s.id, s);
    }
    return m;
  }, [sessionRows]);

  // Per-row dialog state — opens the right decision dialog for the row the
  // reviewer clicked an action on.
  const [activeDialog, setActiveDialog] = useState<ActiveDialogState | null>(
    null
  );
  const closeDialog = () => setActiveDialog(null);

  const actions: InboxActionHandlers = useMemo(
    () => ({
      onApprove: (row) => setActiveDialog({ decision: "APPROVED", row }),
      onRequestChanges: (row) =>
        setActiveDialog({ decision: "CHANGES_REQUESTED", row }),
      onReject: (row) => setActiveDialog({ decision: "REJECTED", row }),
    }),
    []
  );

  const columns = useColumns({
    t,
    view,
    actions,
    caseById,
    testRunById,
    sessionById,
  });

  // DataTable's `DataRow` shape requires every row to carry `id` + `name`.
  // Synthesize a short label per row — it's only used by DataTable's internal
  // drag/scroll plumbing, not by anything we render.
  const tableData: InboxTableRow[] = useMemo(
    () =>
      inboxRows.map((r) => ({
        ...r,
        name: `${r.entityType} #${r.entityId}`,
      })),
    [inboxRows]
  );

  const handleDecisionSuccess = (row: ExtendedReviewRequest) => {
    void queryClient.invalidateQueries({
      queryKey: ["zenstack", "ReviewRequest"],
    });
    void queryClient.invalidateQueries({
      queryKey: commentsQueryKey(
        reviewableEntityTypeToCommentEntityType(
          row.entityType as "CASE" | "RUN" | "SESSION"
        ),
        row.entityId
      ),
    });
  };

  return (
    <main data-testid="reviews-inbox-page">
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
            <div className="flex items-center gap-3">
              <Inbox className="h-8 w-8" aria-hidden="true" />
              <CardTitle data-testid="reviews-inbox-page-title">
                {t("reviews.inbox.pageTitle")}
              </CardTitle>
            </div>
          </div>
          <p className="text-muted-foreground text-sm mt-2">
            {view === "pending"
              ? t("reviews.inbox.pageDescription")
              : t("reviews.inbox.pageDescriptionDecided")}
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {/* Tab strip — Pending (queue) vs Decided (history). Each
                trigger gets an icon and a min-width so the tab cluster
                reads as navigation even with short labels. */}
            <Tabs
              value={view}
              onValueChange={(next) => handleViewChange(next as InboxView)}
            >
              <TabsList>
                <TabsTrigger
                  value="pending"
                  data-testid="reviews-inbox-tab-pending"
                  className="min-w-[8rem] gap-2"
                >
                  <Inbox className="h-4 w-4" aria-hidden="true" />
                  {t("reviews.inbox.tabPending")}
                </TabsTrigger>
                <TabsTrigger
                  value="decided"
                  data-testid="reviews-inbox-tab-decided"
                  className="min-w-[8rem] gap-2"
                >
                  <History className="h-4 w-4" aria-hidden="true" />
                  {t("reviews.inbox.tabDecided")}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Filters row */}
            <div className="flex flex-wrap items-end gap-4">
              <div className="w-[200px]">
                <Label
                  htmlFor="reviews-inbox-entity-type-filter"
                  className="text-xs text-muted-foreground"
                >
                  {t("reviews.inbox.filterEntityType")}
                </Label>
                <select
                  id="reviews-inbox-entity-type-filter"
                  data-testid="reviews-inbox-entity-type-filter"
                  value={entityTypeFilter}
                  onChange={(e) =>
                    setEntityTypeFilter(e.target.value as EntityTypeFilter)
                  }
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                >
                  <option value="all">
                    {t("reviews.inbox.filterAllEntityTypes")}
                  </option>
                  <option value="CASE">
                    {t("reviews.inbox.filterEntityTypeCase")}
                  </option>
                  <option value="RUN">
                    {t("reviews.inbox.filterEntityTypeRun")}
                  </option>
                  <option value="SESSION">
                    {t("reviews.inbox.filterEntityTypeSession")}
                  </option>
                </select>
              </div>

              <div className="w-[240px]">
                <Label
                  htmlFor="reviews-inbox-project-filter"
                  className="text-xs text-muted-foreground"
                >
                  {t("reviews.inbox.filterProject")}
                </Label>
                <select
                  id="reviews-inbox-project-filter"
                  data-testid="reviews-inbox-project-filter"
                  value={
                    projectFilter === "all" ? "all" : String(projectFilter)
                  }
                  onChange={(e) => {
                    const next = e.target.value;
                    setProjectFilter(
                      next === "all" ? "all" : Number.parseInt(next, 10)
                    );
                  }}
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                >
                  <option value="all">
                    {t("reviews.inbox.filterAllProjects")}
                  </option>
                  {(projects ?? []).map((p: { id: number; name: string }) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Feature-disabled empty state (D-20 silent disable). */}
            {featureDisabled && (
              <div
                data-testid="reviews-inbox-feature-disabled"
                className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
              >
                {t("reviews.inbox.featureDisabled")}
              </div>
            )}

            {/* Empty state when no rows match (and feature is enabled). */}
            {!featureDisabled && tableData.length === 0 && (
              <div
                data-testid="reviews-inbox-empty"
                className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
              >
                {view === "pending"
                  ? t("reviews.inbox.empty")
                  : t("reviews.inbox.emptyDecided")}
              </div>
            )}

            {!featureDisabled && tableData.length > 0 && (
              // Three CSS layers on this wrapper — all opt-in via Tailwind
              // arbitrary variants so the shared `DataTable` component
              // stays untouched:
              //
              //   1. `[&_table]:table-fixed` — force `table-layout: fixed`
              //      so each `<td>`'s inline `width` (set from the column
              //      `size`) is treated as the actual rendered width. With
              //      the default `table-layout: auto`, long content (a
              //      verbose workflow-state name) would silently expand
              //      the column and break the truncation we've set up on
              //      the cell.
              //   2. `[&_td:has([data-transition-inner])]:border-e-transparent`
              //      hides the vertical column-divider on the From and
              //      Arrow cells so the From → Arrow → To sequence reads
              //      as a single transition expression instead of three
              //      split columns.
              //   3. `[&_tbody_tr]:h-12` pins every row at 48px so the
              //      Pending tab (taller — 32px decision icon-buttons in
              //      the Actions cell) and the Decided tab (shorter —
              //      just a Status badge) render at identical heights.
              //   4. `[&_table]:!w-auto` overrides DataTable's baked-in
              //      `w-full` on the inner `<Table>` so the table
              //      collapses to the sum of its column widths instead
              //      of stretching to the full browser viewport.
              <div className="[&_table]:table-fixed [&_table]:!w-auto [&_td:has([data-transition-inner])]:border-e-transparent [&_tbody_tr]:h-12">
                <DataTable
                  columns={columns as any}
                  data={tableData as any}
                  sortConfig={sortConfig}
                  onSortChange={handleSortChange}
                  columnVisibility={columnVisibility}
                  onColumnVisibilityChange={setColumnVisibility}
                  rowTestIdPrefix="reviews-inbox-row"
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {activeDialog &&
        (() => {
          const { row, decision } = activeDialog;
          const entityName =
            row.entityType === "CASE"
              ? (caseById.get(row.entityId)?.name ?? `CASE #${row.entityId}`)
              : row.entityType === "RUN"
                ? (testRunById.get(row.entityId)?.name ??
                  `RUN #${row.entityId}`)
                : (sessionById.get(row.entityId)?.name ??
                  `SESSION #${row.entityId}`);
          const shared = {
            reviewRequestId: row.id,
            open: true,
            onOpenChange: (open: boolean) => {
              if (!open) closeDialog();
            },
            entityType: row.entityType as ReviewableEntityType,
            entityName,
            targetState: row.toState as any,
            requesterUserId: row.requestedByUserId,
            onSuccess: () => handleDecisionSuccess(row),
          };
          if (decision === "APPROVED") return <ApproveDialog {...shared} />;
          if (decision === "CHANGES_REQUESTED")
            return <RequestChangesDialog {...shared} />;
          return <RejectDialog {...shared} />;
        })()}
    </main>
  );
}
