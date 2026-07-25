"use client";

import { DataTable } from "@/components/tables/DataTable";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { CirclePlay, Compass, Inbox } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import type { UserDashboardData } from "~/app/api/users/[userId]/dashboard/route";
import LoadingSpinner from "~/components/LoadingSpinner";
import { ProjectIcon } from "~/components/ProjectIcon";
import {
  PendingReviewEntity,
  usePendingReviewEntityMaps,
} from "~/components/reviews/PendingReviewsSummary";
import type { PendingReviewSummaryRequest } from "~/components/reviews/types";
import { SessionNameDisplay } from "~/components/SessionNameDisplay";
import { ProjectNameCell } from "~/components/tables/ProjectNameCell";
import { TestRunNameDisplay } from "~/components/TestRunNameDisplay";
import { usePendingReviewRequests } from "~/hooks/usePendingReviewRequests";
import { Link } from "~/lib/navigation";
import { toHumanReadable } from "~/utils/duration";

interface UserAssignmentsProps {
  userId: string;
}

type PendingRunGroup = {
  id: number;
  name: string;
  runId: number;
  runName: string;
  projectId: number;
  projectName: string;
  projectIconUrl: string | null;
  pendingCaseCount: number;
  totalSeconds: number;
};

type ActiveSessionRow = UserDashboardData["assignedSessions"][number] & {
  remainingSeconds: number;
};

type ReviewRow = PendingReviewSummaryRequest & { name: string };

type SortConfig = { column: string; direction: "asc" | "desc" };

/** Header-click cycle: same column toggles asc→desc, a new column starts asc. */
const cycleSort =
  (column: string) =>
  (prev: SortConfig): SortConfig =>
    prev.column === column && prev.direction === "asc"
      ? { column, direction: "desc" }
      : { column, direction: "asc" };

function sortRows<T>(
  rows: T[],
  sort: SortConfig,
  accessors: Record<string, (row: T) => string | number>
): T[] {
  const accessor = accessors[sort.column];
  if (!accessor) return rows;
  const dir = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    if (typeof av === "number" && typeof bv === "number") {
      return (av - bv) * dir;
    }
    return (
      String(av).localeCompare(String(bv), undefined, {
        numeric: true,
        sensitivity: "base",
      }) * dir
    );
  });
}

/** Project icon + linked name, the same composition ProjectListDisplay uses. */
function ProjectCell({
  projectId,
  name,
  iconUrl,
}: {
  projectId: number;
  name: string;
  iconUrl: string | null;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="max-w-4 max-h-4 shrink-0">
        <ProjectIcon iconUrl={iconUrl} width={16} height={16} />
      </div>
      <ProjectNameCell value={name} projectId={projectId} size="sm" />
    </div>
  );
}

/**
 * Compact profile-page rendering of the same data the home page's "Your
 * Assignments" card shows: pending review requests, open test run
 * assignments (grouped per run), and active sessions, each in a DataTable.
 * The server route this reads restricts non-self access to ADMIN (full) and
 * PROJECTADMIN (scoped to the viewer's accessible projects); the review queue
 * is policy-scoped by ZenStack, so each viewer only sees the rows they may
 * read.
 */
export function UserAssignments({ userId }: UserAssignmentsProps) {
  const t = useTranslations("users.profile.assignments");
  const tGlobal = useTranslations();
  const tDashboard = useTranslations("home.dashboard");
  const tReviewInbox = useTranslations("reviews.inbox");
  const locale = useLocale();

  const [reviewColumnVisibility, setReviewColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  const [runColumnVisibility, setRunColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  const [sessionColumnVisibility, setSessionColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  const [reviewSort, setReviewSort] = useState<SortConfig>({
    column: "name",
    direction: "asc",
  });
  const [runSort, setRunSort] = useState<SortConfig>({
    column: "name",
    direction: "asc",
  });
  const [sessionSort, setSessionSort] = useState<SortConfig>({
    column: "name",
    direction: "asc",
  });
  const handleReviewSortChange = useCallback(
    (column: string) => setReviewSort(cycleSort(column)),
    []
  );
  const handleRunSortChange = useCallback(
    (column: string) => setRunSort(cycleSort(column)),
    []
  );
  const handleSessionSortChange = useCallback(
    (column: string) => setSessionSort(cycleSort(column)),
    []
  );

  const { data, isLoading } = useQuery<UserDashboardData>({
    queryKey: ["userDashboard", userId],
    queryFn: async () => {
      const response = await fetch(`/api/users/${userId}/dashboard`);
      if (!response.ok) {
        throw new Error("Failed to fetch user dashboard data");
      }
      return response.json();
    },
    enabled: !!userId,
    staleTime: 30000,
  });

  const { requests: pendingReviews, isLoading: isLoadingReviews } =
    usePendingReviewRequests(userId);
  const { caseById, runById, sessionById } =
    usePendingReviewEntityMaps(pendingReviews);

  const reviewRows = useMemo<ReviewRow[]>(
    () =>
      pendingReviews.map((request) => ({
        ...request,
        name: `${request.entityType} #${request.entityId}`,
      })),
    [pendingReviews]
  );

  const pendingRuns = useMemo<PendingRunGroup[]>(() => {
    if (!data) return [];
    const byRun = new Map<number, PendingRunGroup>();
    for (const tc of data.testRunCasesAssigned) {
      if (tc.runIsCompleted) continue;
      const isPending =
        tc.latestResultStatusId === null ||
        tc.latestResultStatusId === data.untestedStatusId;
      if (!isPending) continue;
      let group = byRun.get(tc.testRunId);
      if (!group) {
        group = {
          id: tc.testRunId,
          name: tc.runName,
          runId: tc.testRunId,
          runName: tc.runName,
          projectId: tc.projectId,
          projectName: tc.projectName,
          projectIconUrl: tc.projectIconUrl,
          pendingCaseCount: 0,
          totalSeconds: 0,
        };
        byRun.set(tc.testRunId, group);
      }
      group.pendingCaseCount += 1;
      group.totalSeconds += tc.caseForecastManual ?? tc.caseEstimate ?? 0;
    }
    return [...byRun.values()];
  }, [data]);

  const activeSessions = useMemo<ActiveSessionRow[]>(() => {
    if (!data) return [];
    return data.assignedSessions.map((s) => ({
      ...s,
      remainingSeconds: Math.max(0, (s.estimate ?? 0) - s.totalElapsed),
    }));
  }, [data]);

  const totalWorkSeconds = useMemo(
    () =>
      pendingRuns.reduce((sum, run) => sum + run.totalSeconds, 0) +
      activeSessions.reduce((sum, s) => sum + s.remainingSeconds, 0),
    [pendingRuns, activeSessions]
  );

  const totalPendingCases = useMemo(
    () => pendingRuns.reduce((sum, run) => sum + run.pendingCaseCount, 0),
    [pendingRuns]
  );

  const sortedReviewRows = useMemo(
    () =>
      sortRows(reviewRows, reviewSort, {
        // Sort by the resolved entity name the row displays, falling back to
        // the `TYPE #id` label while the side-fetch is in flight.
        name: (r) => {
          const resolved =
            r.entityType === "CASE"
              ? caseById.get(r.entityId)?.name
              : r.entityType === "RUN"
                ? runById.get(r.entityId)?.name
                : sessionById.get(r.entityId)?.name;
          return resolved ?? r.name;
        },
        project: (r) => r.project?.name ?? "",
      }),
    [reviewRows, reviewSort, caseById, runById, sessionById]
  );

  const sortedRuns = useMemo(
    () =>
      sortRows(pendingRuns, runSort, {
        name: (r) => r.runName,
        project: (r) => r.projectName,
        pendingCaseCount: (r) => r.pendingCaseCount,
        totalSeconds: (r) => r.totalSeconds,
      }),
    [pendingRuns, runSort]
  );

  const sortedSessions = useMemo(
    () =>
      sortRows(activeSessions, sessionSort, {
        name: (s) => s.name,
        project: (s) => s.projectName,
        remainingSeconds: (s) => s.remainingSeconds,
      }),
    [activeSessions, sessionSort]
  );

  const formatDuration = useCallback(
    (seconds: number) =>
      toHumanReadable(seconds, {
        isSeconds: true,
        locale,
        units: ["d", "h", "m", "s"],
      }),
    [locale]
  );

  const reviewColumns = useMemo<ColumnDef<ReviewRow, unknown>[]>(
    () => [
      {
        id: "name",
        enableSorting: true,
        accessorKey: "name",
        header: tReviewInbox("columnEntity"),
        size: 400,
        cell: ({ row }) => (
          <PendingReviewEntity
            request={row.original}
            caseById={caseById}
            runById={runById}
            sessionById={sessionById}
          />
        ),
      },
      {
        id: "project",
        enableSorting: true,
        accessorKey: "projectId",
        header: tReviewInbox("columnProject"),
        size: 250,
        cell: ({ row }) =>
          row.original.project ? (
            <ProjectCell
              projectId={row.original.projectId}
              name={row.original.project.name}
              iconUrl={row.original.project.iconUrl ?? null}
            />
          ) : null,
      },
    ],
    [tReviewInbox, caseById, runById, sessionById]
  );

  const runColumns = useMemo<ColumnDef<PendingRunGroup, unknown>[]>(
    () => [
      {
        id: "name",
        enableSorting: true,
        accessorKey: "name",
        header: tGlobal("common.name"),
        size: 400,
        cell: ({ row }) => (
          <TestRunNameDisplay
            testRun={{ id: row.original.runId, name: row.original.runName }}
            projectId={row.original.projectId}
            className="truncate"
          />
        ),
      },
      {
        id: "project",
        enableSorting: true,
        accessorKey: "projectName",
        header: tGlobal("common.fields.project"),
        size: 250,
        cell: ({ row }) => (
          <ProjectCell
            projectId={row.original.projectId}
            name={row.original.projectName}
            iconUrl={row.original.projectIconUrl}
          />
        ),
      },
      {
        id: "pendingCaseCount",
        enableSorting: true,
        accessorKey: "pendingCaseCount",
        header: tGlobal("common.fields.testCases"),
        size: 110,
        cell: ({ row }) => (
          <div className="text-end">
            <Badge variant="outline">{row.original.pendingCaseCount}</Badge>
          </div>
        ),
      },
      {
        id: "totalSeconds",
        enableSorting: true,
        accessorKey: "totalSeconds",
        header: tGlobal("common.fields.estimate"),
        size: 140,
        cell: ({ row }) =>
          row.original.totalSeconds > 0
            ? formatDuration(row.original.totalSeconds)
            : null,
      },
    ],
    [tGlobal, formatDuration]
  );

  const sessionColumns = useMemo<ColumnDef<ActiveSessionRow, unknown>[]>(
    () => [
      {
        id: "name",
        enableSorting: true,
        accessorKey: "name",
        header: tGlobal("common.name"),
        size: 400,
        cell: ({ row }) => (
          <Link
            href={`/projects/sessions/${row.original.projectId}/${row.original.id}`}
            className="flex items-center gap-1 min-w-0 hover:underline"
          >
            <SessionNameDisplay session={row.original} className="truncate" />
          </Link>
        ),
      },
      {
        id: "project",
        enableSorting: true,
        accessorKey: "projectName",
        header: tGlobal("common.fields.project"),
        size: 250,
        cell: ({ row }) => (
          <ProjectCell
            projectId={row.original.projectId}
            name={row.original.projectName}
            iconUrl={row.original.projectIconUrl}
          />
        ),
      },
      {
        id: "remainingSeconds",
        enableSorting: true,
        accessorKey: "remainingSeconds",
        header: t("remaining"),
        size: 140,
        cell: ({ row }) =>
          row.original.remainingSeconds > 0
            ? formatDuration(row.original.remainingSeconds)
            : null,
      },
    ],
    [tGlobal, t, formatDuration]
  );

  if (isLoading) return <LoadingSpinner className="h-12" />;

  if (
    pendingRuns.length === 0 &&
    activeSessions.length === 0 &&
    pendingReviews.length === 0
  ) {
    // Reviews resolve after the dashboard fetch (feature flag → role ids →
    // rows); they only hold up the empty state, never existing content.
    if (isLoadingReviews) return <LoadingSpinner className="h-12" />;
    return (
      <p
        className="text-sm text-muted-foreground italic"
        data-testid="profile-assignments-empty"
      >
        {t("empty")}
      </p>
    );
  }

  return (
    <div className="space-y-6" data-testid="profile-assignments">
      {totalWorkSeconds > 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold">{tDashboard("totalWorkEffort")}</span>
          {formatDuration(totalWorkSeconds)}
        </p>
      )}

      {pendingReviews.length > 0 && (
        <div className="space-y-2" data-testid="profile-assignments-reviews">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold">
            <Inbox className="w-4 h-4 text-muted-foreground" />
            {t("reviews", { count: pendingReviews.length })}
          </h4>
          <DataTable
            columns={reviewColumns}
            data={sortedReviewRows}
            sortConfig={reviewSort}
            onSortChange={handleReviewSortChange}
            columnVisibility={reviewColumnVisibility}
            onColumnVisibilityChange={setReviewColumnVisibility}
            rowTestIdPrefix="profile-assignments-review"
          />
        </div>
      )}

      {pendingRuns.length > 0 && (
        <div className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold">
            <CirclePlay className="w-4 h-4 text-muted-foreground" />
            {t("pendingRuns", {
              count: pendingRuns.length,
              cases: totalPendingCases,
            })}
          </h4>
          <DataTable
            columns={runColumns}
            data={sortedRuns}
            sortConfig={runSort}
            onSortChange={handleRunSortChange}
            columnVisibility={runColumnVisibility}
            onColumnVisibilityChange={setRunColumnVisibility}
            rowTestIdPrefix="profile-assignments-run"
          />
        </div>
      )}

      {activeSessions.length > 0 && (
        <div className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold">
            <Compass className="w-4 h-4 text-muted-foreground" />
            {tDashboard("yourActiveSessions", {
              count: activeSessions.length,
            })}
          </h4>
          <DataTable
            columns={sessionColumns}
            data={sortedSessions}
            sortConfig={sessionSort}
            onSortChange={handleSessionSortChange}
            columnVisibility={sessionColumnVisibility}
            onColumnVisibilityChange={setSessionColumnVisibility}
            rowTestIdPrefix="profile-assignments-session"
          />
        </div>
      )}
    </div>
  );
}
