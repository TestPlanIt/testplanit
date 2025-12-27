"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useTranslations } from "next-intl";
import {
  usePagination,
  PaginationProvider,
} from "~/lib/contexts/PaginationContext";

import { useFindManyTags, useCountTags } from "~/lib/hooks";
import { DataTable } from "@/components/tables/DataTable";
import { getColumns } from "./columns";
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
import { AddTagModal } from "./AddTag";

type PageSizeOption = number | "All";

export default function TagListPage() {
  return (
    <PaginationProvider>
      <TagList />
    </PaginationProvider>
  );
}

function TagList() {
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
  const t = useTranslations("admin.tags");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  // Calculate skip and take based on pageSize
  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const skip = (currentPage - 1) * effectivePageSize;

  const nameFilter = useMemo(() => {
    if (!debouncedSearchString.trim()) {
      return {};
    }

    return {
      name: {
        contains: debouncedSearchString.trim(),
        mode: "insensitive" as const,
      },
    };
  }, [debouncedSearchString]);

  const tagsWhere = useMemo(() => {
    if (!session?.user) {
      return null;
    }

    return {
      isDeleted: false,
      ...nameFilter,
    };
  }, [session?.user, nameFilter]);

  const orderBy = useMemo(() => {
    if (!sortConfig?.column || sortConfig.column === "name") {
      return {
        name: sortConfig.direction,
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

  // Fetch ONLY basic tag data - no includes at all
  // ZenStack's access control on includes causes bind variable explosion (even with limits)
  // Projects and counts are fetched separately via direct Prisma queries
  const { data: tags, isLoading: isLoadingTags } = useFindManyTags(
    tagsWhere
      ? {
          where: tagsWhere,
          orderBy,
          ...paginationArgs,
        }
      : undefined,
    {
      enabled: !!tagsWhere && status === "authenticated",
    }
  );

  const { data: tagsCount } = useCountTags(
    tagsWhere
      ? {
          where: tagsWhere,
        }
      : undefined,
    {
      enabled: !!tagsWhere && status === "authenticated",
    }
  );

  // Fetch counts and projects separately to avoid bind variable explosion
  const [tagCounts, setTagCounts] = useState<
    Record<
      number,
      {
        repositoryCases: number;
        sessions: number;
        testRuns: number;
      }
    >
  >({});

  const [tagProjects, setTagProjects] = useState<
    Record<
      number,
      Array<{
        id: number;
        name: string;
        iconUrl: string | null;
      }>
    >
  >({});

  const [isLoadingCounts, setIsLoadingCounts] = useState(false);

  useEffect(() => {
    if (!tags || tags.length === 0) {
      setTagCounts({});
      setTagProjects({});
      setIsLoadingCounts(false);
      return;
    }

    const tagIds = tags.map((t) => t.id);

    const fetchCountsAndProjects = async () => {
      setIsLoadingCounts(true);
      try {
        // Fetch counts and projects in parallel
        const [countsResponse, projectsResponse] = await Promise.all([
          fetch("/api/tags/counts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tagIds }),
          }),
          fetch("/api/tags/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tagIds }),
          }),
        ]);

        if (countsResponse.ok) {
          const data = await countsResponse.json();
          setTagCounts(data.counts || {});
        }

        if (projectsResponse.ok) {
          const data = await projectsResponse.json();
          setTagProjects(data.projects || {});
        }
      } catch (error) {
        console.error("Failed to fetch tag data:", error);
      } finally {
        setIsLoadingCounts(false);
      }
    };

    fetchCountsAndProjects();
  }, [tags]);

  const mappedTags = useMemo(() => {
    if (!tags) {
      return [];
    }

    // Map counts and projects from the separate API calls
    return tags.map((tag) => {
      const counts = tagCounts[tag.id];
      const projects = tagProjects[tag.id] || [];

      return {
        ...tag,
        repositoryCases: [],
        sessions: [],
        testRuns: [],
        projects,
        repositoryCasesCount: counts?.repositoryCases ?? 0,
        sessionsCount: counts?.sessions ?? 0,
        testRunsCount: counts?.testRuns ?? 0,
      };
    });
  }, [tags, tagCounts, tagProjects]);

  useEffect(() => {
    setTotalItems(tagsCount ?? 0);
  }, [tagsCount, setTotalItems]);

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

  const columns = useMemo(
    () => getColumns(tCommon, isLoadingCounts),
    [tCommon, isLoadingCounts]
  );
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  if (status === "loading" || !tagsWhere) return null;

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
              <CardTitle data-testid="tags-page-title">
                {tGlobal("common.fields.tags")}
              </CardTitle>
            </div>
            <div>
              <AddTagModal />
            </div>
          </div>
          <CardDescription>{tGlobal("tags.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start">
            <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
              <div className="text-muted-foreground w-full text-nowrap">
                <Filter
                  key="tag-filter"
                  placeholder={tGlobal("tags.filterPlaceholder")}
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
            <ColumnSelection
              key="tag-column-selection"
              columns={columns}
              onVisibilityChange={setColumnVisibility}
            />
          </div>
          <div className="mt-4 flex justify-between">
            <DataTable
              columns={columns}
              data={mappedTags}
              onSortChange={handleSortChange}
              sortConfig={sortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              isLoading={isLoadingTags || !tagsWhere}
              pageSize={effectivePageSize}
            />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
