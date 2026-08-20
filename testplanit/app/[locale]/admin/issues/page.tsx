"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DEFECT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "~/lib/navigation";

import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpPopover } from "@/components/ui/help-popover";
import { SectionHeader } from "@/components/ui/typography";
import { ExtendedIssue, useIssueColumns } from "./columns";
import { DeleteIssue } from "./DeleteIssue";
import { EditIssue } from "./EditIssue";

const PAGE_SIZE = 50;

export default function IssueListPage() {
  return <IssueList />;
}

function IssueList() {
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
  const locale = useLocale();
  const t = useTranslations("admin.issues");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

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

  const issuesWhere = useMemo(() => {
    if (!session?.user) {
      return null;
    }

    // This list spans every project. The scope predicate is still correct
    // with zero per-project lookup because each row already carries its own
    // project's classification outcome on this same column — there is no
    // config to consult separately here. Spread before the search filter so
    // a search term can never shadow the scope.
    return {
      isDeleted: false,
      ...DEFECT_SCOPE_WHERE,
      ...searchFilter,
    };
  }, [session?.user, searchFilter]);

  const orderBy = useMemo(() => {
    if (!sortConfig?.column) {
      return {
        name: "asc" as const,
      };
    }

    if (sortConfig.column === "name") {
      return {
        name: sortConfig.direction,
      } as const;
    }

    if (sortConfig.column === "title") {
      return {
        title: sortConfig.direction,
      } as const;
    }

    if (sortConfig.column === "status") {
      return {
        status: sortConfig.direction,
      } as const;
    }

    if (sortConfig.column === "priority") {
      return {
        priority: sortConfig.direction,
      } as const;
    }

    if (sortConfig.column === "integration") {
      return {
        integration: {
          name: sortConfig.direction,
        },
      } as const;
    }

    if (sortConfig.column === "lastSyncedAt") {
      return {
        lastSyncedAt: sortConfig.direction,
      } as const;
    }

    return {
      name: "asc" as const,
    };
  }, [sortConfig]);

  const include = useMemo(
    () => ({
      project: {
        select: {
          id: true,
          name: true,
          iconUrl: true,
        },
      },
      integration: {
        select: {
          id: true,
          name: true,
          provider: true,
        },
      },
    }),
    []
  );

  // Infinite scroll accumulates pages of PAGE_SIZE; the virtualized table
  // renders only the visible window. Projects and counts are fetched separately
  // (see below) to avoid bind-variable explosion on access-controlled includes.
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
    isLoading: isLoadingIssues,
  } = useClientQueries(schema).issue.useInfiniteFindMany(infiniteBaseArgs, {
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length < PAGE_SIZE) return undefined;
      return { ...infiniteBaseArgs, skip: allPages.flat().length };
    },
    enabled: !!issuesWhere && status === "authenticated",
  });

  const issues = useMemo(
    () => infinitePages?.pages.flat() ?? [],
    [infinitePages]
  );

  const { data: issuesCount } = useClientQueries(schema).issue.useCount(
    issuesWhere
      ? {
          where: issuesWhere,
        }
      : undefined,
    {
      enabled: !!issuesWhere && status === "authenticated",
    }
  );

  // Fetch counts and projects separately to avoid bind variable explosion
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
  // Counts/projects are cached per issue id for the life of the page, so once
  // fetched they never need re-requesting as the infinite list appends new ids.
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
        // Fetch counts and projects in parallel
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

    // Map counts and projects from the separate API calls
    return issues.map((issue) => {
      const counts = issueCounts[issue.id];
      const projects = issueProjects[issue.id] || [];

      return {
        ...issue,
        repositoryCases: [],
        sessions: [],
        testRuns: [],
        projects,
        repositoryCasesCount: counts?.repositoryCases ?? 0,
        sessionsCount: counts?.sessions ?? 0,
        testRunsCount: counts?.testRuns ?? 0,
        milestonesCount: counts?.milestones ?? 0,
      };
    });
  }, [issues, issueCounts, issueProjects]);

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  const [editingIssue, setEditingIssue] = useState<ExtendedIssue | null>(null);
  const [deletingIssue, setDeletingIssue] = useState<ExtendedIssue | null>(
    null
  );
  const columns = useIssueColumns({
    tCommon,
    isLoadingCounts,
    onEditIssue: setEditingIssue,
    onDeleteIssue: setDeletingIssue,
  });
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  // Hide-column requests from the table's header menu are routed through the
  // Columns control (the visibility owner) so persistence and its checkboxes
  // stay in sync.
  const hideColumnRef = useRef<((columnId: string) => void) | null>(null);

  if (status === "loading" || !issuesWhere) return null;

  if (!session || session.user.access !== "ADMIN") {
    return null;
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
        <CardHeader className="w-full">
          <SectionHeader className="flex items-center gap-2">
            <CardTitle data-testid="issues-page-title">
              {tGlobal("common.fields.issues")}
            </CardTitle>
            <HelpPopover helpKey="issues" />
          </SectionHeader>
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start justify-between gap-4">
            <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
              <div className="text-muted-foreground w-full text-nowrap">
                <Filter
                  key="issue-filter"
                  placeholder={t("filterPlaceholder")}
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                />
              </div>
            </div>

            {mappedIssues.length > 0 && (
              <p className="text-sm text-muted-foreground shrink-0">
                {tGlobal("admin.auditLogs.showing", {
                  loaded: mappedIssues.length.toLocaleString(locale),
                  total: (issuesCount ?? mappedIssues.length).toLocaleString(
                    locale
                  ),
                })}
              </p>
            )}
          </div>
          <div className="mt-4 flex justify-between">
            <ColumnSelection
              key="issue-column-selection"
              storageKey="admin-issues"
              columns={columns}
              onVisibilityChange={setColumnVisibility}
              hideColumnRef={hideColumnRef}
            />
          </div>
          <div className="mt-4 w-full">
            <DataTable
              virtualized
              fillViewport
              columns={columns as any}
              data={mappedIssues}
              onSortChange={handleSortChange}
              onSortColumn={handleSortColumn}
              onHideColumn={(columnId) => hideColumnRef.current?.(columnId)}
              sortConfig={sortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              isLoading={isLoadingIssues || isFetchingNextPage}
              hasMore={!!hasNextPage}
              onLoadMore={fetchNextPage}
              estimateSize={60}
              resetKey={`${debouncedSearchString}|${sortConfig.column}|${sortConfig.direction}`}
              testIdPrefix="admin-issues-table"
              rowTestIdPrefix="admin-issue-row"
            />
          </div>
        </CardContent>
      </Card>
      {editingIssue && (
        <EditIssue
          issue={editingIssue}
          open={true}
          onClose={() => setEditingIssue(null)}
        />
      )}
      {deletingIssue && (
        <DeleteIssue
          issue={deletingIssue}
          open={true}
          onClose={() => setDeletingIssue(null)}
        />
      )}
    </main>
  );
}
