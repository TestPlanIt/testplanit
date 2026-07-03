"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useDebounce } from "@/components/Debounce";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import { Filter } from "@/components/tables/Filter";
import { TagsDisplay } from "@/components/tables/TagDisplay";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Filter as FilterIcon, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "~/lib/navigation";
import {
  useCaseColumns,
  useSessionColumns,
  useTestRunColumns,
} from "./columns";

const PAGE_SIZE = 50;

type TabType = "cases" | "sessions" | "testRuns";
type CaseTypeFilter = "all" | "manual" | "automated";

interface TagDetailFilters {
  hideCompletedSessions: boolean;
  hideCompletedTestRuns: boolean;
  caseType: CaseTypeFilter;
}

const FILTER_STORAGE_KEY = "testplanit-tag-detail-filters";

function loadFilters(projectId: string, tagId: string): TagDetailFilters {
  try {
    const stored = localStorage.getItem(
      `${FILTER_STORAGE_KEY}-${projectId}-${tagId}`
    );
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // ignore parse errors
  }
  return {
    hideCompletedSessions: false,
    hideCompletedTestRuns: false,
    caseType: "all",
  };
}

function saveFilters(
  projectId: string,
  tagId: string,
  filters: TagDetailFilters
) {
  try {
    localStorage.setItem(
      `${FILTER_STORAGE_KEY}-${projectId}-${tagId}`,
      JSON.stringify(filters)
    );
  } catch {
    // ignore storage errors
  }
}

export default function TagDetailPage() {
  return <TagDetail />;
}

function TagDetail() {
  const t = useTranslations();
  const { data: session, status } = useSession();
  const router = useRouter();
  const { projectId, tagId } = useParams<{
    projectId: string;
    tagId: string;
  }>();
  const [searchString, setSearchString] = useState("");
  const debouncedSearchString = useDebounce(searchString, 500);
  const [activeTab, setActiveTab] = useState<TabType>("cases");

  // Filter state - loaded from localStorage
  const [filters, setFilters] = useState<TagDetailFilters>(() =>
    loadFilters(projectId, tagId)
  );

  // Persist filters to localStorage on change
  const updateFilters = useCallback(
    (update: Partial<TagDetailFilters>) => {
      setFilters((prev) => {
        const next = { ...prev, ...update };
        saveFilters(projectId, tagId, next);
        return next;
      });
    },
    [projectId, tagId]
  );

  // Count active filters for indicator
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.hideCompletedSessions) count++;
    if (filters.hideCompletedTestRuns) count++;
    if (filters.caseType !== "all") count++;
    return count;
  }, [filters]);

  // Fetch the tag metadata only
  const { data: tags, isLoading: isLoadingTag } = useClientQueries(
    schema
  ).tags.useFindMany(
    {
      where: { id: Number(tagId), isDeleted: false },
      select: { id: true, name: true },
    },
    {
      enabled: !!tagId && status === "authenticated",
    }
  );

  const tag = tags?.[0];
  const tagName = tag?.name || t("tags.defaultName");

  // Build where clause for project-scoped queries
  const baseWhere = useMemo(() => {
    return {
      projectId: Number(projectId),
      isDeleted: false,
      tags: {
        some: {
          id: Number(tagId),
        },
      },
    };
  }, [projectId, tagId]);

  // Add search + filter for cases
  const casesWhere = useMemo(() => {
    const where: any = { ...baseWhere };

    // RepositoryCases now link tags via the explicit `caseTags` join model
    // (sessions/test runs still use the implicit `tags` relation in baseWhere).
    delete where.tags;
    where.caseTags = {
      some: {
        tagId: Number(tagId),
      },
    };

    // Case type filter
    if (filters.caseType === "manual") {
      where.automated = false;
    } else if (filters.caseType === "automated") {
      where.automated = true;
    }

    if (debouncedSearchString.trim()) {
      where.OR = [
        {
          name: {
            contains: debouncedSearchString.trim(),
            mode: "insensitive" as const,
          },
        },
        {
          className: {
            contains: debouncedSearchString.trim(),
            mode: "insensitive" as const,
          },
        },
      ];
    }
    return where;
  }, [baseWhere, debouncedSearchString, filters.caseType, tagId]);

  // Add search + filter for sessions
  const sessionsWhere = useMemo(() => {
    const where: any = { ...baseWhere };

    if (filters.hideCompletedSessions) {
      where.isCompleted = false;
    }

    if (debouncedSearchString.trim()) {
      where.name = {
        contains: debouncedSearchString.trim(),
        mode: "insensitive" as const,
      };
    }
    return where;
  }, [baseWhere, debouncedSearchString, filters.hideCompletedSessions]);

  // Add search + filter for test runs
  const testRunsWhere = useMemo(() => {
    const where: any = { ...baseWhere };

    if (filters.hideCompletedTestRuns) {
      where.isCompleted = false;
    }

    if (debouncedSearchString.trim()) {
      where.name = {
        contains: debouncedSearchString.trim(),
        mode: "insensitive" as const,
      };
    }
    return where;
  }, [baseWhere, debouncedSearchString, filters.hideCompletedTestRuns]);

  // Fetch test cases (infinite scroll)
  const casesInfiniteArgs = useMemo(
    () => ({
      where: casesWhere,
      select: {
        id: true,
        name: true,
        source: true,
        automated: true,
        hasParameters: true,
      },
      orderBy: { name: "asc" as const },
      take: PAGE_SIZE,
    }),
    [casesWhere]
  );
  const {
    data: casesPages,
    fetchNextPage: fetchMoreCases,
    hasNextPage: hasMoreCases,
    isFetchingNextPage: isFetchingMoreCases,
    isLoading: isLoadingCases,
  } = useClientQueries(schema).repositoryCases.useInfiniteFindMany(
    casesInfiniteArgs,
    {
      getNextPageParam: (lastPage, allPages) =>
        !lastPage || lastPage.length < PAGE_SIZE
          ? undefined
          : { ...casesInfiniteArgs, skip: allPages.flat().length },
      enabled: !!tagId && status === "authenticated" && activeTab === "cases",
    }
  );
  const repositoryCases = useMemo(
    () => casesPages?.pages.flat() ?? [],
    [casesPages]
  );

  const { data: casesCount } = useClientQueries(
    schema
  ).repositoryCases.useCount(
    {
      where: casesWhere,
    },
    {
      enabled: !!tagId && status === "authenticated",
    }
  );

  // Fetch sessions (infinite scroll)
  const sessionsInfiniteArgs = useMemo(
    () => ({
      where: sessionsWhere,
      select: {
        id: true,
        name: true,
        isCompleted: true,
      },
      orderBy: { createdAt: "desc" as const },
      take: PAGE_SIZE,
    }),
    [sessionsWhere]
  );
  const {
    data: sessionsPages,
    fetchNextPage: fetchMoreSessions,
    hasNextPage: hasMoreSessions,
    isFetchingNextPage: isFetchingMoreSessions,
    isLoading: isLoadingSessions,
  } = useClientQueries(schema).sessions.useInfiniteFindMany(
    sessionsInfiniteArgs,
    {
      getNextPageParam: (lastPage, allPages) =>
        !lastPage || lastPage.length < PAGE_SIZE
          ? undefined
          : { ...sessionsInfiniteArgs, skip: allPages.flat().length },
      enabled:
        !!tagId && status === "authenticated" && activeTab === "sessions",
    }
  );
  const sessions = useMemo(
    () => sessionsPages?.pages.flat() ?? [],
    [sessionsPages]
  );

  const { data: sessionsCount } = useClientQueries(schema).sessions.useCount(
    {
      where: sessionsWhere,
    },
    {
      enabled: !!tagId && status === "authenticated",
    }
  );

  // Fetch test runs (infinite scroll)
  const testRunsInfiniteArgs = useMemo(
    () => ({
      where: testRunsWhere,
      select: {
        id: true,
        name: true,
        isCompleted: true,
      },
      orderBy: { createdAt: "desc" as const },
      take: PAGE_SIZE,
    }),
    [testRunsWhere]
  );
  const {
    data: testRunsPages,
    fetchNextPage: fetchMoreTestRuns,
    hasNextPage: hasMoreTestRuns,
    isFetchingNextPage: isFetchingMoreTestRuns,
    isLoading: isLoadingTestRuns,
  } = useClientQueries(schema).testRuns.useInfiniteFindMany(
    testRunsInfiniteArgs,
    {
      getNextPageParam: (lastPage, allPages) =>
        !lastPage || lastPage.length < PAGE_SIZE
          ? undefined
          : { ...testRunsInfiniteArgs, skip: allPages.flat().length },
      enabled:
        !!tagId && status === "authenticated" && activeTab === "testRuns",
    }
  );
  const testRuns = useMemo(
    () => testRunsPages?.pages.flat() ?? [],
    [testRunsPages]
  );

  const { data: testRunsCount } = useClientQueries(schema).testRuns.useCount(
    {
      where: testRunsWhere,
    },
    {
      enabled: !!tagId && status === "authenticated",
    }
  );

  // Map data for display
  const mappedCases = useMemo(() => {
    return (
      repositoryCases?.map((testCase) => ({
        id: testCase.id,
        name: testCase.name,
        source: testCase.source,
        automated: testCase.automated,
        hasParameters: testCase.hasParameters,
        projectId: Number(projectId),
      })) || []
    );
  }, [repositoryCases, projectId]);

  const mappedSessions = useMemo(() => {
    return (
      sessions?.map((session) => ({
        id: session.id,
        name: session.name,
        isCompleted: session.isCompleted,
        projectId: Number(projectId),
      })) || []
    );
  }, [sessions, projectId]);

  const mappedTestRuns = useMemo(() => {
    return (
      testRuns?.map((testRun) => ({
        id: testRun.id,
        name: testRun.name,
        isCompleted: testRun.isCompleted,
        projectId: Number(projectId),
      })) || []
    );
  }, [testRuns, projectId]);

  // Column definitions
  const caseColumns = useCaseColumns({
    testCases: t("common.fields.testCases"),
    type: t("common.fields.type"),
    manual: t("common.fields.manual"),
    automated: t("common.fields.automated"),
  });

  const sessionColumns = useSessionColumns({
    sessions: t("common.fields.sessions"),
    status: t("common.actions.status"),
    completed: t("common.fields.completed"),
    inProgress: t("milestones.statusLabels.IN_PROGRESS"),
  });

  const testRunColumns = useTestRunColumns({
    testRuns: t("common.fields.testRuns"),
    status: t("common.actions.status"),
    completed: t("common.fields.completed"),
    inProgress: t("milestones.statusLabels.IN_PROGRESS"),
  });

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  if (status === "loading" || isLoadingTag) {
    return null;
  }

  if (!session) {
    return null;
  }

  return (
    <Card className="flex w-full min-w-[400px]">
      <div className="flex-1 w-full relative">
        <CardHeader>
          <CardTitle>
            <div className="flex items-center justify-between text-primary text-xl md:text-2xl">
              <div className="flex items-center gap-2">
                <span>
                  {t("common.fields.testCases")}, {t("common.fields.testRuns")}{" "}
                  {t("common.and")} {t("sessions.title", { count: 2 })}{" "}
                  {t("common.for")}
                </span>
                <TagsDisplay id={Number(tagId)} name={tagName} size="large" />
              </div>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Search and Filters */}
          <div className="flex flex-col gap-4 mb-4">
            <div className="flex flex-row items-start">
              <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
                <Filter
                  key="tag-filter"
                  placeholder={t("tags.detail.filterPlaceholder")}
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                />
              </div>
            </div>

            {/* Filter controls */}
            <div className="flex flex-wrap items-center gap-6 rounded-md border p-3 bg-muted/30">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <FilterIcon className="h-4 w-4" />
                {t("common.ui.search.filters")}
                {activeFilterCount > 0 && (
                  <button
                    onClick={() =>
                      updateFilters({
                        hideCompletedSessions: false,
                        hideCompletedTestRuns: false,
                        caseType: "all",
                      })
                    }
                    className="inline-flex items-center gap-1 cursor-pointer"
                    data-testid="clear-all-filters"
                  >
                    <Badge
                      variant="secondary"
                      className="h-5 min-w-5 px-1.5 gap-1"
                    >
                      {activeFilterCount}
                      <X className="h-3 w-3" />
                    </Badge>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Label htmlFor="case-type-filter" className="text-sm">
                  {t("tags.detail.filters.caseTypeLabel")}
                </Label>
                <Select
                  value={filters.caseType}
                  onValueChange={(value: CaseTypeFilter) =>
                    updateFilters({ caseType: value })
                  }
                >
                  <SelectTrigger
                    id="case-type-filter"
                    className="w-[140px] h-8"
                    data-testid="case-type-filter-select"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {t("tags.detail.filters.allCases")}
                    </SelectItem>
                    <SelectItem value="manual">
                      {t("common.fields.manual")}
                    </SelectItem>
                    <SelectItem value="automated">
                      {t("common.fields.automated")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="hide-completed-runs"
                  checked={filters.hideCompletedTestRuns}
                  onCheckedChange={(checked) =>
                    updateFilters({ hideCompletedTestRuns: checked })
                  }
                  data-testid="hide-completed-runs-switch"
                />
                <Label
                  htmlFor="hide-completed-runs"
                  className="text-sm cursor-pointer"
                >
                  {t("tags.detail.filters.hideCompletedTestRuns")}
                </Label>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="hide-completed-sessions"
                  checked={filters.hideCompletedSessions}
                  onCheckedChange={(checked) =>
                    updateFilters({ hideCompletedSessions: checked })
                  }
                  data-testid="hide-completed-sessions-switch"
                />
                <Label
                  htmlFor="hide-completed-sessions"
                  className="text-sm cursor-pointer"
                >
                  {t("tags.detail.filters.hideCompletedSessions")}
                </Label>
              </div>
            </div>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as TabType)}
          >
            <TabsList className="mb-4">
              <TabsTrigger value="cases">
                {t("common.fields.testCases")} {`(${casesCount ?? 0})`}
              </TabsTrigger>
              <TabsTrigger value="testRuns">
                {t("common.fields.testRuns")} {`(${testRunsCount ?? 0})`}
              </TabsTrigger>
              <TabsTrigger value="sessions">
                {t("common.fields.sessions")} {`(${sessionsCount ?? 0})`}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="cases" className="max-w-full overflow-hidden">
              {(casesCount ?? 0) > 0 && (
                <p className="mb-2 text-right text-sm text-muted-foreground">
                  {t("admin.auditLogs.showing", {
                    loaded: mappedCases.length.toLocaleString(),
                    total: (casesCount ?? mappedCases.length).toLocaleString(),
                  })}
                </p>
              )}
              <div className="h-[calc(100vh-24rem)] min-h-[400px] w-full">
                <VirtualizedDataTable
                  columns={caseColumns as any}
                  data={mappedCases}
                  columnVisibility={{}}
                  onColumnVisibilityChange={() => {}}
                  isLoading={isLoadingCases || isFetchingMoreCases}
                  hasMore={!!hasMoreCases}
                  onLoadMore={fetchMoreCases}
                  resetKey={`cases|${debouncedSearchString}|${filters.caseType}`}
                  emptyMessage={
                    filters.caseType !== "all"
                      ? t("tags.detail.noFilterResults")
                      : t("tags.detail.noResults")
                  }
                  testIdPrefix="tag-detail-cases-table"
                  rowTestIdPrefix="tag-detail-case-row"
                />
              </div>
            </TabsContent>

            <TabsContent value="testRuns">
              {(testRunsCount ?? 0) > 0 && (
                <p className="mb-2 text-right text-sm text-muted-foreground">
                  {t("admin.auditLogs.showing", {
                    loaded: mappedTestRuns.length.toLocaleString(),
                    total: (
                      testRunsCount ?? mappedTestRuns.length
                    ).toLocaleString(),
                  })}
                </p>
              )}
              <div className="h-[calc(100vh-24rem)] min-h-[400px] w-full">
                <VirtualizedDataTable
                  columns={testRunColumns as any}
                  data={mappedTestRuns}
                  columnVisibility={{}}
                  onColumnVisibilityChange={() => {}}
                  isLoading={isLoadingTestRuns || isFetchingMoreTestRuns}
                  hasMore={!!hasMoreTestRuns}
                  onLoadMore={fetchMoreTestRuns}
                  resetKey={`testRuns|${debouncedSearchString}|${filters.hideCompletedTestRuns}`}
                  emptyMessage={
                    filters.hideCompletedTestRuns
                      ? t("tags.detail.noFilterResults")
                      : t("tags.detail.noResults")
                  }
                  testIdPrefix="tag-detail-runs-table"
                  rowTestIdPrefix="tag-detail-run-row"
                />
              </div>
            </TabsContent>

            <TabsContent value="sessions">
              {(sessionsCount ?? 0) > 0 && (
                <p className="mb-2 text-right text-sm text-muted-foreground">
                  {t("admin.auditLogs.showing", {
                    loaded: mappedSessions.length.toLocaleString(),
                    total: (
                      sessionsCount ?? mappedSessions.length
                    ).toLocaleString(),
                  })}
                </p>
              )}
              <div className="h-[calc(100vh-24rem)] min-h-[400px] w-full">
                <VirtualizedDataTable
                  columns={sessionColumns as any}
                  data={mappedSessions}
                  columnVisibility={{}}
                  onColumnVisibilityChange={() => {}}
                  isLoading={isLoadingSessions || isFetchingMoreSessions}
                  hasMore={!!hasMoreSessions}
                  onLoadMore={fetchMoreSessions}
                  resetKey={`sessions|${debouncedSearchString}|${filters.hideCompletedSessions}`}
                  emptyMessage={
                    filters.hideCompletedSessions
                      ? t("tags.detail.noFilterResults")
                      : t("tags.detail.noResults")
                  }
                  testIdPrefix="tag-detail-sessions-table"
                  rowTestIdPrefix="tag-detail-session-row"
                />
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </div>
    </Card>
  );
}
