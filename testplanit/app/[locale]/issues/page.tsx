"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useDebounce } from "@/components/Debounce";
import { Filter } from "@/components/tables/Filter";
import { DataTable } from "@/components/tables/DataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "~/lib/navigation";
import { ExtendedIssues, useIssueColumns } from "./columns";

const PAGE_SIZE = 50;

// Count columns are computed via a separate join call and can't be sorted
// across pages without the full set in hand. Sorting by one fetches everything
// once and renders it through the same virtualized table in full-set mode;
// every other column is a real DB column and drives a genuine infinite fetch.
const COUNT_SORT_COLUMNS = [
  "cases",
  "testRuns",
  "sessions",
  "milestones",
  "projects",
];

export default function IssueList() {
  return <Issues />;
}

function Issues() {
  const locale = useLocale();
  const t = useTranslations();
  const { data: session, status } = useSession();
  const router = useRouter();
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

  const accessFilterReady = !!session?.user?.id;

  // Distinct status/priority values for the filter dropdowns.
  const { data: statusOptions } = useClientQueries(schema).issue.useGroupBy(
    {
      by: ["status"],
      where: { isDeleted: false },
      orderBy: { status: "asc" },
    },
    { enabled: status === "authenticated" }
  );
  const { data: priorityOptions } = useClientQueries(schema).issue.useGroupBy(
    {
      by: ["priority"],
      where: { isDeleted: false },
      orderBy: { priority: "asc" },
    },
    { enabled: status === "authenticated" }
  );

  const statuses = useMemo(() => {
    if (!statusOptions) return [];
    const seen = new Map<string, string>();
    statusOptions
      .map((item) => item.status)
      .filter((s): s is string => s !== null && s.trim() !== "")
      .forEach((s) => {
        const lower = s.toLowerCase();
        if (!seen.has(lower)) seen.set(lower, s);
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
        if (!seen.has(lower)) seen.set(lower, p);
      });
    return Array.from(seen.values()).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
  }, [priorityOptions]);

  const searchFilter = useMemo(() => {
    if (!debouncedSearchString.trim()) {
      return {};
    }
    const searchTerm = debouncedSearchString.trim();
    return {
      OR: [
        { name: { contains: searchTerm, mode: "insensitive" as const } },
        { title: { contains: searchTerm, mode: "insensitive" as const } },
        { description: { contains: searchTerm, mode: "insensitive" as const } },
      ],
    };
  }, [debouncedSearchString]);

  // Issue is visible if associated with any accessible project relation.
  // ZenStack's access policies handle the permission filtering automatically.
  const issuesWhere = useMemo(() => {
    if (!accessFilterReady) {
      return null;
    }

    const relations = [
      {
        // `Issue.repositoryCases` does not exist in v3; the case link is the
        // explicit `caseIssues` join (RepositoryCaseIssue -> case).
        caseIssues: { some: { case: { isDeleted: false } } },
      },
      { sessions: { some: { isDeleted: false } } },
      { sessionResults: { some: { session: { isDeleted: false } } } },
      { testRuns: { some: { isDeleted: false } } },
      { testRunResults: { some: { testRun: { isDeleted: false } } } },
      {
        testRunStepResults: {
          some: { testRunResult: { testRun: { isDeleted: false } } },
        },
      },
    ];

    const conditions: Array<Record<string, unknown>> = [
      { isDeleted: false },
      { OR: relations },
    ];
    if (searchFilter.OR) conditions.push(searchFilter);
    if (statusFilter) {
      conditions.push({
        status: { equals: statusFilter, mode: "insensitive" as const },
      });
    }
    if (priorityFilter) {
      conditions.push({
        priority: { equals: priorityFilter, mode: "insensitive" as const },
      });
    }

    return { AND: conditions };
  }, [accessFilterReady, searchFilter, statusFilter, priorityFilter]);

  const isCountSort = COUNT_SORT_COLUMNS.includes(sortConfig.column);
  const orderBy = useMemo(() => {
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
      integration: { select: { id: true, name: true, provider: true } },
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
    enabled: !!issuesWhere && status === "authenticated" && !isCountSort,
  });

  const { data: allIssues, isLoading: isLoadingAll } = useClientQueries(
    schema
  ).issue.useFindMany(
    issuesWhere ? { where: issuesWhere, include } : undefined,
    { enabled: !!issuesWhere && status === "authenticated" && isCountSort }
  );

  const issues = useMemo(() => {
    if (isCountSort) return allIssues ?? [];
    return infinitePages?.pages.flat() ?? [];
  }, [isCountSort, infinitePages, allIssues]);

  const isLoadingIssues = isCountSort ? isLoadingAll : isLoadingInfinite;

  const { data: issuesCount } = useClientQueries(schema).issue.useCount(
    issuesWhere ? { where: issuesWhere } : undefined,
    { enabled: !!issuesWhere && status === "authenticated" }
  );

  // Counts + projects fetched separately, cached per issue id for the life of
  // the page (not scoped to the current search/sort, so once fetched they never
  // need re-requesting as the infinite list appends new ids).
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
  const [issueProjects, setIssueProjects] = useState<
    Record<number, Array<{ id: number; name: string; iconUrl: string | null }>>
  >({});
  const [isLoadingCounts, setIsLoadingCounts] = useState(false);
  const fetchedIssueIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!issues || issues.length === 0) {
      setIssueCounts({});
      setIssueProjects({});
      setIsLoadingCounts(false);
      fetchedIssueIdsRef.current = new Set();
      return;
    }

    const newIds = issues
      .map((i) => i.id)
      .filter((id) => !fetchedIssueIdsRef.current.has(id));
    if (newIds.length === 0) return;
    newIds.forEach((id) => fetchedIssueIdsRef.current.add(id));

    const fetchCountsAndProjects = async () => {
      setIsLoadingCounts(true);
      try {
        const [countsResponse, projectsResponse] = await Promise.all([
          fetch("/api/issues/counts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ issueIds: newIds }),
          }),
          fetch("/api/issues/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ issueIds: newIds }),
          }),
        ]);
        if (countsResponse.ok) {
          const data = await countsResponse.json();
          setIssueCounts((prev) => ({ ...prev, ...(data.counts || {}) }));
        }
        if (projectsResponse.ok) {
          const data = await projectsResponse.json();
          setIssueProjects((prev) => ({ ...prev, ...(data.projects || {}) }));
        }
      } catch (error) {
        console.error("Failed to fetch issue data:", error);
      } finally {
        setIsLoadingCounts(false);
      }
    };

    void fetchCountsAndProjects();
  }, [issues]);

  const mappedIssues = useMemo(() => {
    if (!issues) {
      return [];
    }

    const mapped = issues.map((issue): ExtendedIssues => {
      const counts = issueCounts[issue.id];
      const projects = issueProjects[issue.id] || [];
      const projectIds = projects.map((p) => p.id);
      return {
        ...issue,
        repositoryCases: [],
        sessions: [],
        testRuns: [],
        projects,
        aggregatedTestRunIds: [],
        projectIds,
        repositoryCasesCount: counts?.repositoryCases,
        sessionsCount: counts?.sessions,
        testRunsCount: counts?.testRuns,
        milestonesCount: counts?.milestones,
      };
    });

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
          case "projects":
            aValue = a.projects?.length ?? 0;
            bValue = b.projects?.length ?? 0;
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
  }, [issues, issueCounts, issueProjects, sortConfig, isCountSort]);

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

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
      projects: t("common.fields.projects"),
      integration: t("common.fields.integration"),
    },
    isLoadingCounts,
  });

  if (status === "loading" || !accessFilterReady) return null;

  const handleSortChange = (column: string) => {
    const direction =
      sortConfig &&
      sortConfig.column === column &&
      sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
  };

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <SectionHeader className="flex items-center gap-2">
            <CardTitle>{t("common.fields.issues")}</CardTitle>
            <HelpPopover helpKey="issues" />
          </SectionHeader>
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
                    {statuses.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
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
                    {priorities.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
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
              fillViewport
              columns={columns as any}
              data={mappedIssues as any}
              onSortChange={handleSortChange}
              sortConfig={sortConfig}
              isLoading={isLoadingIssues || isFetchingNextPage}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              hasMore={isCountSort ? false : !!hasNextPage}
              onLoadMore={fetchNextPage}
              estimateSize={60}
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
