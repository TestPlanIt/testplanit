"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useFindManyIssue, useCountIssue } from "~/lib/hooks";
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

  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const isAdmin = session?.user?.access === "ADMIN";
  const accessFilterReady = isAdmin || !!session?.user?.id;

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

  // Build access filter for non-admin users
  // Issues are visible if they're associated with any accessible project
  const relationProjectFilter = useMemo(() => {
    if (isAdmin || !session?.user?.id) {
      return undefined;
    }

    return {
      project: {
        assignedUsers: {
          some: {
            userId: session.user.id,
          },
        },
      },
    };
  }, [isAdmin, session?.user?.id]);

  // Build the where clause for issues
  const issuesWhere = useMemo(() => {
    if (!accessFilterReady) {
      return null;
    }

    const baseWhere = {
      isDeleted: false,
      ...searchFilter,
    };

    // For admins, just return base where
    if (isAdmin) {
      return baseWhere;
    }

    // For non-admins, issue is visible if associated with any accessible project
    const relations = [
      {
        repositoryCases: {
          some: {
            isDeleted: false,
            ...(relationProjectFilter ?? {}),
          },
        },
      },
      {
        sessions: {
          some: {
            isDeleted: false,
            ...(relationProjectFilter ?? {}),
          },
        },
      },
      {
        sessionResults: {
          some: {
            session: {
              isDeleted: false,
              ...(relationProjectFilter ?? {}),
            },
          },
        },
      },
      {
        testRuns: {
          some: {
            isDeleted: false,
            ...(relationProjectFilter ?? {}),
          },
        },
      },
      {
        testRunResults: {
          some: {
            testRun: {
              isDeleted: false,
              ...(relationProjectFilter ?? {}),
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
                ...(relationProjectFilter ?? {}),
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

    return {
      AND: conditions,
    };
  }, [accessFilterReady, searchFilter, isAdmin, relationProjectFilter]);

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
              <div className="text-muted-foreground w-full text-nowrap">
                <Filter
                  key="issue-filter"
                  placeholder={t("Pages.Issues.filterPlaceholder")}
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                />
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
