"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { AutoTagWizardDialog } from "@/components/auto-tag/AutoTagWizardDialog";
import { useDebounce } from "@/components/Debounce";
import { ProjectIcon } from "@/components/ProjectIcon";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import { Filter } from "@/components/tables/Filter";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageTitle, SectionHeader } from "@/components/ui/typography";
import { HelpPopover } from "@/components/ui/help-popover";
import { Tags } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useRouter } from "~/lib/navigation";
import { ExtendedTags, useColumns } from "./columns";

const PAGE_SIZE = 50;

// Count columns are derived from filtered `_count` and can't be ordered across
// pages by the database (Prisma can't sort on a filtered relation count).
// Sorting by one fetches the full project-scoped set once and renders it through
// the same virtualized table; "name" drives a genuine server-side infinite fetch.
const COUNT_SORT_COLUMNS = ["cases", "sessions", "runs"];

export default function ProjectTagListPage() {
  return <TagList />;
}

function TagList() {
  const {
    session,
    isLoading: isAuthLoading,
    isAuthenticated,
  } = useRequireAuth();
  const router = useRouter();
  const { projectId } = useParams<{ projectId: string }>();
  const projectIdNumber = Number(projectId);
  const t = useTranslations();
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({
    column: "name",
    direction: "asc",
  });

  // Valid column IDs for sorting
  const validColumnIds = useMemo(
    () => ["name", "cases", "sessions", "runs"],
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
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  const { data: project } = useClientQueries(schema).projects.useFindFirst(
    {
      where: {
        AND: [
          {
            isDeleted: false,
          },
          { id: projectIdNumber },
        ],
      },
    },
    {
      enabled: isAuthenticated, // Only query when session is authenticated
      retry: 3, // Retry a few times in case of race conditions
      retryDelay: 1000, // Wait 1 second between retries
    }
  );

  // Only tags with at least one active (non-deleted, in-project) case, session,
  // or run are shown — mirrors the project overview's tag scoping.
  const tagsWhere = useMemo(() => {
    const conditions: Array<Record<string, unknown>> = [
      { isDeleted: false },
      {
        OR: [
          {
            caseTags: {
              some: { case: { projectId: projectIdNumber, isDeleted: false } },
            },
          },
          {
            testRuns: {
              some: { projectId: projectIdNumber, isDeleted: false },
            },
          },
          {
            sessions: {
              some: { projectId: projectIdNumber, isDeleted: false },
            },
          },
        ],
      },
    ];

    const trimmed = debouncedSearchString.trim();
    if (trimmed) {
      conditions.push({
        name: { contains: trimmed, mode: "insensitive" as const },
      });
    }

    return { AND: conditions };
  }, [projectIdNumber, debouncedSearchString]);

  // Per-tag counts scoped to this project. Filtered `_count` keeps the counts
  // accurate without loading every case/session/run into the client.
  const tagsSelect = useMemo(
    () =>
      ({
        id: true,
        name: true,
        _count: {
          select: {
            caseTags: {
              where: { case: { projectId: projectIdNumber, isDeleted: false } },
            },
            testRuns: {
              where: { projectId: projectIdNumber, isDeleted: false },
            },
            sessions: {
              where: { projectId: projectIdNumber, isDeleted: false },
            },
          },
        },
      }) as const,
    [projectIdNumber]
  );

  const isCountSort = COUNT_SORT_COLUMNS.includes(sortConfig.column);

  const orderBy = useMemo(() => {
    // Only "name" is a real DB column; count columns sort client-side over the
    // full set (see COUNT_SORT_COLUMNS).
    if (sortConfig.column === "name") {
      return { name: sortConfig.direction } as const;
    }
    return { name: "asc" as const };
  }, [sortConfig]);

  const infiniteBaseArgs = useMemo(
    () => ({
      where: tagsWhere,
      select: tagsSelect,
      orderBy,
      take: PAGE_SIZE,
    }),
    [tagsWhere, tagsSelect, orderBy]
  );

  const queryEnabled = isAuthenticated && Number.isFinite(projectIdNumber);

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
    enabled: queryEnabled && !isCountSort,
  });

  const { data: allTags, isLoading: isLoadingAll } = useClientQueries(
    schema
  ).tags.useFindMany(
    { where: tagsWhere, select: tagsSelect, orderBy },
    { enabled: queryEnabled && isCountSort }
  );

  const { data: tagsCount } = useClientQueries(schema).tags.useCount(
    { where: tagsWhere },
    { enabled: queryEnabled }
  );

  const rawTags = useMemo(
    () =>
      isCountSort
        ? (allTags ?? [])
        : ((infinitePages?.pages.flat() as unknown[]) ?? []),
    [isCountSort, allTags, infinitePages]
  );

  const isLoadingTags = isCountSort ? isLoadingAll : isLoadingInfinite;

  const mappedTags = useMemo<ExtendedTags[]>(() => {
    const mapped = (rawTags as any[]).map((tag) => ({
      id: tag.id,
      name: tag.name,
      casesCount: tag._count?.caseTags ?? 0,
      sessionsCount: tag._count?.sessions ?? 0,
      runsCount: tag._count?.testRuns ?? 0,
    }));

    if (isCountSort) {
      return [...mapped].sort((a, b) => {
        let aValue = 0;
        let bValue = 0;
        switch (sortConfig.column) {
          case "cases":
            aValue = a.casesCount;
            bValue = b.casesCount;
            break;
          case "sessions":
            aValue = a.sessionsCount;
            bValue = b.sessionsCount;
            break;
          case "runs":
            aValue = a.runsCount;
            bValue = b.runsCount;
            break;
        }
        return sortConfig.direction === "asc"
          ? aValue - bValue
          : bValue - aValue;
      });
    }

    return mapped;
  }, [rawTags, isCountSort, sortConfig]);

  // ── AI Auto-Tag ──────────────────────────────────────────────────────
  const searchParams = useSearchParams();
  const [showAutoTagWizard, setShowAutoTagWizard] = useState(false);

  // Auto-open wizard when navigated with ?autoTag=true, then clear the param
  useEffect(() => {
    if (searchParams.get("autoTag") === "true") {
      setShowAutoTagWizard(true);
      // Remove the search param so closing the dialog isn't blocked
      const url = new URL(window.location.href);
      url.searchParams.delete("autoTag");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The button's enabled state only needs to know whether the project has any
  // taggable entities — cheap COUNT queries instead of loading every row.
  const { data: caseTaggableCount } = useClientQueries(
    schema
  ).repositoryCases.useCount(
    { where: { projectId: projectIdNumber, isDeleted: false } },
    { enabled: queryEnabled }
  );
  const { data: sessionTaggableCount } = useClientQueries(
    schema
  ).sessions.useCount(
    { where: { projectId: projectIdNumber, isDeleted: false } },
    { enabled: queryEnabled }
  );
  const { data: runTaggableCount } = useClientQueries(schema).testRuns.useCount(
    { where: { projectId: projectIdNumber, isDeleted: false } },
    { enabled: queryEnabled }
  );
  const hasTaggableEntities =
    (caseTaggableCount ?? 0) +
      (sessionTaggableCount ?? 0) +
      (runTaggableCount ?? 0) >
    0;

  // The wizard needs the full id lists (all + untagged) per entity type. These
  // are only fetched once the wizard opens so the page itself stays light.
  const { data: wizardCases } = useClientQueries(
    schema
  ).repositoryCases.useFindMany(
    {
      where: { projectId: projectIdNumber, isDeleted: false },
      select: { id: true, caseTags: { select: { tagId: true } } },
    },
    { enabled: queryEnabled && showAutoTagWizard }
  );
  const { data: wizardSessions } = useClientQueries(
    schema
  ).sessions.useFindMany(
    {
      where: { projectId: projectIdNumber, isDeleted: false },
      select: { id: true, tags: { select: { id: true } } },
    },
    { enabled: queryEnabled && showAutoTagWizard }
  );
  const { data: wizardRuns } = useClientQueries(schema).testRuns.useFindMany(
    {
      where: { projectId: projectIdNumber, isDeleted: false },
      select: { id: true, tags: { select: { id: true } } },
    },
    { enabled: queryEnabled && showAutoTagWizard }
  );

  const activeCaseIds = useMemo(
    () => wizardCases?.map((c: any) => c.id) ?? [],
    [wizardCases]
  );
  const untaggedCaseIds = useMemo(
    () =>
      wizardCases
        ?.filter((c: any) => !c.caseTags || c.caseTags.length === 0)
        .map((c: any) => c.id) ?? [],
    [wizardCases]
  );
  const activeSessionIds = useMemo(
    () => wizardSessions?.map((s: any) => s.id) ?? [],
    [wizardSessions]
  );
  const untaggedSessionIds = useMemo(
    () =>
      wizardSessions
        ?.filter((s: any) => !s.tags || s.tags.length === 0)
        .map((s: any) => s.id) ?? [],
    [wizardSessions]
  );
  const activeRunIds = useMemo(
    () => wizardRuns?.map((r: any) => r.id) ?? [],
    [wizardRuns]
  );
  const untaggedRunIds = useMemo(
    () =>
      wizardRuns
        ?.filter((r: any) => !r.tags || r.tags.length === 0)
        .map((r: any) => r.id) ?? [],
    [wizardRuns]
  );

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
  };

  const columns = useColumns(projectId as string, t, false);

  // Wait only for auth + the project query to resolve. `project === undefined`
  // means the project query hasn't resolved yet; a resolved `null` below means
  // it genuinely doesn't exist. The tags table renders its own loading state so
  // rows stream in progressively instead of blocking the whole page.
  if (isAuthLoading || project === undefined) {
    return null;
  }

  // NOW check if project exists - only after loading is complete
  if (!project) {
    return (
      <Card className="flex flex-col w-full min-w-[400px] h-full">
        <CardContent className="flex flex-col items-center justify-center h-full">
          <PageTitle className="mb-2">
            {t("common.errors.projectNotFound")}
          </PageTitle>
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
        <CardHeader id="tags-page-header">
          <div className="flex items-center justify-between gap-2">
            <SectionHeader className="flex items-center gap-2">
              <CardTitle>{t("common.fields.tags")}</CardTitle>
              <HelpPopover helpKey="projectTags" />
            </SectionHeader>
            <Button
              variant="default"
              onClick={() => setShowAutoTagWizard(true)}
              disabled={!hasTaggableEntities}
              data-testid="ai-auto-tag-button"
              aria-label={t("autoTag.actions.aiAutoTag")}
              className="group gap-0 transition-all duration-200 hover:gap-2"
            >
              <Tags className="h-4 w-4" />
              <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-xs">
                {t("autoTag.actions.aiAutoTag")}
              </span>
            </Button>
          </div>
          <CardDescription>
            <span className="flex items-center gap-2 uppercase">
              <ProjectIcon iconUrl={project?.iconUrl} />
              {project?.name}
            </span>
          </CardDescription>
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
              columns={columns as any}
              data={mappedTags as any}
              onSortChange={handleSortChange}
              sortConfig={sortConfig}
              isLoading={isLoadingTags || isFetchingNextPage}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              hasMore={isCountSort ? false : !!hasNextPage}
              onLoadMore={fetchNextPage}
              fillViewport
              resetKey={`${debouncedSearchString}|${sortConfig.column}|${sortConfig.direction}`}
              testIdPrefix="project-tags-table"
              rowTestIdPrefix="project-tag-row"
            />
          </div>
        </CardContent>
      </Card>
      <AutoTagWizardDialog
        open={showAutoTagWizard}
        onOpenChange={setShowAutoTagWizard}
        projectId={projectId as string}
        caseIds={activeCaseIds}
        sessionIds={activeSessionIds}
        runIds={activeRunIds}
        untaggedCaseIds={untaggedCaseIds}
        untaggedSessionIds={untaggedSessionIds}
        untaggedRunIds={untaggedRunIds}
      />
    </main>
  );
}
