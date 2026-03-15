"use client";

import { useDebounce } from "@/components/Debounce";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent,
  CardDescription, CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { Boxes, TagsIcon } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  PaginationProvider, usePagination
} from "~/lib/contexts/PaginationContext";
import {
  useCountTags,
  useFindManyProjects, useFindManyTags
} from "~/lib/hooks";
import { useRouter } from "~/lib/navigation";
import { cn } from "~/utils";
import { getColumns } from "./columns";

type PageSizeOption = number | "All";

export default function TagList() {
  return (
    <PaginationProvider>
      <Tags />
    </PaginationProvider>
  );
}

function Tags() {
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

  // ── AI Auto-Tag ──────────────────────────────────────────────────
  const [autoTagOpen, setAutoTagOpen] = useState(false);
  const { data: projects } = useFindManyProjects({
    where: { isDeleted: false },
    include: {
      projectLlmIntegrations: {
        where: { isActive: true },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: [{ isCompleted: "asc" }, { name: "asc" }],
  });

  // Valid column IDs for sorting
  const validColumnIds = useMemo(
    () => ["name", "cases", "testRuns", "sessions", "projects"],
    []
  );

  // Validate and fix sortConfig if it references a non-existent column
  useEffect(() => {
    if (!validColumnIds.includes(sortConfig.column)) {
      console.warn(
        `Invalid sort column "${sortConfig.column}", resetting to "name"`
      );
      setSortConfig({ column: "name", direction: "asc" });
    }
  }, [sortConfig.column, validColumnIds]);
  const [searchString, setSearchString] = useState("");
  const debouncedSearchString = useDebounce(searchString, 500);

  const accessFilterReady = !!session?.user?.id;

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

  // Note: We don't need a manual project filter here anymore.
  // ZenStack's access policies on RepositoryCases, Sessions, and TestRuns
  // will automatically filter out data the user doesn't have access to.
  // This handles all access types: assignedUsers, userPermissions,
  // groupPermissions, and project defaultAccessType (GLOBAL_ROLE).

  const tagsWhere = useMemo(() => {
    if (!accessFilterReady) {
      return null;
    }

    const baseWhere = {
      isDeleted: false,
      ...nameFilter,
    };

    const relations = (
      ["repositoryCases", "sessions", "testRuns"] as const
    ).map((relation) => ({
      [relation]: {
        some: {
          isDeleted: false,
        },
      },
    }));

    return {
      ...baseWhere,
      OR: relations,
    };
  }, [accessFilterReady, nameFilter]);

  const orderBy = useMemo(() => {
    // Only apply server-side sorting for name column
    // Other columns will be sorted client-side after counts are fetched
    if (sortConfig?.column === "name") {
      return {
        name: sortConfig.direction,
      } as const;
    }

    // For count columns, fetch all tags unsorted (will sort client-side)
    return {
      name: "asc" as const,
    };
  }, [sortConfig]);

  // When sorting by count columns, we need to fetch ALL tags to sort properly
  // Otherwise we can paginate server-side
  const needsClientSideSorting = sortConfig.column !== "name";
  const shouldPaginate =
    !needsClientSideSorting && typeof effectivePageSize === "number";
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
    const mapped = tags.map((tag) => {
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

    // Apply client-side sorting for count columns (since these aren't in the DB)
    // Name sorting is already handled server-side via orderBy
    if (sortConfig.column !== "name") {
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
  }, [tags, tagCounts, tagProjects, sortConfig]);

  useEffect(() => {
    setTotalItems(tagsCount ?? 0);
  }, [tagsCount, setTotalItems]);

  // When sorting by count columns, apply pagination client-side
  // Otherwise the data is already paginated from the server
  const displayedTags = useMemo(() => {
    if (sortConfig.column !== "name") {
      // Client-side pagination for count column sorting
      return mappedTags.slice(skip, skip + effectivePageSize);
    }
    // Server-side pagination (already applied)
    return mappedTags;
  }, [mappedTags, sortConfig.column, skip, effectivePageSize]);

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

  const columns = useMemo(
    () =>
      getColumns(
        {
          name: t("common.name"),
          testCases: t("common.fields.testCases"),
          sessions: t("common.fields.sessions"),
          testRuns: t("common.fields.testRuns"),
          projects: t("common.fields.projects"),
        },
        isLoadingCounts
      ),
    [t, isLoadingCounts]
  );
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

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
            <CardTitle>{t("enums.ApplicationArea.Tags")}</CardTitle>
            <Popover open={autoTagOpen} onOpenChange={setAutoTagOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="default"
                  size="sm"
                  data-testid="ai-auto-tag-button"
                  disabled={!projects || projects.length === 0}
                >
                  <TagsIcon className="h-4 w-4" />
                  {t("autoTag.actions.aiAutoTag")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[400px] px-0 py-2" align="end">
                <Command className="py-0.5">
                  <CommandInput placeholder={t("common.fields.projects")} />
                  <CommandEmpty>
                    {t("common.ui.search.noProjectsFound")}
                  </CommandEmpty>
                  <CommandGroup className="max-h-[600px] overflow-y-auto">
                    {(projects || []).map((p) => {
                      const hasLlm =
                        p.projectLlmIntegrations &&
                        p.projectLlmIntegrations.length > 0;
                      return (
                        <CommandItem
                          key={p.id}
                          value={p.name}
                          disabled={!hasLlm}
                          onSelect={() => {
                            if (!hasLlm) return;
                            setAutoTagOpen(false);
                            router.push(`/projects/tags/${p.id}?autoTag=true`);
                          }}
                        >
                          {p.iconUrl ? (
                            <Image
                              src={p.iconUrl}
                              alt={`${p.name} icon`}
                              width={16}
                              height={16}
                              className="shrink-0 object-contain"
                            />
                          ) : (
                            <Boxes className="h-4 w-4 shrink-0" />
                          )}
                          <span
                            className={cn(
                              "truncate",
                              (p.isCompleted || !hasLlm) && "opacity-60"
                            )}
                          >
                            {p.name}
                          </span>
                          {p.isCompleted && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {"(Complete)"}
                            </span>
                          )}
                          {!hasLlm && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {t("autoTag.wizard.noLlmConfigured")}
                            </span>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <CardDescription>{t("tags.description")}</CardDescription>
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
              isLoading={isLoadingTags || !tagsWhere}
              pageSize={effectivePageSize}
            />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
