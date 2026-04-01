"use client";

import { useDebounce } from "@/components/Debounce";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
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
import { defaultPageSizeOptions } from "~/lib/contexts/PaginationContext";
import {
  useCountRepositoryCases,
  useCountSessions,
  useCountTestRuns,
  useFindManyRepositoryCases,
  useFindManySessions,
  useFindManyTags,
  useFindManyTestRuns,
} from "~/lib/hooks";
import { useRouter } from "~/lib/navigation";
import {
  getCaseColumns,
  getSessionColumns,
  getTestRunColumns,
} from "./columns";

type TabType = "cases" | "sessions" | "testRuns";
type CaseTypeFilter = "all" | "manual" | "automated";

interface TagDetailFilters {
  hideCompletedSessions: boolean;
  hideCompletedTestRuns: boolean;
  caseType: CaseTypeFilter;
}

const FILTER_STORAGE_KEY = "testplanit-tag-detail-filters";

function loadFilters(tagId: string): TagDetailFilters {
  try {
    const stored = localStorage.getItem(`${FILTER_STORAGE_KEY}-${tagId}`);
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

function saveFilters(tagId: string, filters: TagDetailFilters) {
  try {
    localStorage.setItem(
      `${FILTER_STORAGE_KEY}-${tagId}`,
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
  const { tagId } = useParams<{ tagId: string }>();
  const [searchString, setSearchString] = useState("");
  const debouncedSearchString = useDebounce(searchString, 500);
  const [activeTab, setActiveTab] = useState<TabType>("cases");

  // Filter state - loaded from localStorage
  const [filters, setFilters] = useState<TagDetailFilters>(() =>
    loadFilters(tagId)
  );

  // Persist filters to localStorage on change
  const updateFilters = useCallback(
    (update: Partial<TagDetailFilters>) => {
      setFilters((prev) => {
        const next = { ...prev, ...update };
        saveFilters(tagId, next);
        return next;
      });
    },
    [tagId]
  );

  // Count active filters for indicator
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.hideCompletedSessions) count++;
    if (filters.hideCompletedTestRuns) count++;
    if (filters.caseType !== "all") count++;
    return count;
  }, [filters]);

  // Pagination state for each tab
  const [casesPage, setCasesPage] = useState(1);
  const [casesPageSize, setCasesPageSize] = useState<number | "All">(25);
  const [sessionsPage, setSessionsPage] = useState(1);
  const [sessionsPageSize, setSessionsPageSize] = useState<number | "All">(25);
  const [testRunsPage, setTestRunsPage] = useState(1);
  const [testRunsPageSize, setTestRunsPageSize] = useState<number | "All">(25);

  const isAdmin = session?.user?.access === "ADMIN";
  const userId = session?.user?.id;

  // Convert page size to number for calculations
  const effectiveCasesPageSize =
    typeof casesPageSize === "number" ? casesPageSize : 999999;
  const effectiveSessionsPageSize =
    typeof sessionsPageSize === "number" ? sessionsPageSize : 999999;
  const effectiveTestRunsPageSize =
    typeof testRunsPageSize === "number" ? testRunsPageSize : 999999;

  // Fetch the tag metadata only
  const { data: tags, isLoading: isLoadingTag } = useFindManyTags(
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

  // Build where clause based on access control
  const baseWhere = useMemo(() => {
    const conditions: any = {
      isDeleted: false,
      tags: {
        some: {
          id: Number(tagId),
        },
      },
    };

    // Add project filter for non-admin users
    if (!isAdmin && userId) {
      conditions.project = {
        assignedUsers: {
          some: {
            userId: userId,
          },
        },
      };
    }

    return conditions;
  }, [tagId, isAdmin, userId]);

  // Add search + filter for cases
  const casesWhere = useMemo(() => {
    const where: any = { ...baseWhere };

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
  }, [baseWhere, debouncedSearchString, filters.caseType]);

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

  // Fetch paginated test cases
  const { data: repositoryCases, isLoading: isLoadingCases } =
    useFindManyRepositoryCases(
      {
        where: casesWhere,
        select: {
          id: true,
          name: true,
          source: true,
          automated: true,
          projectId: true,
          project: {
            select: {
              id: true,
              name: true,
              iconUrl: true,
            },
          },
        },
        orderBy: { name: "asc" as const },
        skip: (casesPage - 1) * effectiveCasesPageSize,
        take: effectiveCasesPageSize,
      },
      {
        enabled: !!tagId && status === "authenticated" && activeTab === "cases",
      }
    );

  const { data: casesCount } = useCountRepositoryCases(
    {
      where: casesWhere,
    },
    {
      enabled: !!tagId && status === "authenticated",
    }
  );

  // Fetch paginated sessions
  const { data: sessions, isLoading: isLoadingSessions } = useFindManySessions(
    {
      where: sessionsWhere,
      select: {
        id: true,
        name: true,
        isCompleted: true,
        projectId: true,
        project: {
          select: {
            id: true,
            name: true,
            iconUrl: true,
          },
        },
      },
      orderBy: { createdAt: "desc" as const },
      skip: (sessionsPage - 1) * effectiveSessionsPageSize,
      take: effectiveSessionsPageSize,
    },
    {
      enabled:
        !!tagId && status === "authenticated" && activeTab === "sessions",
    }
  );

  const { data: sessionsCount } = useCountSessions(
    {
      where: sessionsWhere,
    },
    {
      enabled: !!tagId && status === "authenticated",
    }
  );

  // Fetch paginated test runs
  const { data: testRuns, isLoading: isLoadingTestRuns } = useFindManyTestRuns(
    {
      where: testRunsWhere,
      select: {
        id: true,
        name: true,
        isCompleted: true,
        projectId: true,
        project: {
          select: {
            id: true,
            name: true,
            iconUrl: true,
          },
        },
      },
      orderBy: { createdAt: "desc" as const },
      skip: (testRunsPage - 1) * effectiveTestRunsPageSize,
      take: effectiveTestRunsPageSize,
    },
    {
      enabled:
        !!tagId && status === "authenticated" && activeTab === "testRuns",
    }
  );

  const { data: testRunsCount } = useCountTestRuns(
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
        projectId: testCase.projectId,
        projectName: testCase.project?.name || t("tags.noProject"),
        iconUrl: testCase.project?.iconUrl || null,
      })) || []
    );
  }, [repositoryCases, t]);

  const mappedSessions = useMemo(() => {
    return (
      sessions?.map((session) => ({
        id: session.id,
        name: session.name,
        isCompleted: session.isCompleted,
        projectId: session.projectId,
        projectName: session.project?.name || t("tags.noProject"),
        iconUrl: session.project?.iconUrl || null,
      })) || []
    );
  }, [sessions, t]);

  const mappedTestRuns = useMemo(() => {
    return (
      testRuns?.map((testRun) => ({
        id: testRun.id,
        name: testRun.name,
        isCompleted: testRun.isCompleted,
        projectId: testRun.projectId,
        projectName: testRun.project?.name || t("tags.noProject"),
        iconUrl: testRun.project?.iconUrl || null,
      })) || []
    );
  }, [testRuns, t]);

  // Column definitions
  const caseColumns = useMemo(
    () =>
      getCaseColumns({
        testCases: t("common.fields.testCases"),
        type: t("common.fields.type"),
        manual: t("common.fields.manual"),
        automated: t("common.fields.automated"),
        project: t("common.fields.project"),
        noProject: t("tags.noProject"),
      }),
    [t]
  );

  const sessionColumns = useMemo(
    () =>
      getSessionColumns({
        sessions: t("common.fields.sessions"),
        status: t("common.actions.status"),
        completed: t("common.fields.completed"),
        inProgress: t("milestones.statusLabels.IN_PROGRESS"),
        project: t("common.fields.project"),
        noProject: t("tags.noProject"),
      }),
    [t]
  );

  const testRunColumns = useMemo(
    () =>
      getTestRunColumns({
        testRuns: t("common.fields.testRuns"),
        status: t("common.actions.status"),
        completed: t("common.fields.completed"),
        inProgress: t("milestones.statusLabels.IN_PROGRESS"),
        project: t("common.fields.project"),
        noProject: t("tags.noProject"),
      }),
    [t]
  );

  // Pagination calculations
  const casesTotalPages = Math.ceil((casesCount ?? 0) / effectiveCasesPageSize);
  const sessionsTotalPages = Math.ceil(
    (sessionsCount ?? 0) / effectiveSessionsPageSize
  );
  const testRunsTotalPages = Math.ceil(
    (testRunsCount ?? 0) / effectiveTestRunsPageSize
  );

  const casesStartIndex = (casesPage - 1) * effectiveCasesPageSize + 1;
  const casesEndIndex = Math.min(
    casesPage * effectiveCasesPageSize,
    casesCount ?? 0
  );

  const sessionsStartIndex =
    (sessionsPage - 1) * effectiveSessionsPageSize + 1;
  const sessionsEndIndex = Math.min(
    sessionsPage * effectiveSessionsPageSize,
    sessionsCount ?? 0
  );

  const testRunsStartIndex =
    (testRunsPage - 1) * effectiveTestRunsPageSize + 1;
  const testRunsEndIndex = Math.min(
    testRunsPage * effectiveTestRunsPageSize,
    testRunsCount ?? 0
  );

  // Reset page when search or filters change
  useEffect(() => {
    setCasesPage(1);
    setSessionsPage(1);
    setTestRunsPage(1);
  }, [debouncedSearchString, filters]);

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
                <span>{t("tags.detail.title")}</span>
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
                <div className="mb-4 flex justify-end items-center gap-4">
                  <PaginationInfo
                    startIndex={casesStartIndex}
                    endIndex={casesEndIndex}
                    totalRows={casesCount ?? 0}
                    searchString={searchString}
                    pageSize={casesPageSize}
                    pageSizeOptions={defaultPageSizeOptions}
                    handlePageSizeChange={setCasesPageSize}
                  />
                  <PaginationComponent
                    currentPage={casesPage}
                    totalPages={casesTotalPages}
                    onPageChange={setCasesPage}
                  />
                </div>
              )}
              <DataTable
                columns={caseColumns}
                data={mappedCases}
                onSortChange={() => {}}
                sortConfig={{ column: "name", direction: "asc" }}
                columnVisibility={{}}
                onColumnVisibilityChange={() => {}}
                isLoading={isLoadingCases}
                pageSize={effectiveCasesPageSize}
              />
              {(casesCount ?? 0) === 0 && !isLoadingCases && (
                <div className="text-center text-muted-foreground py-8">
                  {filters.caseType !== "all"
                    ? t("tags.detail.noFilterResults")
                    : t("tags.detail.noResults")}
                </div>
              )}
            </TabsContent>

            <TabsContent value="testRuns">
              {(testRunsCount ?? 0) > 0 && (
                <div className="mb-4 flex justify-end items-center gap-4">
                  <PaginationInfo
                    startIndex={testRunsStartIndex}
                    endIndex={testRunsEndIndex}
                    totalRows={testRunsCount ?? 0}
                    searchString={searchString}
                    pageSize={testRunsPageSize}
                    pageSizeOptions={defaultPageSizeOptions}
                    handlePageSizeChange={setTestRunsPageSize}
                  />
                  <PaginationComponent
                    currentPage={testRunsPage}
                    totalPages={testRunsTotalPages}
                    onPageChange={setTestRunsPage}
                  />
                </div>
              )}
              <DataTable
                columns={testRunColumns}
                data={mappedTestRuns}
                onSortChange={() => {}}
                sortConfig={{ column: "name", direction: "asc" }}
                columnVisibility={{}}
                onColumnVisibilityChange={() => {}}
                isLoading={isLoadingTestRuns}
                pageSize={effectiveTestRunsPageSize}
              />
              {(testRunsCount ?? 0) === 0 && !isLoadingTestRuns && (
                <div className="text-center text-muted-foreground py-8">
                  {filters.hideCompletedTestRuns
                    ? t("tags.detail.noFilterResults")
                    : t("tags.detail.noResults")}
                </div>
              )}
            </TabsContent>

            <TabsContent value="sessions">
              {(sessionsCount ?? 0) > 0 && (
                <div className="mb-4 flex justify-end items-center gap-4">
                  <PaginationInfo
                    startIndex={sessionsStartIndex}
                    endIndex={sessionsEndIndex}
                    totalRows={sessionsCount ?? 0}
                    searchString={searchString}
                    pageSize={sessionsPageSize}
                    pageSizeOptions={defaultPageSizeOptions}
                    handlePageSizeChange={setSessionsPageSize}
                  />
                  <PaginationComponent
                    currentPage={sessionsPage}
                    totalPages={sessionsTotalPages}
                    onPageChange={setSessionsPage}
                  />
                </div>
              )}
              <DataTable
                columns={sessionColumns}
                data={mappedSessions}
                onSortChange={() => {}}
                sortConfig={{ column: "name", direction: "asc" }}
                columnVisibility={{}}
                onColumnVisibilityChange={() => {}}
                isLoading={isLoadingSessions}
                pageSize={effectiveSessionsPageSize}
              />
              {(sessionsCount ?? 0) === 0 && !isLoadingSessions && (
                <div className="text-center text-muted-foreground py-8">
                  {filters.hideCompletedSessions
                    ? t("tags.detail.noFilterResults")
                    : t("tags.detail.noResults")}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </div>
    </Card>
  );
}
