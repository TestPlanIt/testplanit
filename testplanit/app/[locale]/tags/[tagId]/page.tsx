"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useParams } from "next/navigation";
import {
  useFindManyTags,
  useFindManyRepositoryCases,
  useFindManySessions,
  useFindManyTestRuns,
  useCountRepositoryCases,
  useCountSessions,
  useCountTestRuns,
} from "~/lib/hooks";
import { DataTable } from "@/components/tables/DataTable";
import {
  getCaseColumns,
  getSessionColumns,
  getTestRunColumns,
} from "./columns";
import { useDebounce } from "@/components/Debounce";
import { Filter } from "@/components/tables/Filter";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { TagsDisplay } from "@/components/tables/TagDisplay";
import { useTranslations } from "next-intl";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { defaultPageSizeOptions } from "~/lib/contexts/PaginationContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TabType = "cases" | "sessions" | "testRuns";

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

  // Add search filter
  const casesWhere = useMemo(() => {
    if (!debouncedSearchString.trim()) {
      return baseWhere;
    }
    return {
      ...baseWhere,
      OR: [
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
      ],
    };
  }, [baseWhere, debouncedSearchString]);

  const sessionsWhere = useMemo(() => {
    if (!debouncedSearchString.trim()) {
      return baseWhere;
    }
    return {
      ...baseWhere,
      name: {
        contains: debouncedSearchString.trim(),
        mode: "insensitive" as const,
      },
    };
  }, [baseWhere, debouncedSearchString]);

  const testRunsWhere = useMemo(() => {
    if (!debouncedSearchString.trim()) {
      return baseWhere;
    }
    return {
      ...baseWhere,
      name: {
        contains: debouncedSearchString.trim(),
        mode: "insensitive" as const,
      },
    };
  }, [baseWhere, debouncedSearchString]);

  // Fetch paginated test cases
  const { data: repositoryCases, isLoading: isLoadingCases } =
    useFindManyRepositoryCases(
      {
        where: casesWhere,
        select: {
          id: true,
          name: true,
          source: true,
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
        testCases: t("common.table.columns.testCases"),
        project: t("common.table.columns.project"),
        noProject: t("tags.noProject"),
      }),
    [t]
  );

  const sessionColumns = useMemo(
    () =>
      getSessionColumns({
        sessions: t("common.table.columns.sessions"),
        project: t("common.table.columns.project"),
        noProject: t("tags.noProject"),
      }),
    [t]
  );

  const testRunColumns = useMemo(
    () =>
      getTestRunColumns({
        testRuns: t("common.fields.testRuns"),
        project: t("common.table.columns.project"),
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

  const sessionsStartIndex = (sessionsPage - 1) * effectiveSessionsPageSize + 1;
  const sessionsEndIndex = Math.min(
    sessionsPage * effectiveSessionsPageSize,
    sessionsCount ?? 0
  );

  const testRunsStartIndex = (testRunsPage - 1) * effectiveTestRunsPageSize + 1;
  const testRunsEndIndex = Math.min(
    testRunsPage * effectiveTestRunsPageSize,
    testRunsCount ?? 0
  );

  // Reset page when search changes
  useEffect(() => {
    setCasesPage(1);
    setSessionsPage(1);
    setTestRunsPage(1);
  }, [debouncedSearchString]);

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
          <div className="flex flex-row items-start mb-4">
            <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
              <Filter
                key="tag-filter"
                placeholder={t("tags.detail.filterPlaceholder")}
                initialSearchString={searchString}
                onSearchChange={setSearchString}
              />
            </div>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as TabType)}
          >
            <TabsList className="mb-4">
              <TabsTrigger value="cases">
                {t("common.table.columns.testCases")} {`(${casesCount ?? 0})`}
              </TabsTrigger>
              <TabsTrigger value="testRuns">
                {t("common.fields.testRuns")} {`(${testRunsCount ?? 0})`}
              </TabsTrigger>
              <TabsTrigger value="sessions">
                {t("common.table.columns.sessions")} {`(${sessionsCount ?? 0})`}
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
                  {t("tags.detail.noResults")}
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
                  {t("tags.detail.noResults")}
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
                  {t("tags.detail.noResults")}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </div>
    </Card>
  );
}
