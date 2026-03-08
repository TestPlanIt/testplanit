"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useFindManyTags, useCountTags, useFindManyProjects } from "~/lib/hooks";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  usePagination,
  PaginationProvider,
} from "~/lib/contexts/PaginationContext";
import { useAutoTagJob } from "@/components/auto-tag/useAutoTagJob";
import { AutoTagProgress } from "@/components/auto-tag/AutoTagProgress";
import { AutoTagReviewDialog } from "@/components/auto-tag/AutoTagReviewDialog";
import type { EntityType } from "~/lib/llm/services/auto-tag/types";

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

  // ── AI Auto-Tag state ──────────────────────────────────────────────────
  const [entityType, setEntityType] = useState<EntityType | "">("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [showAutoTagReview, setShowAutoTagReview] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const { data: projects } = useFindManyProjects({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const persistKey =
    entityType && selectedProjectId
      ? `autoTagJob:${entityType}:${selectedProjectId}`
      : undefined;

  const autoTag = useAutoTagJob(persistKey);

  const handleAutoTagSubmit = useCallback(async () => {
    if (!entityType || !selectedProjectId) return;

    const projectIdNum = parseInt(selectedProjectId);
    setPopoverOpen(false);

    const modelMap: Record<EntityType, string> = {
      repositoryCase: "repositoryCase",
      testRun: "testRun",
      session: "session",
    };

    try {
      const res = await fetch(
        `/api/model/${modelMap[entityType as EntityType]}/findMany`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            q: {
              where: { projectId: projectIdNum },
              select: { id: true },
            },
          }),
        },
      );

      if (!res.ok) throw new Error("Failed to fetch entities");
      const data = await res.json();
      const entityIds = (data.data || []).map((e: { id: number }) => e.id);

      if (entityIds.length === 0) return;

      await autoTag.submit(entityIds, entityType as EntityType, projectIdNum);
    } catch (err) {
      console.error("Failed to start auto-tag:", err);
    }
  }, [entityType, selectedProjectId, autoTag]);

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
  const shouldPaginate = !needsClientSideSorting && typeof effectivePageSize === "number";
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
            <div>
              <CardTitle>{t("enums.ApplicationArea.Tags")}</CardTitle>
            </div>
            <div>
              <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" data-testid="ai-auto-tag-button">
                    <Sparkles className="h-4 w-4" />
                    {t("autoTag.actions.aiAutoTag")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80" align="end">
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <h4 className="font-medium leading-none">{t("autoTag.actions.aiAutoTag")}</h4>
                    </div>
                    <div className="grid gap-2">
                      <Select value={entityType} onValueChange={(v) => setEntityType(v as EntityType)}>
                        <SelectTrigger data-testid="entity-type-select">
                          <SelectValue placeholder={t("autoTag.actions.selectEntityType")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="repositoryCase">{t("autoTag.actions.entityTypes.repositoryCase")}</SelectItem>
                          <SelectItem value="testRun">{t("autoTag.actions.entityTypes.testRun")}</SelectItem>
                          <SelectItem value="session">{t("autoTag.actions.entityTypes.session")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                        <SelectTrigger data-testid="project-select">
                          <SelectValue placeholder={t("autoTag.actions.selectProject")} />
                        </SelectTrigger>
                        <SelectContent>
                          {(projects || []).map((p: { id: number; name: string }) => (
                            <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        onClick={handleAutoTagSubmit}
                        disabled={!entityType || !selectedProjectId || autoTag.isSubmitting}
                        data-testid="start-tagging-button"
                      >
                        <Sparkles className="h-4 w-4" />
                        {t("autoTag.actions.startTagging")}
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <CardDescription>{t("tags.description")}</CardDescription>
        </CardHeader>
        {autoTag.status !== "idle" && (
          <div className="px-6 pb-2">
            <AutoTagProgress
              status={autoTag.status}
              progress={autoTag.progress}
              error={autoTag.error}
              onReview={() => setShowAutoTagReview(true)}
              onCancel={autoTag.cancel}
            />
          </div>
        )}
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
      <AutoTagReviewDialog
        open={showAutoTagReview}
        onOpenChange={setShowAutoTagReview}
        job={autoTag}
      />
    </main>
  );
}
