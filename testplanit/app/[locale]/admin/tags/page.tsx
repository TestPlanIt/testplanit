"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "~/lib/navigation";

import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import { Filter } from "@/components/tables/Filter";
import { Button } from "@/components/ui/button";
import { HelpPopover } from "@/components/ui/help-popover";
import { SectionHeader } from "@/components/ui/typography";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CirclePlus } from "lucide-react";
import { AddTag } from "./AddTag";
import { ExtendedTags, useColumns } from "./columns";
import { DeleteTag } from "./DeleteTag";
import { EditTag } from "./EditTag";

const PAGE_SIZE = 50;

export default function TagListPage() {
  return <TagList />;
}

function TagList() {
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
  const [addTagOpen, setAddTagOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<ExtendedTags | null>(null);
  const [deletingTag, setDeletingTag] = useState<ExtendedTags | null>(null);
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

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

  // Fetch ONLY basic tag data - no includes at all
  // ZenStack's access control on includes causes bind variable explosion (even
  // with limits). Projects and counts are fetched separately (see below).
  // Infinite scroll accumulates pages of PAGE_SIZE; the virtualized table
  // renders only the visible window.
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
    isLoading: isLoadingTags,
  } = useClientQueries(schema).tags.useInfiniteFindMany(infiniteBaseArgs, {
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length < PAGE_SIZE) return undefined;
      return { ...infiniteBaseArgs, skip: allPages.flat().length };
    },
    enabled: !!tagsWhere && status === "authenticated",
  });

  const tags = useMemo(
    () => infinitePages?.pages.flat() ?? [],
    [infinitePages]
  );

  const { data: tagsCount } = useClientQueries(schema).tags.useCount(
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
  // Counts/projects are cached per tag id for the life of the page, so once
  // fetched they never need re-requesting as the infinite list appends new ids.
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
      .map((t) => t.id)
      .filter((id) => !fetchedTagIdsRef.current.has(id));
    if (newIds.length === 0) return;
    newIds.forEach((id) => fetchedTagIdsRef.current.add(id));

    const fetchCountsAndProjects = async () => {
      setIsLoadingCounts(true);
      try {
        // Fetch counts and projects in parallel
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
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  const columns = useColumns(
    tCommon,
    isLoadingCounts,
    setEditingTag,
    setDeletingTag
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
  };

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between gap-2">
            <SectionHeader className="flex items-center gap-2">
              <CardTitle data-testid="tags-page-title">
                {tGlobal("common.fields.tags")}
              </CardTitle>
              <HelpPopover helpKey="tags" />
            </SectionHeader>
            <Button
              onClick={() => setAddTagOpen(true)}
              aria-label={tGlobal("tags.add.button")}
              className="group gap-0 transition-all duration-200 hover:gap-2"
            >
              <CirclePlus className="h-4 w-4" />
              <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-xs">
                {tGlobal("tags.add.button")}
              </span>
            </Button>
          </div>
          {addTagOpen && (
            <AddTag open={addTagOpen} onClose={() => setAddTagOpen(false)} />
          )}
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start justify-between gap-4">
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

            {mappedTags.length > 0 && (
              <p className="text-sm text-muted-foreground shrink-0">
                {tGlobal("admin.auditLogs.showing", {
                  loaded: mappedTags.length.toLocaleString(),
                  total: (tagsCount ?? mappedTags.length).toLocaleString(),
                })}
              </p>
            )}
          </div>
          <div className="mt-4 flex justify-between">
            <ColumnSelection
              key="tag-column-selection"
              storageKey="admin-tags"
              columns={columns}
              onVisibilityChange={setColumnVisibility}
            />
          </div>
          <div className="mt-4 w-full">
            <VirtualizedDataTable
              fillViewport
              columns={columns as any}
              data={mappedTags}
              onSortChange={handleSortChange}
              sortConfig={sortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              isLoading={isLoadingTags || isFetchingNextPage}
              hasMore={!!hasNextPage}
              onLoadMore={fetchNextPage}
              resetKey={`${debouncedSearchString}|${sortConfig.column}|${sortConfig.direction}`}
              testIdPrefix="admin-tags-table"
              rowTestIdPrefix="admin-tag-row"
            />
          </div>
        </CardContent>
      </Card>
      {editingTag && (
        <EditTag
          tag={editingTag}
          open={true}
          onClose={() => setEditingTag(null)}
        />
      )}
      {deletingTag && (
        <DeleteTag
          tag={deletingTag}
          open={true}
          onClose={() => setDeletingTag(null)}
        />
      )}
    </main>
  );
}
