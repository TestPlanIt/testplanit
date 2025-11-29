"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useRouter } from "~/lib/navigation";
import { useParams, useSearchParams } from "next/navigation";
import {
  useFindManyIssue,
  useFindFirstProjects,
  useCountIssue,
} from "~/lib/hooks";
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
import { ProjectIcon } from "@/components/ProjectIcon";
import { Loading } from "~/components/Loading";

type PageSizeOption = number | "All";

export default function ProjectIssueList() {
  return (
    <PaginationProvider>
      <ProjectIssues />
    </PaginationProvider>
  );
}

function ProjectIssues() {
  const t = useTranslations();
  const { session, isLoading: isAuthLoading } = useRequireAuth();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.projectId ? Number(params.projectId) : null;
  const targetIssueId = searchParams.get("issueId");
  const scrollAttempts = useRef(0);
  const maxScrollAttempts = 10;
  const scrollInterval = useRef<NodeJS.Timeout | null>(null);

  const { data: project, isLoading: isLoadingProject } = useFindFirstProjects(
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
  const hasInitializedRef = useRef(false);
  const [shouldPreventPageReset, setShouldPreventPageReset] =
    useState(!!targetIssueId);
  const [isTableReady, setIsTableReady] = useState(false);

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

  // Build the where clause for issues in this project
  const issuesWhere = useMemo(() => {
    if (projectId === null) {
      return null;
    }

    const projectFilter = {
      OR: [
        { repositoryCases: { some: { projectId } } },
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

    return {
      AND: conditions,
    };
  }, [projectId, searchFilter]);

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

  // When we have a targetIssueId, fetch all issues to find which page it's on
  const { data: allIssues } = useFindManyIssue(
    targetIssueId && issuesWhere && shouldPreventPageReset
      ? {
          where: issuesWhere,
          orderBy,
          select: {
            id: true,
          },
        }
      : undefined,
    {
      enabled:
        !!targetIssueId &&
        !!issuesWhere &&
        !!session?.user &&
        projectId !== null &&
        shouldPreventPageReset,
    }
  );

  // Fetch basic issue data
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
                provider: true,
                name: true,
              },
            },
          },
        }
      : undefined,
    {
      enabled: !!issuesWhere && !!session?.user && projectId !== null,
      refetchOnWindowFocus: true,
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
      enabled: !!issuesWhere && !!session?.user,
    }
  );

  // Fetch counts for project-scoped issues
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

  const [isLoadingCounts, setIsLoadingCounts] = useState(false);

  useEffect(() => {
    if (!issues || issues.length === 0 || projectId === null) {
      setIssueCounts({});
      setIsLoadingCounts(false);
      return;
    }

    const issueIds = issues.map((i) => i.id);

    const fetchCounts = async () => {
      setIsLoadingCounts(true);
      try {
        // For project-scoped issues, we fetch counts scoped to this project
        const response = await fetch("/api/issues/counts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ issueIds, projectId }),
        });

        if (response.ok) {
          const data = await response.json();
          setIssueCounts(data.counts || {});
        }
      } catch (error) {
        console.error("Failed to fetch issue counts:", error);
      } finally {
        setIsLoadingCounts(false);
      }
    };

    fetchCounts();
  }, [issues, projectId]);

  // Map issues with counts
  const mappedIssues = useMemo(() => {
    if (!issues) {
      return [];
    }

    return issues.map((issue): ExtendedIssues => {
      const counts = issueCounts[issue.id];

      return {
        ...issue,
        repositoryCases: [],
        sessions: [],
        testRuns: [],
        aggregatedTestRunIds: [],
        projectIds: projectId ? [projectId] : [],
        repositoryCasesCount: counts?.repositoryCases ?? 0,
        sessionsCount: counts?.sessions ?? 0,
        testRunsCount: counts?.testRuns ?? 0,
      };
    });
  }, [issues, issueCounts, projectId]);

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

  // Calculate and set the correct page IMMEDIATELY when allIssues load and we have a target
  useEffect(() => {
    if (
      targetIssueId &&
      allIssues &&
      allIssues.length > 0 &&
      shouldPreventPageReset
    ) {
      const targetIndex = allIssues.findIndex(
        (issue) => issue.id.toString() === targetIssueId
      );

      if (targetIndex !== -1) {
        // Get page size from URL params first, then user preferences, then default
        let pageSizeValue = 10; // default

        const urlPageSize = searchParams.get("pageSize");
        if (urlPageSize) {
          if (urlPageSize === "All") {
            pageSizeValue = allIssues.length;
          } else {
            const size = parseInt(urlPageSize, 10);
            if (!isNaN(size) && size > 0) {
              pageSizeValue = size;
            }
          }
        } else if (session?.user?.preferences?.itemsPerPage) {
          const preferredSize = parseInt(
            session.user.preferences.itemsPerPage.replace("P", ""),
            10
          );
          if (!isNaN(preferredSize) && preferredSize > 0) {
            pageSizeValue = preferredSize;
          }
        }

        const targetPage = Math.floor(targetIndex / pageSizeValue) + 1;

        // Immediately set the page
        if (targetPage !== currentPage) {
          setCurrentPage(targetPage);
        }

        // Prevent further resets
        setShouldPreventPageReset(false);
      }
    }
  }, [
    targetIssueId,
    allIssues,
    shouldPreventPageReset,
    currentPage,
    setCurrentPage,
    searchParams,
    session,
  ]);

  // Set table ready state after issues load
  useEffect(() => {
    if (issues && issues.length > 0) {
      // Wait for DataTable to render
      const timer = setTimeout(() => {
        setIsTableReady(true);
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [issues]);

  // Handle scrolling and highlighting for specific issue
  useEffect(() => {
    if (targetIssueId && !hasInitializedRef.current && isTableReady) {
      hasInitializedRef.current = true;
      let scrollCancelled = false;

      // Detect user scroll to cancel auto-scroll
      const handleUserScroll = () => {
        scrollCancelled = true;
        if (scrollInterval.current) {
          clearInterval(scrollInterval.current);
          scrollInterval.current = null;
        }
        window.removeEventListener("wheel", handleUserScroll);
        window.removeEventListener("touchmove", handleUserScroll);
      };

      // Add scroll listeners to detect user interaction
      window.addEventListener("wheel", handleUserScroll, { passive: true });
      window.addEventListener("touchmove", handleUserScroll, { passive: true });

      // Start scrolling attempts after a short delay
      const timeoutId = setTimeout(() => {
        if (scrollCancelled) return;

        scrollInterval.current = setInterval(() => {
          if (scrollCancelled) {
            if (scrollInterval.current) {
              clearInterval(scrollInterval.current);
              scrollInterval.current = null;
            }
            return;
          }

          const targetRow = document.querySelector(
            `[data-row-id="${targetIssueId}"]`
          );

          if (targetRow) {
            targetRow.scrollIntoView({ behavior: "smooth", block: "center" });

            // Get all cells in the row
            const cells = targetRow.querySelectorAll("td");

            // Apply highlight to row with outline (doesn't affect layout)
            (targetRow as HTMLElement).style.setProperty("outline", "4px solid hsl(var(--primary))", "important");
            (targetRow as HTMLElement).style.setProperty("outline-offset", "-2px", "important");

            // Apply background to each cell
            cells.forEach((cell) => {
              const htmlCell = cell as HTMLElement;
              // Apply highlight background
              htmlCell.style.setProperty("background-color", "hsl(var(--primary) / 0.15)", "important");
            });

            // Clear interval and remove listeners after successful scroll
            if (scrollInterval.current) {
              clearInterval(scrollInterval.current);
              scrollInterval.current = null;
            }
            window.removeEventListener("wheel", handleUserScroll);
            window.removeEventListener("touchmove", handleUserScroll);
          } else {
            scrollAttempts.current += 1;
            if (scrollAttempts.current >= maxScrollAttempts) {
              if (scrollInterval.current) {
                clearInterval(scrollInterval.current);
                scrollInterval.current = null;
              }
              window.removeEventListener("wheel", handleUserScroll);
              window.removeEventListener("touchmove", handleUserScroll);
            }
          }
        }, 100);
      }, 1000);

      return () => {
        scrollCancelled = true;
        clearTimeout(timeoutId);
        if (scrollInterval.current) {
          clearInterval(scrollInterval.current);
          scrollInterval.current = null;
        }
        window.removeEventListener("wheel", handleUserScroll);
        window.removeEventListener("touchmove", handleUserScroll);
      };
    }
  }, [targetIssueId, isTableReady]);

  useEffect(() => {
    setCurrentPage(1);
    setIsTableReady(false); // Reset when search changes
    hasInitializedRef.current = false; // Reset scroll initialization
  }, [searchString, setCurrentPage]);

  useEffect(() => {
    setCurrentPage(1);
    setIsTableReady(false); // Reset when page size changes
    hasInitializedRef.current = false; // Reset scroll initialization
  }, [pageSize, setCurrentPage]);

  // Reset table ready state when page changes
  useEffect(() => {
    setIsTableReady(false);
    if (!targetIssueId) {
      hasInitializedRef.current = false; // Only reset if no target issue
    }
  }, [currentPage, targetIssueId]);

  useEffect(() => {
    if (!isAuthLoading && !session) {
      router.push("/");
    }
  }, [isAuthLoading, session, router]);

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
      integration: t("common.fields.integration"),
    },
    isLoadingCounts,
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
    setCurrentPage(1);
  };

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-xl md:text-2xl pb-2 pt-1">
            <CardTitle>{t("Pages.Issues.title")}</CardTitle>
          </div>
          <CardDescription className="uppercase">
            <span className="flex items-center gap-2">
              <ProjectIcon iconUrl={project?.iconUrl} />
              {project?.name}
            </span>
          </CardDescription>
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
              isLoading={isLoadingIssues}
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
