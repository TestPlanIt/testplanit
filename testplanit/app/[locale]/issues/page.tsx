"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useFindManyIssue, useCountIssue, useGroupByIssue } from "~/lib/hooks";
import { DataTable } from "@/components/tables/DataTable";
import { useIssueColumns } from "./columns";
import { useDebounce } from "@/components/Debounce";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "next-intl";
import {
  usePagination,
  PaginationProvider,
} from "~/lib/contexts/PaginationContext";
import { ExtendedIssues } from "./columns";
import type { VisibilityState } from "@tanstack/react-table";

type PageSizeOption = number | "All";

export default function IssueList() {
  return (
    <PaginationProvider>
      <Issues />
    </PaginationProvider>
  );
}

function Issues() {
  const t = useTranslations();
  const { data: session, status } = useSession();
  const router = useRouter();
  const {
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalItems,
    setTotalItems,
    startIndex,
    endIndex,
    totalPages,
  } = usePagination();
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

  // Fetch distinct status values for the filter dropdown
  const { data: statusOptions } = useGroupByIssue(
    {
      by: ["status"],
      where: { isDeleted: false },
      orderBy: { status: "asc" },
    },
    {
      enabled: status === "authenticated",
    }
  );

  // Fetch distinct priority values for the filter dropdown
  const { data: priorityOptions } = useGroupByIssue(
    {
      by: ["priority"],
      where: { isDeleted: false },
      orderBy: { priority: "asc" },
    },
    {
      enabled: status === "authenticated",
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

  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const skip = (currentPage - 1) * effectivePageSize;

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

  // Note: We don't need a manual project filter here anymore.
  // ZenStack's access policies on RepositoryCases, Sessions, TestRuns, etc.
  // will automatically filter out data the user doesn't have access to.
  // This handles all access types: assignedUsers, userPermissions,
  // groupPermissions, and project defaultAccessType (GLOBAL_ROLE/SPECIFIC_ROLE).

  // Build the where clause for issues
  const issuesWhere = useMemo(() => {
    if (!accessFilterReady) {
      return null;
    }

    // Issue is visible if associated with any accessible project relation.
    // ZenStack's access policies handle the permission filtering automatically.
    const relations = [
      {
        repositoryCases: {
          some: {
            isDeleted: false,
          },
        },
      },
      {
        sessions: {
          some: {
            isDeleted: false,
          },
        },
      },
      {
        sessionResults: {
          some: {
            session: {
              isDeleted: false,
            },
          },
        },
      },
      {
        testRuns: {
          some: {
            isDeleted: false,
          },
        },
      },
      {
        testRunResults: {
          some: {
            testRun: {
              isDeleted: false,
            },
          },
        },
      },
      {
        testRunStepResults: {
          some: {
            testRunResult: {
              testRun: {
                isDeleted: false,
              },
            },
          },
        },
      },
    ];

    // Combine search filter and project relations using AND
    const conditions: Array<Record<string, unknown>> = [
      { isDeleted: false },
      { OR: relations },
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
  }, [accessFilterReady, searchFilter, statusFilter, priorityFilter]);

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

    if (sortConfig.column === "lastSyncedAt") {
      return {
        lastSyncedAt: sortConfig.direction,
      } as const;
    }

    return {
      name: "asc" as const,
    };
  }, [sortConfig]);

  const shouldPaginate = typeof effectivePageSize === "number";
  const paginationArgs = {
    skip: shouldPaginate ? skip : undefined,
    take: shouldPaginate ? effectivePageSize : undefined,
  };

  // Fetch basic issue data - only include integration to avoid bind variable issues
  const { data: issues, isLoading: isLoadingIssues } = useFindManyIssue(
    issuesWhere
      ? {
          where: issuesWhere,
          orderBy,
          ...paginationArgs,
          include: {
            integration: {
              select: {
                id: true,
                name: true,
                provider: true,
              },
            },
          },
        }
      : undefined,
    {
      enabled: !!issuesWhere && status === "authenticated",
    }
  );

  // Get total count of issues
  const { data: issuesCount } = useCountIssue(
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
      }
    >
  >({});

  const [issueProjects, setIssueProjects] = useState<
    Record<number, Array<{ id: number; name: string; iconUrl: string | null }>>
  >({});

  const [isLoadingCounts, setIsLoadingCounts] = useState(false);

  useEffect(() => {
    if (!issues || issues.length === 0) {
      setIssueCounts({});
      setIssueProjects({});
      setIsLoadingCounts(false);
      return;
    }

    const issueIds = issues.map((i) => i.id);

    const fetchCountsAndProjects = async () => {
      setIsLoadingCounts(true);
      try {
        // Fetch counts and projects in parallel
        const [countsResponse, projectsResponse] = await Promise.all([
          fetch("/api/issues/counts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ issueIds }),
          }),
          fetch("/api/issues/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ issueIds }),
          }),
        ]);

        if (countsResponse.ok) {
          const data = await countsResponse.json();
          setIssueCounts(data.counts || {});
        }

        if (projectsResponse.ok) {
          const data = await projectsResponse.json();
          setIssueProjects(data.projects || {});
        }
      } catch (error) {
        console.error("Failed to fetch issue data:", error);
      } finally {
        setIsLoadingCounts(false);
      }
    };

    fetchCountsAndProjects();
  }, [issues]);

  // Map issues with counts and projects
  const mappedIssues = useMemo(() => {
    if (!issues) {
      return [];
    }

    return issues.map((issue): ExtendedIssues => {
      const counts = issueCounts[issue.id];
      const projects = issueProjects[issue.id] || [];
      const projectIds = projects.map((p) => p.id);

      // For aggregatedTestRunIds, we'll use the count
      // This is a simplification - if exact IDs are needed, we'd need to fetch them
      const aggregatedTestRunIds: number[] = [];

      return {
        ...issue,
        repositoryCases: [],
        sessions: [],
        testRuns: [],
        projects,
        aggregatedTestRunIds,
        projectIds,
        repositoryCasesCount: counts?.repositoryCases ?? 0,
        sessionsCount: counts?.sessions ?? 0,
        testRunsCount: counts?.testRuns ?? 0,
      };
    });
  }, [issues, issueCounts, issueProjects]);

  useEffect(() => {
    setTotalItems(issuesCount ?? 0);
  }, [issuesCount, setTotalItems]);

  const displayedIssues = mappedIssues;

  const pageSizeOptions: PageSizeOption[] = useMemo(() => {
    if (totalItems <= 10) {
      return ["All"];
    }
    const options: PageSizeOption[] = [10, 25, 50, 100, 250].filter(
      (size) => size < totalItems || totalItems === 0
    );
    options.push("All");
    return options;
  }, [totalItems]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchString, setCurrentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, setCurrentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, priorityFilter, setCurrentPage]);

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  const columns = useIssueColumns({
    translations: {
      name: t("common.fields.name"),
      title: t("common.fields.title"),
      description: t("common.fields.description"),
      status: t("common.fields.status"),
      priority: t("common.fields.priority"),
      lastSyncedAt: t("common.fields.lastSyncedAt"),
      testCases: t("common.fields.testCases"),
      sessions: t("common.fields.sessions"),
      testRuns: t("common.fields.testRuns"),
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
    setCurrentPage(1);
  };

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
            <div>
              <CardTitle>{t("Pages.Issues.title")}</CardTitle>
            </div>
          </div>
          <CardDescription>{t("Pages.Issues.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start">
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
                    <SelectValue placeholder={t("common.fields.status")} />
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

            <div className="flex flex-col w-full sm:w-2/3 items-end">
              {totalItems > 0 && (
                <>
                  <div className="justify-end">
                    <PaginationInfo
                      key="issue-pagination-info"
                      startIndex={startIndex}
                      endIndex={endIndex}
                      totalRows={totalItems}
                      searchString={searchString}
                      pageSize={typeof pageSize === "number" ? pageSize : "All"}
                      pageSizeOptions={pageSizeOptions}
                      handlePageSizeChange={(size) => setPageSize(size)}
                    />
                  </div>
                  <div className="justify-end -mx-4">
                    <PaginationComponent
                      currentPage={currentPage}
                      totalPages={totalPages}
                      onPageChange={setCurrentPage}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="mt-4 flex justify-between">
            <DataTable
              columns={columns}
              data={displayedIssues}
              onSortChange={handleSortChange}
              sortConfig={sortConfig}
              isLoading={isLoadingIssues || !issuesWhere}
              pageSize={effectivePageSize}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
            />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
