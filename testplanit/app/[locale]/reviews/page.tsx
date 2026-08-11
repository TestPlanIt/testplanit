"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Card, CardContent } from "@/components/ui/card";
import { PageCardHeader } from "@/components/ui/page-card-header";
import { Label } from "@/components/ui/label";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import {
  CheckCircle2,
  Compass,
  History,
  Inbox,
  ListChecks,
  MessageCircleWarning,
  PlayCircle,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

import { Loading } from "@/components/Loading";
import { DataTable } from "@/components/tables/DataTable";
import { CaseDetailsPanel } from "@/components/repositories/CaseDetailsPanel";
import { ProjectNameDisplay } from "~/components/search/ProjectNameDisplay";
import { UserNameCell } from "~/components/tables/UserNameCell";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "~/utils";
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
import { usePathname, useRouter } from "~/lib/navigation";

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

type EntityTypeValue = "CASE" | "RUN" | "SESSION";
type Decision = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

const DECIDED_STATUSES = ["APPROVED", "CHANGES_REQUESTED", "REJECTED"] as const;

/** Options per combobox page (matches the audit-logs filter pickers). */
const FILTER_PAGE_SIZE = 25;

/** Entity-type option icons — the same glyphs the app uses for a test
 *  case (TestCaseNameDisplay), a run (TestRunNameDisplay / project menu),
 *  and a session (project menu). */
const ENTITY_TYPE_ICONS: Record<EntityTypeValue, LucideIcon> = {
  CASE: ListChecks,
  RUN: PlayCircle,
  SESSION: Compass,
};

/** Status option icons + colors — mirrors ReviewDecisionBadge and the
 *  Pending tab's action buttons so the outcome color language matches. */
const STATUS_ICONS: Record<Decision, { icon: LucideIcon; className: string }> =
  {
    APPROVED: { icon: CheckCircle2, className: "text-emerald-500" },
    CHANGES_REQUESTED: {
      icon: MessageCircleWarning,
      className: "text-amber-500",
    },
    REJECTED: { icon: XCircle, className: "text-destructive" },
  };

/** Option shapes the filter comboboxes carry. Empty selection = "All". */
interface EntityTypeOption {
  value: EntityTypeValue;
  label: string;
}
interface ProjectOption {
  id: number;
  name: string;
  iconUrl?: string | null;
}
interface UserOption {
  id: string;
  name: string | null;
}
interface StatusOption {
  value: Decision;
  label: string;
}

/**
 * Slim row shape the filter-options query fetches — just enough to derive
 * which entity types / projects / requesters / deciders / statuses actually
 * occur in the current tab's scope, so no dropdown ever offers a choice
 * that would filter the table down to zero rows.
 */
interface ScopeOptionRow {
  entityType: EntityTypeValue;
  status: string;
  project: ProjectOption | null;
  requestedBy: UserOption | null;
  decidedBy: UserOption | null;
}

/** Case-insensitive contains-filter + pager for local combobox sources. */
function filterAndPage<T>(
  items: T[],
  query: string,
  page: number,
  pageSize: number,
  label: (item: T) => string
) {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter((item) => label(item).toLowerCase().includes(q))
    : items;
  return {
    results: filtered.slice(page * pageSize, page * pageSize + pageSize),
    total: filtered.length,
  };
}

/** Dedupe option objects by key, then sort by display label. */
function uniqueSorted<T>(
  items: (T | null | undefined)[],
  key: (item: T) => string | number,
  label: (item: T) => string
): T[] {
  const m = new Map<string | number, T>();
  for (const item of items) {
    if (item != null) m.set(key(item), item);
  }
  return [...m.values()].sort((a, b) => label(a).localeCompare(label(b)));
}

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
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { enabled: featureEnabled, isLoading: featureLoading } =
    useReviewFeatureEnabled();

  // Multi-select filters — empty array = "All". Each holds option objects
  // so the combobox chips render without a lookup.
  const [entityTypeFilter, setEntityTypeFilter] = useState<EntityTypeOption[]>(
    []
  );
  const [projectFilter, setProjectFilter] = useState<ProjectOption[]>([]);
  const [requesterFilter, setRequesterFilter] = useState<UserOption[]>([]);
  // Decided tab only — narrow the history to outcomes and/or deciders.
  // Both are ignored (and hidden) on the Pending tab, where every row is
  // PENDING and undecided by definition.
  const [decidedStatusFilter, setDecidedStatusFilter] = useState<
    StatusOption[]
  >([]);
  const [decidedByFilter, setDecidedByFilter] = useState<UserOption[]>([]);

  const router = useRouter();
  const pathName = usePathname();
  const searchParams = useSearchParams();

  // Tab state — Pending (queue I still need to act on) vs Decided
  // (history of what I've already approved / requested changes on /
  // rejected). The selection lives in the URL (`tab`; omitted = pending)
  // so a reload or shared link lands on the same tab. Per-tab sort
  // defaults differ: pending sorts oldest-first (most-overdue at the
  // top), decided sorts most-recently-decided first.
  const view: InboxView =
    searchParams.get("tab") === "decided" ? "decided" : "pending";

  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>(() =>
    view === "pending"
      ? { column: "requestedAt", direction: "asc" }
      : { column: "decidedAt", direction: "desc" }
  );
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

  // Explicit-direction sort from the header column menu; `null` (Remove sort)
  // restores the tab's default order.
  const handleSortColumn = (
    column: string,
    direction: "asc" | "desc" | null
  ) => {
    if (direction === null) {
      setSortConfig(
        view === "pending"
          ? { column: "requestedAt", direction: "asc" }
          : { column: "decidedAt", direction: "desc" }
      );
    } else {
      setSortConfig({ column, direction });
    }
  };

  const handleViewChange = (next: InboxView) => {
    // replace, not push — flipping tabs shouldn't stack history entries.
    const p = new URLSearchParams(searchParams.toString());
    if (next === "decided") p.set("tab", "decided");
    else p.delete("tab");
    const query = p.toString();
    router.replace(query ? `${pathName}?${query}` : pathName, {
      scroll: false,
    });
  };

  // Reset sort to the natural default for the tab so the column header
  // arrow makes sense after a switch. Keyed on `view` (not done in the
  // change handler) so Back/Forward-driven tab changes reset it too.
  useEffect(() => {
    setSortConfig(
      view === "pending"
        ? { column: "requestedAt", direction: "asc" }
        : { column: "decidedAt", direction: "desc" }
    );
  }, [view]);

  // Role IDs the viewer can be reached through as an assignee (global +
  // SPECIFIC_ROLE), flattened by the shared hook the header badge also uses.
  const currentUserRoleIds = useReviewAssigneeRoleIds(userId);

  // Base scope of the current tab — everything the tab can show BEFORE the
  // five UI filters narrow it. Shared by the rows query (which appends the
  // filter conditions) and the filter-options query below.
  const baseConditions = useMemo(
    (): any[] =>
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
            {
              OR: [{ decidedByUserId: userId }, { requestedByUserId: userId }],
            },
            { status: { in: DECIDED_STATUSES } },
            { isDeleted: false },
            { project: { reviewWorkflowEnabled: true } },
          ],
    [view, userId, currentUserRoleIds]
  );

  // --- Filter combobox option sources --------------------------------------
  // One slim query over the tab's base scope feeds every dropdown, so each
  // only offers values that actually occur in the rows the tab can show —
  // never a choice that would filter the table to zero. Deliberately NOT
  // narrowed by the active filters: the option lists stay stable while the
  // user composes a multi-select.
  const { data: scopeRowsData } = useClientQueries(
    schema
  ).reviewRequest.useFindMany(
    {
      where: { AND: baseConditions },
      select: {
        entityType: true,
        status: true,
        project: { select: { id: true, name: true, iconUrl: true } },
        requestedBy: { select: { id: true, name: true } },
        decidedBy: { select: { id: true, name: true } },
      },
    } as any,
    { enabled: featureEnabled === true } as any
  );
  const scopeRows = useMemo(
    () => (scopeRowsData ?? []) as unknown as ScopeOptionRow[],
    [scopeRowsData]
  );

  const entityTypeLabels = useMemo<Record<EntityTypeValue, string>>(
    () => ({
      CASE: t("reviews.inbox.filterEntityTypeCase"),
      RUN: t("reviews.inbox.filterEntityTypeRun"),
      SESSION: t("reviews.inbox.filterEntityTypeSession"),
    }),
    [t]
  );
  const statusLabels = useMemo<Record<Decision, string>>(
    () => ({
      APPROVED: t("comments.type.reviewDecision.approved"),
      CHANGES_REQUESTED: t("comments.type.reviewDecision.changesRequested"),
      REJECTED: t("comments.type.reviewDecision.rejected"),
    }),
    [t]
  );

  const entityTypeOptions = useMemo<EntityTypeOption[]>(() => {
    const present = new Set(scopeRows.map((r) => r.entityType));
    return (["CASE", "RUN", "SESSION"] as const)
      .filter((v) => present.has(v))
      .map((v) => ({ value: v, label: entityTypeLabels[v] }));
  }, [scopeRows, entityTypeLabels]);
  const statusOptions = useMemo<StatusOption[]>(() => {
    const present = new Set(scopeRows.map((r) => r.status));
    return DECIDED_STATUSES.filter((v) => present.has(v)).map((v) => ({
      value: v,
      label: statusLabels[v],
    }));
  }, [scopeRows, statusLabels]);
  const projectOptions = useMemo(
    () =>
      uniqueSorted(
        scopeRows.map((r) => r.project),
        (p) => p.id,
        (p) => p.name
      ),
    [scopeRows]
  );
  const userLabel = (u: UserOption) => u.name ?? u.id;
  const requesterOptions = useMemo(
    () =>
      uniqueSorted(
        scopeRows.map((r) => r.requestedBy),
        (u) => u.id,
        userLabel
      ),
    [scopeRows]
  );
  const deciderOptions = useMemo(
    () =>
      uniqueSorted(
        scopeRows.map((r) => r.decidedBy),
        (u) => u.id,
        userLabel
      ),
    [scopeRows]
  );

  // Stable fetchers (the combobox refetches when their identity changes,
  // i.e. when the scope data lands) — filter by the typed query, page for
  // the combobox footer.
  const fetchEntityTypeOptions = useCallback(
    async (query: string, page: number, pageSize: number) =>
      filterAndPage(entityTypeOptions, query, page, pageSize, (o) => o.label),
    [entityTypeOptions]
  );
  const fetchStatusOptions = useCallback(
    async (query: string, page: number, pageSize: number) =>
      filterAndPage(statusOptions, query, page, pageSize, (o) => o.label),
    [statusOptions]
  );
  const fetchProjectOptions = useCallback(
    async (query: string, page: number, pageSize: number) =>
      filterAndPage(projectOptions, query, page, pageSize, (p) => p.name),
    [projectOptions]
  );
  const fetchRequesterOptions = useCallback(
    async (query: string, page: number, pageSize: number) =>
      filterAndPage(requesterOptions, query, page, pageSize, userLabel),
    [requesterOptions]
  );
  const fetchDeciderOptions = useCallback(
    async (query: string, page: number, pageSize: number) =>
      filterAndPage(deciderOptions, query, page, pageSize, userLabel),
    [deciderOptions]
  );

  const whereClause = useMemo(() => {
    // Pending tab → PENDING + (I'm the direct assignee OR I hold one of
    // the assigned roles). Decided tab → rows I've decided PLUS decided
    // rows on reviews I requested, so a requester can see the outcome of
    // their own requests without hunting through each entity's comment
    // thread. The two scopes stay mutually exclusive (PENDING vs decided
    // statuses) so the queue and the history never double-count a row.
    //
    // Project-flag scoping (inside baseConditions): hide requests from
    // projects whose review workflow toggle is OFF. Stale rows persist in
    // the table (cancel + decide flips status; a project toggling its
    // review workflow off doesn't touch existing rows) so the filter has
    // to live at query time. The system-level kill switch short-circuits
    // the whole query via `enabled: featureEnabled === true` below.
    //
    // Each multi-select narrows with an `in` clause; empty = no clause
    // (= "All"). The Status selection replaces the decided tab's broad
    // three-status IN from baseConditions rather than stacking a second,
    // contradictory status condition.
    const conditions: any[] = baseConditions.map((c) =>
      c.status && view === "decided" && decidedStatusFilter.length > 0
        ? { status: { in: decidedStatusFilter.map((o) => o.value) } }
        : c
    );
    if (entityTypeFilter.length > 0) {
      conditions.push({
        entityType: { in: entityTypeFilter.map((o) => o.value) },
      });
    }
    if (projectFilter.length > 0) {
      conditions.push({ projectId: { in: projectFilter.map((o) => o.id) } });
    }
    if (requesterFilter.length > 0) {
      conditions.push({
        requestedByUserId: { in: requesterFilter.map((o) => o.id) },
      });
    }
    if (view === "decided" && decidedByFilter.length > 0) {
      conditions.push({
        decidedByUserId: { in: decidedByFilter.map((o) => o.id) },
      });
    }
    return { AND: conditions };
  }, [
    view,
    baseConditions,
    entityTypeFilter,
    projectFilter,
    requesterFilter,
    decidedStatusFilter,
    decidedByFilter,
  ]);

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
      case "transition":
        return { toStateId: dir };
      case "status":
        return { status: dir };
      case "decidedBy":
        return { decidedByUserId: dir };
      case "decidedAt":
        return { decidedAt: dir };
      case "requestedAt":
        return { createdAt: dir };
      default:
        return view === "decided" ? { decidedAt: dir } : { createdAt: dir };
    }
  }, [sortConfig, view]);

  const { data: rows, isLoading: isLoadingReviews } = useClientQueries(
    schema
  ).reviewRequest.useFindMany(
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
        decidedBy: { select: { id: true, name: true, image: true } },
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
      // Deleted entities stay in scope: a request can outlive its subject,
      // and the display components render a soft-deleted one properly.
      where: { id: { in: caseIds } },
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
      where: { id: { in: runIds } },
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
      where: { id: { in: sessionIds } },
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

  // --- Docked case-details panel ------------------------------------------
  // Clicking a CASE row's name opens the case in a panel beside the queue —
  // the same affordance the repository list has — instead of navigating away,
  // so a reviewer never loses the inbox (or its tab, filters and scroll
  // position) to look at what they're being asked to approve. The selection
  // lives in the URL (`case` + `caseProject`; the inbox spans projects, so the
  // case id alone isn't enough) so the panel survives a reload, is linkable,
  // and closes on Back.
  const caseParam = searchParams.get("case");
  const caseProjectParam = searchParams.get("caseProject");
  const selectedCaseId = caseParam && caseProjectParam ? caseParam : null;
  const selectedCaseProjectId = selectedCaseId ? caseProjectParam : null;

  const setCaseParams = useCallback(
    (
      next: { caseId: number; projectId: number } | null,
      mode: "push" | "replace"
    ) => {
      const p = new URLSearchParams(searchParams.toString());
      if (next) {
        p.set("case", String(next.caseId));
        p.set("caseProject", String(next.projectId));
      } else {
        p.delete("case");
        p.delete("caseProject");
      }
      const query = p.toString();
      const url = query ? `${pathName}?${query}` : pathName;
      if (mode === "push") router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [searchParams, pathName, router]
  );

  // push on open so Back closes the panel; replace on close / step so the
  // history doesn't fill up with one entry per case looked at.
  const openCase = useCallback(
    (caseId: number, projectId: number) =>
      setCaseParams({ caseId, projectId }, "push"),
    [setCaseParams]
  );
  const goToCase = useCallback(
    (caseId: number, projectId: number) =>
      setCaseParams({ caseId, projectId }, "replace"),
    [setCaseParams]
  );
  const closeDetails = useCallback(
    () => setCaseParams(null, "replace"),
    [setCaseParams]
  );

  const columns = useColumns({
    t,
    view,
    actions,
    caseById,
    testRunById,
    sessionById,
    onOpenCase: openCase,
  });

  // DataTable's `DataRow` shape requires every row to carry `id` + `name`.
  // Synthesize a short label per row — it's only used by DataTable's internal
  // drag/scroll plumbing, not by anything we render.
  const tableData: InboxTableRow[] = useMemo(
    () =>
      inboxRows
        .filter((r) => {
          const entity =
            r.entityType === "CASE"
              ? caseById.get(r.entityId)
              : r.entityType === "RUN"
                ? testRunById.get(r.entityId)
                : sessionById.get(r.entityId);
          // Hide only once the entity has loaded and reports deleted. Treating
          // an unresolved id as deleted would blank the table while the
          // side-fetches are still in flight.
          return entity?.isDeleted !== true;
        })
        .map((r) => ({
          ...r,
          name: `${r.entityType} #${r.entityId}`,
        })),
    [inboxRows, caseById, testRunById, sessionById]
  );

  // Prev/next steps through the CASE rows of the current tab in the order
  // they're listed, skipping RUN/SESSION rows (no panel exists for those).
  const caseNavItems = useMemo(
    () =>
      tableData
        .filter((r) => r.entityType === "CASE")
        .map((r) => ({
          reviewId: r.id,
          caseId: r.entityId,
          projectId: r.projectId,
        })),
    [tableData]
  );
  const selectedNavIndex = selectedCaseId
    ? caseNavItems.findIndex(
        (i) =>
          String(i.caseId) === selectedCaseId &&
          String(i.projectId) === selectedCaseProjectId
      )
    : -1;
  // The open case isn't always in the list (its row can leave the queue once
  // decided, or on a tab/filter change) — a null position hides the stepper
  // rather than showing a bogus "3 of 7".
  const navPosition = selectedNavIndex >= 0 ? selectedNavIndex + 1 : null;
  const prevNavItem =
    selectedNavIndex > 0 ? caseNavItems[selectedNavIndex - 1] : null;
  const nextNavItem =
    selectedNavIndex >= 0 ? (caseNavItems[selectedNavIndex + 1] ?? null) : null;
  // Highlight the row the panel is showing. DataTable matches on the row id,
  // which here is the ReviewRequest id, not the case id.
  const selectedRowId =
    selectedNavIndex >= 0 ? caseNavItems[selectedNavIndex].reviewId : null;

  // Full-width takeover — the panel can swallow the list (toggle in its
  // header), and does so automatically on narrow viewports where a split
  // leaves neither side usable. Mirrors the repository details panel.
  const listPanelRef = useRef<PanelImperativeHandle>(null);
  const [detailsFullWidth, setDetailsFullWidth] = useState(false);
  const [isNarrowForDetails, setIsNarrowForDetails] = useState(false);
  const effectiveFullWidth =
    !!selectedCaseId && (detailsFullWidth || isNarrowForDetails);

  useEffect(() => {
    try {
      setDetailsFullWidth(
        window.localStorage.getItem("reviews-details-fullwidth") === "1"
      );
    } catch {
      /* ignore private-mode / quota */
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        "reviews-details-fullwidth",
        detailsFullWidth ? "1" : "0"
      );
    } catch {
      /* ignore */
    }
  }, [detailsFullWidth]);

  useEffect(() => {
    const check = () => setIsNarrowForDetails(window.innerWidth < 1200);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // collapse()/expand() rather than unmounting the list panel so a
  // user-dragged split ratio survives the round trip.
  useEffect(() => {
    const panel = listPanelRef.current;
    if (!panel) return;
    if (effectiveFullWidth) {
      if (!panel.isCollapsed()) panel.collapse();
    } else if (panel.isCollapsed()) {
      panel.expand();
    }
  }, [effectiveFullWidth]);

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
        <PageCardHeader
          className="w-full"
          title={
            <span data-testid="reviews-inbox-page-title">
              {t("reviews.inbox.pageTitle")}
            </span>
          }
          helpKey="reviews"
        />
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

            {/* Filters row — searchable multi-select comboboxes; an empty
                selection means "All". Option lists are derived from the
                current tab's scope, so nothing offered can zero the table.
                Wrapper divs carry the test ids because the combobox
                trigger is an internal button. */}
            <div className="flex flex-wrap items-end gap-4">
              <div
                className="w-[200px]"
                data-testid="reviews-inbox-entity-type-filter"
              >
                <Label className="text-xs text-muted-foreground">
                  {t("reviews.inbox.filterEntityType")}
                </Label>
                <MultiAsyncCombobox<EntityTypeOption>
                  value={entityTypeFilter}
                  onValueChange={setEntityTypeFilter}
                  fetchOptions={fetchEntityTypeOptions}
                  renderOption={(o) => {
                    const Icon = ENTITY_TYPE_ICONS[o.value];
                    return (
                      <span className="flex min-w-0 items-center gap-2">
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{o.label}</span>
                      </span>
                    );
                  }}
                  getOptionValue={(o) => o.value}
                  getOptionLabel={(o) => o.label}
                  placeholder={t("reviews.inbox.filterAllEntityTypes")}
                  ariaLabel={t("reviews.inbox.filterEntityType")}
                  className="mt-1"
                  pageSize={FILTER_PAGE_SIZE}
                />
              </div>

              <div
                className="w-[240px]"
                data-testid="reviews-inbox-project-filter"
              >
                <Label className="text-xs text-muted-foreground">
                  {t("reviews.inbox.filterProject")}
                </Label>
                <MultiAsyncCombobox<ProjectOption>
                  value={projectFilter}
                  onValueChange={setProjectFilter}
                  fetchOptions={fetchProjectOptions}
                  renderOption={(p) => (
                    <ProjectNameDisplay
                      projectName={p.name}
                      projectId={p.id}
                      iconUrl={p.iconUrl}
                      fitContainer
                    />
                  )}
                  getOptionValue={(p) => p.id}
                  getOptionLabel={(p) => p.name}
                  placeholder={t("reviews.inbox.filterAllProjects")}
                  ariaLabel={t("reviews.inbox.filterProject")}
                  className="mt-1"
                  pageSize={FILTER_PAGE_SIZE}
                />
              </div>

              <div
                className="w-[240px]"
                data-testid="reviews-inbox-requester-filter"
              >
                <Label className="text-xs text-muted-foreground">
                  {t("reviews.inbox.filterRequester")}
                </Label>
                <MultiAsyncCombobox<UserOption>
                  value={requesterFilter}
                  onValueChange={setRequesterFilter}
                  fetchOptions={fetchRequesterOptions}
                  renderOption={(u) => <UserNameCell userId={u.id} hideLink />}
                  renderSelectedOption={(u) => <span>{userLabel(u)}</span>}
                  getOptionValue={(u) => u.id}
                  getOptionLabel={userLabel}
                  placeholder={t("reviews.inbox.filterAllRequesters")}
                  ariaLabel={t("reviews.inbox.filterRequester")}
                  className="mt-1"
                  pageSize={FILTER_PAGE_SIZE}
                />
              </div>

              {/* Decider + outcome filters — Decided tab only; the Pending
                  queue is all PENDING and undecided, so neither applies.
                  Ordered to mirror the Decided tab's column order
                  (… Decided by → … → Status). */}
              {view === "decided" && (
                <>
                  <div
                    className="w-[240px]"
                    data-testid="reviews-inbox-decided-by-filter"
                  >
                    <Label className="text-xs text-muted-foreground">
                      {t("reviews.inbox.filterDecidedBy")}
                    </Label>
                    <MultiAsyncCombobox<UserOption>
                      value={decidedByFilter}
                      onValueChange={setDecidedByFilter}
                      fetchOptions={fetchDeciderOptions}
                      renderOption={(u) => (
                        <UserNameCell userId={u.id} hideLink />
                      )}
                      renderSelectedOption={(u) => <span>{userLabel(u)}</span>}
                      getOptionValue={(u) => u.id}
                      getOptionLabel={userLabel}
                      placeholder={t("reviews.inbox.filterAllDeciders")}
                      ariaLabel={t("reviews.inbox.filterDecidedBy")}
                      className="mt-1"
                      pageSize={FILTER_PAGE_SIZE}
                    />
                  </div>

                  <div
                    className="w-[200px]"
                    data-testid="reviews-inbox-status-filter"
                  >
                    <Label className="text-xs text-muted-foreground">
                      {t("reviews.inbox.filterStatus")}
                    </Label>
                    <MultiAsyncCombobox<StatusOption>
                      value={decidedStatusFilter}
                      onValueChange={setDecidedStatusFilter}
                      fetchOptions={fetchStatusOptions}
                      renderOption={(o) => {
                        const { icon: Icon, className } = STATUS_ICONS[o.value];
                        return (
                          <span className="flex min-w-0 items-center gap-2">
                            <Icon
                              className={cn("h-4 w-4 shrink-0", className)}
                            />
                            <span className="truncate">{o.label}</span>
                          </span>
                        );
                      }}
                      getOptionValue={(o) => o.value}
                      getOptionLabel={(o) => o.label}
                      placeholder={t("reviews.inbox.filterAllStatuses")}
                      ariaLabel={t("reviews.inbox.filterStatus")}
                      className="mt-1"
                      pageSize={FILTER_PAGE_SIZE}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Row count, matching the other virtualized list pages. The
                inbox loads its full result set, so loaded always equals
                total. */}
            {!featureDisabled && !isLoadingReviews && tableData.length > 0 && (
              <p className="mt-1 text-end text-sm text-muted-foreground">
                {t("admin.auditLogs.showing", {
                  loaded: tableData.length.toLocaleString(locale),
                  total: tableData.length.toLocaleString(locale),
                })}
              </p>
            )}

            {/* Feature-disabled empty state (D-20 silent disable). */}
            {featureDisabled && (
              <div
                data-testid="reviews-inbox-feature-disabled"
                className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
              >
                {t("reviews.inbox.featureDisabled")}
              </div>
            )}

            {/* Queue on the left, docked case details on the right. The group
                renders whether or not a case is open so opening one doesn't
                remount the table (and lose its column sizing / scroll). */}
            {!featureDisabled && (
              <ResizablePanelGroup
                direction="horizontal"
                autoSaveId="reviews-details-split"
                className="w-full min-w-0"
                data-testid="reviews-inbox-layout"
              >
                <ResizablePanel
                  order={1}
                  ref={listPanelRef}
                  collapsible
                  collapsedSize={0}
                  defaultSize={56}
                  minSize={30}
                  className="min-w-0"
                  data-testid="reviews-list-pane"
                >
                  {/* Loading first — the empty copy must not flash while the
                      query is still in flight. */}
                  {isLoadingReviews ? (
                    <Loading />
                  ) : tableData.length === 0 ? (
                    <div
                      data-testid="reviews-inbox-empty"
                      className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
                    >
                      {view === "pending"
                        ? t("reviews.inbox.empty")
                        : t("reviews.inbox.emptyDecided")}
                    </div>
                  ) : (
                    <DataTable
                      virtualized
                      fillViewport
                      // The engine seeds `meta.isPinned` once per mount, and the
                      // tabs pin a different trailing column (Actions vs Status).
                      // Returning to a tab with cached rows never unmounts it, so
                      // without this key it keeps the other tab's pin.
                      key={view}
                      columns={columns as any}
                      data={tableData as any}
                      sortConfig={sortConfig}
                      onSortChange={handleSortChange}
                      onSortColumn={handleSortColumn}
                      columnVisibility={columnVisibility}
                      onColumnVisibilityChange={setColumnVisibility}
                      estimateSize={48}
                      // The result-set scope is exactly the where clause (tab +
                      // every filter), so its serialization is the signal that
                      // the list should scroll back to the top.
                      resetKey={JSON.stringify(whereClause)}
                      columnSizingStorageKey="reviews-inbox"
                      testIdPrefix="reviews-inbox-table"
                      rowTestIdPrefix="reviews-inbox-row"
                      // Highlight (without scrolling) the row the details panel
                      // is showing; the row id is the ReviewRequest id.
                      highlightRowId={selectedRowId}
                    />
                  )}
                </ResizablePanel>

                {selectedCaseId && selectedCaseProjectId && (
                  <>
                    <ResizableHandle
                      withHandle
                      id="reviews-details-resize-handle"
                      className={cn("mx-1", effectiveFullWidth && "hidden")}
                    />
                    <ResizablePanel
                      order={2}
                      defaultSize={44}
                      minSize={28}
                      className="h-full min-w-0"
                      data-testid="reviews-details-pane"
                    >
                      <CaseDetailsPanel
                        caseId={selectedCaseId}
                        projectId={selectedCaseProjectId}
                        fullWidth={effectiveFullWidth}
                        onToggleFullWidth={() => setDetailsFullWidth((v) => !v)}
                        onClose={closeDetails}
                        onPrev={() =>
                          prevNavItem &&
                          goToCase(prevNavItem.caseId, prevNavItem.projectId)
                        }
                        onNext={() =>
                          nextNavItem &&
                          goToCase(nextNavItem.caseId, nextNavItem.projectId)
                        }
                        hasPrev={!!prevNavItem}
                        hasNext={!!nextNavItem}
                        position={navPosition}
                        total={caseNavItems.length}
                      />
                    </ResizablePanel>
                  </>
                )}
              </ResizablePanelGroup>
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
