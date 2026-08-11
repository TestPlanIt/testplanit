"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useDebounce } from "@/components/Debounce";
import { ProjectIcon } from "@/components/ProjectIcon";
import { Filter } from "@/components/tables/Filter";
import { DataTable } from "@/components/tables/DataTable";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/typography";
import { HelpPopover } from "@/components/ui/help-popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { VisibilityState } from "@tanstack/react-table";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loading } from "~/components/Loading";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useRouter } from "~/lib/navigation";
import { ExtendedIssues, useIssueColumns } from "./columns";

const PAGE_SIZE = 50;

// Count columns are computed via a separate join call and can't be sorted
// across pages without the full set in hand. Sorting by one fetches everything
// once and renders it through the same virtualized table in full-set mode;
// every other column is a real DB column and drives a genuine infinite fetch.
const COUNT_SORT_COLUMNS = ["cases", "testRuns", "sessions", "milestones"];

export default function ProjectIssueList() {
  return <ProjectIssues />;
}

function ProjectIssues() {
  const locale = useLocale();
  const t = useTranslations();
  const { session, isLoading: isAuthLoading } = useRequireAuth();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.projectId ? Number(params.projectId) : null;
  const targetIssueId = searchParams.get("issueId");
  // Live issue updates are subscribed at the IssuesDisplay component level —
  // every issue badge on this page registers a refcounted listener via the
  // singleton SSE manager, so every page that renders issues gets live refresh
  // "for free."

  const { data: project } = useClientQueries(schema).projects.useFindFirst(
    {
      where: {
        id: projectId ?? -1,
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        iconUrl: true,
      },
    },
    {
      enabled: !!projectId && !isAuthLoading,
    }
  );

  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({
    column: "name",
    direction: "asc",
  });
  const [searchString, setSearchString] = useState("");
  const debouncedSearchString = useDebounce(searchString, 500);

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [priorityFilter, setPriorityFilter] = useState<string>("");

  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  // Build project filter for groupBy queries
  const projectFilterForGroupBy = useMemo(() => {
    if (projectId === null) return {};
    return {
      OR: [
        { projectId },
        // Exclude issues linked only to a soft-deleted case — they must not
        // surface in the project list. Mirrors the global issues list filter.
        { caseIssues: { some: { case: { projectId, isDeleted: false } } } },
        { sessions: { some: { projectId } } },
        { testRuns: { some: { projectId } } },
        { sessionResults: { some: { session: { projectId } } } },
        { testRunResults: { some: { testRun: { projectId } } } },
        {
          testRunStepResults: {
            some: { testRunResult: { testRun: { projectId } } },
          },
        },
      ],
    };
  }, [projectId]);

  // Fetch distinct status values for the filter dropdown (scoped to this project)
  const { data: statusOptions } = useClientQueries(schema).issue.useGroupBy(
    {
      by: ["status"],
      where: { isDeleted: false, ...projectFilterForGroupBy },
      orderBy: { status: "asc" },
    },
    {
      enabled: !!session?.user && projectId !== null,
    }
  );

  // Fetch distinct priority values for the filter dropdown (scoped to this project)
  const { data: priorityOptions } = useClientQueries(schema).issue.useGroupBy(
    {
      by: ["priority"],
      where: { isDeleted: false, ...projectFilterForGroupBy },
      orderBy: { priority: "asc" },
    },
    {
      enabled: !!session?.user && projectId !== null,
    }
  );

  // Extract unique non-null values, combining options with mismatched casing
  const statuses = useMemo(() => {
    if (!statusOptions) return [];
    const seen = new Map<string, string>();
    statusOptions
      .map((item) => item.status)
      .filter((s): s is string => s !== null && s.trim() !== "")
      .forEach((s) => {
        const lower = s.toLowerCase();
        if (!seen.has(lower)) {
          seen.set(lower, s);
        }
      });
    return Array.from(seen.values()).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
  }, [statusOptions]);

  const priorities = useMemo(() => {
    if (!priorityOptions) return [];
    const seen = new Map<string, string>();
    priorityOptions
      .map((item) => item.priority)
      .filter((p): p is string => p !== null && p.trim() !== "")
      .forEach((p) => {
        const lower = p.toLowerCase();
        if (!seen.has(lower)) {
          seen.set(lower, p);
        }
      });
    return Array.from(seen.values()).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
  }, [priorityOptions]);

  // Build search filter for name, title, and description
  const searchFilter = useMemo(() => {
    if (!debouncedSearchString.trim()) {
      return {};
    }

    const searchTerm = debouncedSearchString.trim();
    return {
      OR: [
        {
          name: {
            contains: searchTerm,
            mode: "insensitive" as const,
          },
        },
        {
          title: {
            contains: searchTerm,
            mode: "insensitive" as const,
          },
        },
        {
          description: {
            contains: searchTerm,
            mode: "insensitive" as const,
          },
        },
      ],
    };
  }, [debouncedSearchString]);

  // Build the where clause for issues in this project
  const issuesWhere = useMemo(() => {
    if (projectId === null) {
      return null;
    }

    const projectFilter = {
      OR: [
        { projectId },
        // Exclude issues linked only to a soft-deleted case — they must not
        // surface in the project list. Mirrors the global issues list filter.
        { caseIssues: { some: { case: { projectId, isDeleted: false } } } },
        { sessions: { some: { projectId } } },
        { testRuns: { some: { projectId } } },
        {
          sessionResults: {
            some: { session: { projectId } },
          },
        },
        {
          testRunResults: {
            some: { testRun: { projectId } },
          },
        },
        {
          testRunStepResults: {
            some: {
              testRunResult: { testRun: { projectId } },
            },
          },
        },
      ],
    };

    // Combine search filter and project filter using AND
    const conditions: Array<Record<string, unknown>> = [
      { isDeleted: false },
      projectFilter,
    ];

    // Add search filter if present
    if (searchFilter.OR) {
      conditions.push(searchFilter);
    }

    // Add status filter if selected (case-insensitive)
    if (statusFilter) {
      conditions.push({
        status: { equals: statusFilter, mode: "insensitive" as const },
      });
    }

    // Add priority filter if selected (case-insensitive)
    if (priorityFilter) {
      conditions.push({
        priority: { equals: priorityFilter, mode: "insensitive" as const },
      });
    }

    return {
      AND: conditions,
    };
  }, [projectId, searchFilter, statusFilter, priorityFilter]);

  const isCountSort = COUNT_SORT_COLUMNS.includes(sortConfig.column);
  // A deep link (?issueId=) also fetches the full set so the target row is
  // present to scroll to and highlight — otherwise it might live beyond the
  // pages loaded so far.
  const isFullSet = isCountSort || !!targetIssueId;

  const orderBy = useMemo(() => {
    // Only apply server-side sorting for database columns; count columns
    // (cases, testRuns, sessions) sort client-side over the full set.
    if (
      ["name", "title", "status", "priority", "lastSyncedAt"].includes(
        sortConfig.column
      )
    ) {
      return { [sortConfig.column]: sortConfig.direction } as const;
    }
    return { name: "asc" as const };
  }, [sortConfig]);

  const include = useMemo(
    () => ({
      integration: {
        select: {
          id: true,
          provider: true,
          name: true,
          settings: true,
        },
      },
    }),
    []
  );

  const infiniteBaseArgs = useMemo(
    () => ({
      where: issuesWhere ?? undefined,
      orderBy,
      include,
      take: PAGE_SIZE,
    }),
    [issuesWhere, orderBy, include]
  );

  const {
    data: infinitePages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: isLoadingInfinite,
  } = useClientQueries(schema).issue.useInfiniteFindMany(infiniteBaseArgs, {
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length < PAGE_SIZE) return undefined;
      return { ...infiniteBaseArgs, skip: allPages.flat().length };
    },
    enabled:
      !!issuesWhere && !!session?.user && projectId !== null && !isFullSet,
  });

  const { data: allIssues, isLoading: isLoadingAll } = useClientQueries(
    schema
  ).issue.useFindMany(
    issuesWhere ? { where: issuesWhere, orderBy, include } : undefined,
    {
      enabled:
        !!issuesWhere && !!session?.user && projectId !== null && isFullSet,
    }
  );

  const issues = useMemo(() => {
    if (isFullSet) return allIssues ?? [];
    return infinitePages?.pages.flat() ?? [];
  }, [isFullSet, infinitePages, allIssues]);

  const isLoadingIssues = isFullSet ? isLoadingAll : isLoadingInfinite;

  // Get total count of issues
  const { data: issuesCount } = useClientQueries(schema).issue.useCount(
    issuesWhere
      ? {
          where: issuesWhere,
        }
      : undefined,
    {
      enabled: !!issuesWhere && !!session?.user,
    }
  );

  // Counts fetched separately and cached per issue id for the life of the page
  // (project-scoped, so once fetched they never need re-requesting as the
  // infinite list appends new ids).
  const [issueCounts, setIssueCounts] = useState<
    Record<
      number,
      {
        repositoryCases: number;
        sessions: number;
        testRuns: number;
        milestones: number;
      }
    >
  >({});
  const [isLoadingCounts, setIsLoadingCounts] = useState(false);
  const fetchedIssueIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!issues || issues.length === 0 || projectId === null) {
      setIssueCounts({});
      setIsLoadingCounts(false);
      fetchedIssueIdsRef.current = new Set();
      return;
    }

    const newIds = issues
      .map((i) => i.id)
      .filter((id) => !fetchedIssueIdsRef.current.has(id));
    if (newIds.length === 0) return;
    newIds.forEach((id) => fetchedIssueIdsRef.current.add(id));

    const fetchCounts = async () => {
      setIsLoadingCounts(true);
      try {
        // For project-scoped issues, we fetch counts scoped to this project
        const response = await fetch("/api/issues/counts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ issueIds: newIds, projectId }),
        });

        if (response.ok) {
          const data = await response.json();
          setIssueCounts((prev) => ({ ...prev, ...(data.counts || {}) }));
        }
      } catch (error) {
        console.error("Failed to fetch issue counts:", error);
      } finally {
        setIsLoadingCounts(false);
      }
    };

    void fetchCounts();
  }, [issues, projectId]);

  // Map issues with counts
  const mappedIssues = useMemo(() => {
    if (!issues) {
      return [];
    }

    const mapped = issues.map((issue): ExtendedIssues => {
      const counts = issueCounts[issue.id];

      return {
        ...issue,
        repositoryCases: [],
        sessions: [],
        testRuns: [],
        aggregatedTestRunIds: [],
        projectIds: projectId ? [projectId] : [],
        repositoryCasesCount: counts?.repositoryCases,
        sessionsCount: counts?.sessions,
        testRunsCount: counts?.testRuns,
        milestonesCount: counts?.milestones,
      };
    });

    // Apply client-side sorting for count columns (since these aren't in the DB)
    if (isCountSort) {
      return mapped.sort((a, b) => {
        let aValue: number;
        let bValue: number;

        switch (sortConfig.column) {
          case "cases":
            aValue = a.repositoryCasesCount ?? 0;
            bValue = b.repositoryCasesCount ?? 0;
            break;
          case "testRuns":
            aValue = a.testRunsCount ?? 0;
            bValue = b.testRunsCount ?? 0;
            break;
          case "sessions":
            aValue = a.sessionsCount ?? 0;
            bValue = b.sessionsCount ?? 0;
            break;
          case "milestones":
            aValue = a.milestonesCount ?? 0;
            bValue = b.milestonesCount ?? 0;
            break;
          default:
            return 0;
        }

        return sortConfig.direction === "asc"
          ? aValue - bValue
          : bValue - aValue;
      });
    }

    return mapped;
  }, [issues, issueCounts, projectId, sortConfig, isCountSort]);

  useEffect(() => {
    if (!isAuthLoading && !session) {
      router.push("/");
    }
  }, [isAuthLoading, session, router]);

  // Determine if the project only has SIMPLE_URL integrations so we can hide
  // columns that would always be empty (description, status, priority, lastSyncedAt).
  const { data: projectIntegrations } = useClientQueries(
    schema
  ).projectIntegration.useFindMany(
    {
      where: { projectId: projectId ?? -1, isActive: true },
      include: { integration: { select: { provider: true } } },
    },
    { enabled: !!projectId && !isAuthLoading }
  );
  const hasIntegrations = (projectIntegrations?.length ?? 0) > 0;
  const onlySimpleUrl =
    hasIntegrations &&
    (projectIntegrations as any[]).every(
      (pi) => pi.integration?.provider === "SIMPLE_URL"
    );

  const columns = useIssueColumns({
    translations: {
      name: t("common.name"),
      title: t("common.fields.title"),
      description: t("common.fields.description"),
      status: t("common.actions.status"),
      priority: t("common.fields.priority"),
      lastSyncedAt: t("common.fields.lastSyncedAt"),
      testCases: t("common.fields.testCases"),
      sessions: t("common.fields.sessions"),
      testRuns: t("common.fields.testRuns"),
      milestones: t("common.fields.milestones"),
      integration: t("common.fields.integration"),
    },
    isLoadingCounts,
    hideSyncedFields: onlySimpleUrl,
  });

  if (projectId === null && !isAuthLoading) {
    console.error("Project ID is missing from URL parameters.");
    return <div>{t("common.errors.somethingWentWrong")}</div>;
  }

  if (isAuthLoading || !issuesWhere) {
    return <Loading />;
  }

  if (!session || !session.user) {
    return <div>{t("common.errors.sessionNotFound")}</div>;
  }

  const handleSortChange = (column: string) => {
    const direction =
      sortConfig &&
      sortConfig.column === column &&
      sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
  };

  // Explicit-direction sort from the header column menu; `null` (Remove sort)
  // restores the default order.
  const handleSortColumn = (
    column: string,
    direction: "asc" | "desc" | null
  ) => {
    if (direction === null) {
      setSortConfig({ column: "name", direction: "asc" });
    } else {
      setSortConfig({ column, direction });
    }
  };

  return (
    <main>
      <Card>
        <CardHeader id="issues-page-header" className="w-full">
          <SectionHeader className="flex items-center gap-2">
            <CardTitle>{t("common.fields.issues")}</CardTitle>
            <HelpPopover helpKey="projectIssues" />
          </SectionHeader>
          <CardDescription>
            <span className="flex items-center gap-2">
              <ProjectIcon iconUrl={project?.iconUrl} />
              {project?.name}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start justify-between gap-4">
            <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
              <div className="flex items-center gap-2 text-muted-foreground w-full flex-wrap">
                <Filter
                  key="issue-filter"
                  placeholder={t("Pages.Issues.filterPlaceholder")}
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                />
                <Select
                  value={statusFilter}
                  onValueChange={(value) =>
                    setStatusFilter(value === "all" ? "" : value)
                  }
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder={t("common.actions.status")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {t("common.filters.allStatuses")}
                    </SelectItem>
                    {statuses.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={priorityFilter}
                  onValueChange={(value) =>
                    setPriorityFilter(value === "all" ? "" : value)
                  }
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder={t("common.fields.priority")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {t("common.filters.allPriorities")}
                    </SelectItem>
                    {priorities.map((priority) => (
                      <SelectItem key={priority} value={priority}>
                        {priority}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {mappedIssues.length > 0 && (
              <p className="text-sm text-muted-foreground shrink-0">
                {t("admin.auditLogs.showing", {
                  loaded: mappedIssues.length.toLocaleString(locale),
                  total: (issuesCount ?? mappedIssues.length).toLocaleString(
                    locale
                  ),
                })}
              </p>
            )}
          </div>
          <div className="mt-4 w-full">
            <DataTable
              virtualized
              columns={columns as any}
              data={mappedIssues as any}
              onSortChange={handleSortChange}
              onSortColumn={handleSortColumn}
              sortConfig={sortConfig}
              isLoading={isLoadingIssues || isFetchingNextPage}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              hasMore={isFullSet ? false : !!hasNextPage}
              onLoadMore={fetchNextPage}
              estimateSize={60}
              fillViewport
              scrollToRowId={targetIssueId}
              highlightRowId={targetIssueId}
              resetKey={`${debouncedSearchString}|${statusFilter}|${priorityFilter}|${sortConfig.column}|${sortConfig.direction}`}
              testIdPrefix="issues-table"
              rowTestIdPrefix="issue-row"
            />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
