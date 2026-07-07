"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useDebounce } from "@/components/Debounce";
import { Filter } from "@/components/tables/Filter";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Boxes, TagsIcon } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "~/lib/navigation";
import { cn } from "~/utils";
import { useTagColumns } from "./columns";

const PAGE_SIZE = 50;

// Count columns are derived from a separate join call, so they can't be sorted
// across pages without the full set in hand. Sorting by one fetches everything
// once and renders it through the same virtualized table in full-set mode
// (hasMore=false); every other column drives a genuine infinite fetch.
const COUNT_SORT_COLUMNS = ["cases", "testRuns", "sessions", "projects"];

export default function TagList() {
  return <Tags />;
}

function Tags() {
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

  // ── AI Auto-Tag ──────────────────────────────────────────────────
  const [autoTagOpen, setAutoTagOpen] = useState(false);
  const { data: projects } = useClientQueries(schema).projects.useFindMany({
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

  const [searchString, setSearchString] = useState("");
  const debouncedSearchString = useDebounce(searchString, 500);

  const accessFilterReady = !!session?.user?.id;

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

  // Note: ZenStack's access policies on RepositoryCases, Sessions, and TestRuns
  // filter out data the user doesn't have access to automatically.
  const tagsWhere = useMemo(() => {
    if (!accessFilterReady) {
      return null;
    }

    const baseWhere = {
      isDeleted: false,
      ...nameFilter,
    };

    const relations = [
      {
        caseTags: {
          some: {
            case: {
              isDeleted: false,
            },
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
        testRuns: {
          some: {
            isDeleted: false,
          },
        },
      },
    ];

    return {
      ...baseWhere,
      OR: relations,
    };
  }, [accessFilterReady, nameFilter]);

  const isCountSort = COUNT_SORT_COLUMNS.includes(sortConfig.column);
  const orderBy = useMemo(
    () =>
      sortConfig.column === "name"
        ? ({ name: sortConfig.direction } as const)
        : { name: "asc" as const },
    [sortConfig]
  );

  const infiniteBaseArgs = useMemo(
    () => ({
      where: tagsWhere ?? undefined,
      orderBy,
      take: PAGE_SIZE,
    }),
    [tagsWhere, orderBy]
  );

  const {
    data: infinitePages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: isLoadingInfinite,
  } = useClientQueries(schema).tags.useInfiniteFindMany(infiniteBaseArgs, {
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length < PAGE_SIZE) return undefined;
      return { ...infiniteBaseArgs, skip: allPages.flat().length };
    },
    enabled: !!tagsWhere && status === "authenticated" && !isCountSort,
  });

  const { data: allTags, isLoading: isLoadingAll } = useClientQueries(
    schema
  ).tags.useFindMany(tagsWhere ? { where: tagsWhere } : undefined, {
    enabled: !!tagsWhere && status === "authenticated" && isCountSort,
  });

  const tags = useMemo(() => {
    if (isCountSort) return allTags ?? [];
    return infinitePages?.pages.flat() ?? [];
  }, [isCountSort, infinitePages, allTags]);

  const isLoadingTags = isCountSort ? isLoadingAll : isLoadingInfinite;

  const { data: tagsCount } = useClientQueries(schema).tags.useCount(
    tagsWhere ? { where: tagsWhere } : undefined,
    { enabled: !!tagsWhere && status === "authenticated" }
  );

  // Counts + projects are fetched separately (join queries too heavy to include)
  // and cached per tag id for the life of the page — a tag's counts/projects
  // aren't scoped to the current search/sort, so once fetched they never need
  // re-requesting as the infinite list appends new ids.
  const [tagCounts, setTagCounts] = useState<
    Record<
      number,
      { repositoryCases: number; sessions: number; testRuns: number }
    >
  >({});
  const [tagProjects, setTagProjects] = useState<
    Record<number, Array<{ id: number; name: string; iconUrl: string | null }>>
  >({});
  const [isLoadingCounts, setIsLoadingCounts] = useState(false);
  const fetchedTagIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!tags || tags.length === 0) {
      setTagCounts({});
      setTagProjects({});
      setIsLoadingCounts(false);
      fetchedTagIdsRef.current = new Set();
      return;
    }

    const newIds = tags
      .map((tag) => tag.id)
      .filter((id) => !fetchedTagIdsRef.current.has(id));
    if (newIds.length === 0) return;
    newIds.forEach((id) => fetchedTagIdsRef.current.add(id));

    const fetchCountsAndProjects = async () => {
      setIsLoadingCounts(true);
      try {
        const [countsResponse, projectsResponse] = await Promise.all([
          fetch("/api/tags/counts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tagIds: newIds }),
          }),
          fetch("/api/tags/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tagIds: newIds }),
          }),
        ]);

        if (countsResponse.ok) {
          const data = await countsResponse.json();
          setTagCounts((prev) => ({ ...prev, ...(data.counts || {}) }));
        }
        if (projectsResponse.ok) {
          const data = await projectsResponse.json();
          setTagProjects((prev) => ({ ...prev, ...(data.projects || {}) }));
        }
      } catch (error) {
        console.error("Failed to fetch tag data:", error);
      } finally {
        setIsLoadingCounts(false);
      }
    };

    void fetchCountsAndProjects();
  }, [tags]);

  const mappedTags = useMemo(() => {
    if (!tags) {
      return [];
    }

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

    // Count columns aren't in the DB — sort them client-side over the full set.
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
  }, [tags, tagCounts, tagProjects, sortConfig, isCountSort]);

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  const columns = useTagColumns(
    {
      name: t("common.name"),
      testCases: t("common.fields.testCases"),
      sessions: t("common.fields.sessions"),
      testRuns: t("common.fields.testRuns"),
      projects: t("common.fields.projects"),
    },
    isLoadingCounts
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
                            <span className="ms-2 text-xs text-muted-foreground">
                              {"(Complete)"}
                            </span>
                          )}
                          {!hasLlm && (
                            <span className="ms-2 text-xs text-muted-foreground">
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
          <div className="flex flex-row items-start justify-between gap-4">
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

            {mappedTags.length > 0 && (
              <p className="text-sm text-muted-foreground shrink-0">
                {t("admin.auditLogs.showing", {
                  loaded: mappedTags.length.toLocaleString(),
                  total: (tagsCount ?? mappedTags.length).toLocaleString(),
                })}
              </p>
            )}
          </div>
          <div className="mt-4 w-full">
            <VirtualizedDataTable
              fillViewport
              columns={columns as any}
              data={mappedTags as any}
              onSortChange={handleSortChange}
              sortConfig={sortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              isLoading={isLoadingTags || isFetchingNextPage || !tagsWhere}
              hasMore={isCountSort ? false : !!hasNextPage}
              onLoadMore={fetchNextPage}
              resetKey={`${debouncedSearchString}|${sortConfig.column}|${sortConfig.direction}`}
              testIdPrefix="tags-table"
              rowTestIdPrefix="tag-row"
            />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
