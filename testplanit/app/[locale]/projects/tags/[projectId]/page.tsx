"use client";

import { useState, useEffect, useMemo } from "react";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useRouter } from "~/lib/navigation";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  usePagination,
  PaginationProvider,
} from "~/lib/contexts/PaginationContext";
import {
  useFindManyTags,
  useFindManyRepositoryCases,
  useFindFirstProjects,
  useFindManySessions,
  useFindManyTestRuns,
} from "~/lib/hooks";
import { DataTable } from "@/components/tables/DataTable";
import { getColumns } from "./columns";
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
import { ProjectIcon } from "@/components/ProjectIcon";

type PageSizeOption = number | "All";

export default function ProjectTagListPage() {
  return (
    <PaginationProvider>
      <TagList />
    </PaginationProvider>
  );
}

function TagList() {
  const {
    session,
    isLoading: isAuthLoading,
    isAuthenticated,
  } = useRequireAuth();
  const router = useRouter();
  const { projectId } = useParams<{ projectId: string }>();
  const t = useTranslations();
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
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  // Calculate effective page size and skip
  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const skip = (currentPage - 1) * effectivePageSize;

  const { data: project } = useFindFirstProjects(
    {
      where: {
        AND: [
          {
            isDeleted: false,
          },
          { id: Number(projectId) },
        ],
      },
    },
    {
      enabled: isAuthenticated, // Only query when session is authenticated
      retry: 3, // Retry a few times in case of race conditions
      retryDelay: 1000, // Wait 1 second between retries
    }
  );

  const { data: repositoryCases, isLoading: isLoadingCases } =
    useFindManyRepositoryCases(
      {
        where: {
          projectId: Number(projectId),
          isDeleted: false,
        },
        select: {
          id: true,
          name: true,
          tags: {
            select: {
              id: true,
            },
          },
        },
      },
      {
        enabled: !!projectId,
      }
    );

  const { data: sessions, isLoading: isLoadingSessions } = useFindManySessions(
    {
      where: {
        projectId: Number(projectId),
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        tags: {
          select: {
            id: true,
          },
        },
      },
    },
    {
      enabled: !!projectId,
    }
  );

  const { data: testRuns, isLoading: isLoadingRuns } = useFindManyTestRuns(
    {
      where: {
        projectId: Number(projectId),
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        tags: {
          select: {
            id: true,
          },
        },
      },
    },
    {
      enabled: !!projectId,
    }
  );

  // Fetch ONLY basic tag data - no includes to avoid bind variable explosion
  const { data: tags, isLoading: isLoadingTags } = useFindManyTags(
    {
      where: {
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
      },
    },
    {
      enabled: !!projectId,
    }
  );

  const activeCaseMap = useMemo(() => {
    return (
      repositoryCases?.reduce(
        (acc, curr) => {
          acc[curr.id] = curr.name;
          return acc;
        },
        {} as Record<number, string>
      ) || {}
    );
  }, [repositoryCases]);

  const activeCaseIds = useMemo(
    () => repositoryCases?.map((c) => c.id) || [],
    [repositoryCases]
  );

  const activeSessionMap = useMemo(() => {
    return (
      sessions?.reduce(
        (acc, curr) => {
          acc[curr.id] = curr.name;
          return acc;
        },
        {} as Record<number, string>
      ) || {}
    );
  }, [sessions]);

  const activeSessionIds = useMemo(
    () => sessions?.map((s) => s.id) || [],
    [sessions]
  );

  const activeRunMap = useMemo(() => {
    return (
      testRuns?.reduce(
        (acc, curr) => {
          acc[curr.id] = curr.name;
          return acc;
        },
        {} as Record<number, string>
      ) || {}
    );
  }, [testRuns]);

  const activeRunIds = useMemo(
    () => testRuns?.map((r) => r.id) || [],
    [testRuns]
  );

  const filteredTags = useMemo(() => {
    if (!tags) return [];

    // Build tag items from the existing data
    const tagItems = new Map<
      number,
      {
        repositoryCases: Array<{ id: number; name: string }>;
        sessions: Array<{ id: number; name: string; isCompleted: any }>;
        testRuns: Array<{ id: number; name: string; isCompleted?: boolean }>;
      }
    >();

    // Collect cases per tag
    repositoryCases?.forEach((repositoryCase) => {
      repositoryCase.tags?.forEach((tag) => {
        const current = tagItems.get(tag.id) || {
          repositoryCases: [],
          sessions: [],
          testRuns: [],
        };
        current.repositoryCases.push({
          id: repositoryCase.id,
          name: repositoryCase.name,
        });
        tagItems.set(tag.id, current);
      });
    });

    // Collect sessions per tag
    sessions?.forEach((session) => {
      session.tags?.forEach((tag) => {
        const current = tagItems.get(tag.id) || {
          repositoryCases: [],
          sessions: [],
          testRuns: [],
        };
        current.sessions.push({
          id: session.id,
          name: session.name,
          isCompleted: false,
        });
        tagItems.set(tag.id, current);
      });
    });

    // Collect runs per tag
    testRuns?.forEach((testRun) => {
      testRun.tags?.forEach((tag) => {
        const current = tagItems.get(tag.id) || {
          repositoryCases: [],
          sessions: [],
          testRuns: [],
        };
        current.testRuns.push({
          id: testRun.id,
          name: testRun.name,
          isCompleted: false,
        });
        tagItems.set(tag.id, current);
      });
    });

    return tags
      .filter((tag) => {
        const items = tagItems.get(tag.id);
        const hasItems =
          items &&
          (items.repositoryCases.length > 0 ||
            items.sessions.length > 0 ||
            items.testRuns.length > 0);
        const matchesSearch = tag.name
          .toLowerCase()
          .includes(debouncedSearchString.toLowerCase());
        return hasItems && matchesSearch;
      })
      .map((tag) => {
        const items = tagItems.get(tag.id) || {
          repositoryCases: [],
          sessions: [],
          testRuns: [],
        };
        return {
          ...tag,
          repositoryCases: items.repositoryCases,
          sessions: items.sessions,
          testRuns: items.testRuns,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tags, repositoryCases, sessions, testRuns, debouncedSearchString]);

  // Update total items in pagination context
  useEffect(() => {
    if (filteredTags) {
      setTotalItems(filteredTags.length);
    }
  }, [filteredTags, setTotalItems]);

  const displayedTags = useMemo(() => {
    return filteredTags.slice(skip, skip + effectivePageSize);
  }, [filteredTags, skip, effectivePageSize]);

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
    if (!isAuthLoading && !session) {
      router.push("/");
    }
  }, [isAuthLoading, session, router]);

  const handleSortChange = (column: string) => {
    const direction =
      sortConfig &&
      sortConfig.column === column &&
      sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
    setCurrentPage(1); // Reset to first page when sorting changes
  };

  const isLoadingCounts = isLoadingCases || isLoadingSessions || isLoadingRuns;

  const columns = useMemo(
    () =>
      getColumns(
        projectId as string,
        activeCaseMap,
        activeSessionMap,
        activeRunMap,
        t,
        isLoadingCounts
      ),
    [
      projectId,
      activeCaseMap,
      activeSessionMap,
      activeRunMap,
      t,
      isLoadingCounts,
    ]
  );

  // Wait for all data to load - this prevents the flash
  if (
    isAuthLoading ||
    isLoadingTags ||
    isLoadingCases ||
    isLoadingSessions ||
    isLoadingRuns
  ) {
    return null;
  }

  // NOW check if project exists - only after loading is complete
  if (!project) {
    return (
      <Card className="flex flex-col w-full min-w-[400px] h-full">
        <CardContent className="flex flex-col items-center justify-center h-full">
          <h2 className="text-2xl font-semibold mb-2">
            {t("common.errors.projectNotFound")}
          </h2>
          <p className="text-muted-foreground">
            {t("common.errors.projectNotFoundDescription")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <main>
      <Card>
        <CardHeader>
          <CardTitle>
            <div className="flex items-center justify-between text-primary text-xl md:text-2xl pb-2 pt-1">
              <CardTitle>{t("common.labels.tags")}</CardTitle>
            </div>
          </CardTitle>
          <CardDescription className="uppercase">
            <span className="flex items-center gap-2 uppercase shrink-0">
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
                  key="tag-filter"
                  placeholder={t("tags.filterPlaceholder")}
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
                      key="tag-pagination-info"
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
              columns={columns as any}
              data={displayedTags as any}
              onSortChange={handleSortChange}
              sortConfig={sortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              isLoading={
                isLoadingTags ||
                isLoadingCases ||
                isLoadingSessions ||
                isLoadingRuns
              }
              pageSize={effectivePageSize}
            />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
