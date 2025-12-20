"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useTranslations } from "next-intl";
import {
  usePagination,
  PaginationProvider,
} from "~/lib/contexts/PaginationContext";

import { useFindManyIssue, useCountIssue } from "~/lib/hooks";
import { DataTable } from "@/components/tables/DataTable";
import { useIssueColumns } from "./columns";
import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
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

type PageSizeOption = number | "All";

export default function IssueListPage() {
  return (
    <PaginationProvider>
      <IssueList />
    </PaginationProvider>
  );
}

function IssueList() {
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
  const t = useTranslations("admin.issues");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  // Calculate skip and take based on pageSize
  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const skip = (currentPage - 1) * effectivePageSize;

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

    return {
      isDeleted: false,
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

  const shouldPaginate = typeof effectivePageSize === "number";
  const paginationArgs = {
    skip: shouldPaginate ? skip : undefined,
    take: shouldPaginate ? effectivePageSize : undefined,
  };

  // Fetch ONLY basic issue data - no includes at all
  // Projects and counts are fetched separately via direct Prisma queries
  const { data: issues, isLoading: isLoadingIssues } = useFindManyIssue(
    issuesWhere
      ? {
          where: issuesWhere,
          orderBy,
          ...paginationArgs,
          include: {
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
          },
        }
      : undefined,
    {
      enabled: !!issuesWhere && status === "authenticated",
    }
  );

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
      };
    });
  }, [issues, issueCounts, issueProjects]);

  useEffect(() => {
    setTotalItems(issuesCount ?? 0);
  }, [issuesCount, setTotalItems]);

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

  // Reset to first page when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchString, setCurrentPage]);

  // Reset to first page when page size changes
  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, setCurrentPage]);

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  const columns = useIssueColumns({
    tCommon,
    isLoadingCounts,
  });
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

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
    setCurrentPage(1);
  };

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
            <div>
              <CardTitle data-testid="issues-page-title">
                {tGlobal("common.fields.issues")}
              </CardTitle>
            </div>
          </div>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start">
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
            <ColumnSelection
              key="issue-column-selection"
              columns={columns}
              onVisibilityChange={setColumnVisibility}
            />
          </div>
          <div className="mt-4 flex justify-between">
            <DataTable
              columns={columns}
              data={mappedIssues}
              onSortChange={handleSortChange}
              sortConfig={sortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              isLoading={isLoadingIssues || !issuesWhere}
              pageSize={effectivePageSize}
            />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
