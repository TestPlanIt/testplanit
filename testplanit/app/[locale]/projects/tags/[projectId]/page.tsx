"use client";

import { useQuery } from "@tanstack/react-query";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { AutoTagWizardDialog } from "@/components/auto-tag/AutoTagWizardDialog";
import { ProjectIcon } from "@/components/ProjectIcon";
import { DataTable } from "@/components/tables/DataTable";
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
import { useLocale, useTranslations } from "next-intl";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useRouter } from "~/lib/navigation";
import { ExtendedTags, useColumns } from "./columns";

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
  const locale = useLocale();
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

  const queryEnabled = isAuthenticated && Number.isFinite(projectIdNumber);

  // Full project-scoped tag set (only tags with at least one active
  // case/session/run, per-tag counts scoped to this project) from a server
  // endpoint driven off baseDb — the policy-enforced ZenStack hooks this
  // replaced re-inlined the Projects ACL as a correlated per-row subquery at
  // every relation-filter site (see app/api/tags/project-list/route.ts).
  // A project's tag list is small, so search/sort/pagination happen in memory.
  const { data: allTags, isLoading: isLoadingTags } = useQuery({
    queryKey: ["projectTagList", projectIdNumber],
    queryFn: async () => {
      const response = await fetch(
        `/api/tags/project-list?projectId=${projectIdNumber}`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch project tags");
      }
      const body = await response.json();
      return body.tags as ExtendedTags[];
    },
    enabled: queryEnabled,
  });

  const mappedTags = useMemo<ExtendedTags[]>(() => {
    const trimmed = searchString.trim().toLowerCase();
    const filtered = trimmed
      ? (allTags ?? []).filter((tag) =>
          tag.name.toLowerCase().includes(trimmed)
        )
      : (allTags ?? []);

    const direction = sortConfig.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortConfig.column) {
        case "cases":
          return (a.casesCount - b.casesCount) * direction;
        case "sessions":
          return (a.sessionsCount - b.sessionsCount) * direction;
        case "runs":
          return (a.runsCount - b.runsCount) * direction;
        default:
          return a.name.localeCompare(b.name) * direction;
      }
    });
  }, [allTags, searchString, sortConfig]);

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
            <span className="flex items-center gap-2">
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
                  loaded: mappedTags.length.toLocaleString(locale),
                  total: (allTags?.length ?? mappedTags.length).toLocaleString(
                    locale
                  ),
                })}
              </p>
            )}
          </div>
          <div className="mt-4 w-full">
            <DataTable
              virtualized
              columns={columns as any}
              data={mappedTags as any}
              onSortChange={handleSortChange}
              sortConfig={sortConfig}
              isLoading={isLoadingTags}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              fillViewport
              resetKey={`${searchString}|${sortConfig.column}|${sortConfig.direction}`}
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
