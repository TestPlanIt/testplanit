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
import { Tags } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useRouter } from "~/lib/navigation";
import { useColumns } from "./columns";

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
          { id: Number(projectId) },
        ],
      },
    },
    {
      enabled: isAuthenticated, // Only query when session is authenticated
      retry: 3, // Retry a few times in case of race conditions
      retryDelay: 1000, // Wait 1 second between retries
    }
  );

  const { data: repositoryCases, isLoading: isLoadingCases } = useClientQueries(
    schema
  ).repositoryCases.useFindMany(
    {
      where: {
        projectId: Number(projectId),
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        caseTags: {
          select: {
            tag: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    },
    {
      enabled: !!projectId,
    }
  );

  const { data: sessions, isLoading: isLoadingSessions } = useClientQueries(
    schema
  ).sessions.useFindMany(
    {
      where: {
        projectId: Number(projectId),
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        tags: {
          select: {
            id: true,
          },
        },
      },
    },
    {
      enabled: !!projectId,
    }
  );

  const { data: testRuns, isLoading: isLoadingRuns } = useClientQueries(
    schema
  ).testRuns.useFindMany(
    {
      where: {
        projectId: Number(projectId),
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        tags: {
          select: {
            id: true,
          },
        },
      },
    },
    {
      enabled: !!projectId,
    }
  );

  // Fetch ONLY basic tag data - no includes to avoid bind variable explosion
  const { data: tags, isLoading: isLoadingTags } = useClientQueries(
    schema
  ).tags.useFindMany(
    {
      where: {
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
      },
    },
    {
      enabled: !!projectId,
    }
  );

  const activeCaseMap = useMemo(() => {
    return (
      repositoryCases?.reduce(
        (acc, curr) => {
          acc[curr.id] = curr.name;
          return acc;
        },
        {} as Record<number, string>
      ) || {}
    );
  }, [repositoryCases]);

  const activeCaseIds = useMemo(
    () => repositoryCases?.map((c) => c.id) || [],
    [repositoryCases]
  );

  const untaggedCaseIds = useMemo(
    () =>
      repositoryCases
        ?.filter((c) => !c.caseTags || c.caseTags.length === 0)
        .map((c) => c.id) || [],
    [repositoryCases]
  );

  const activeSessionMap = useMemo(() => {
    return (
      sessions?.reduce(
        (acc, curr) => {
          acc[curr.id] = curr.name;
          return acc;
        },
        {} as Record<number, string>
      ) || {}
    );
  }, [sessions]);

  const activeSessionIds = useMemo(
    () => sessions?.map((s) => s.id) || [],
    [sessions]
  );

  const untaggedSessionIds = useMemo(
    () =>
      sessions
        ?.filter((s) => !s.tags || s.tags.length === 0)
        .map((s) => s.id) || [],
    [sessions]
  );

  const activeRunMap = useMemo(() => {
    return (
      testRuns?.reduce(
        (acc, curr) => {
          acc[curr.id] = curr.name;
          return acc;
        },
        {} as Record<number, string>
      ) || {}
    );
  }, [testRuns]);

  const activeRunIds = useMemo(
    () => testRuns?.map((r) => r.id) || [],
    [testRuns]
  );

  const untaggedRunIds = useMemo(
    () =>
      testRuns
        ?.filter((r) => !r.tags || r.tags.length === 0)
        .map((r) => r.id) || [],
    [testRuns]
  );

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

  const filteredTags = useMemo(() => {
    if (!tags) return [];

    // Build tag items from the existing data
    const tagItems = new Map<
      number,
      {
        repositoryCases: Array<{ id: number; name: string }>;
        sessions: Array<{ id: number; name: string; isCompleted: any }>;
        testRuns: Array<{ id: number; name: string; isCompleted?: boolean }>;
      }
    >();

    // Collect cases per tag
    repositoryCases?.forEach((repositoryCase) => {
      repositoryCase.caseTags?.forEach((ct) => {
        const tag = ct.tag;
        const current = tagItems.get(tag.id) || {
          repositoryCases: [],
          sessions: [],
          testRuns: [],
        };
        current.repositoryCases.push({
          id: repositoryCase.id,
          name: repositoryCase.name,
        });
        tagItems.set(tag.id, current);
      });
    });

    // Collect sessions per tag
    sessions?.forEach((session) => {
      session.tags?.forEach((tag) => {
        const current = tagItems.get(tag.id) || {
          repositoryCases: [],
          sessions: [],
          testRuns: [],
        };
        current.sessions.push({
          id: session.id,
          name: session.name,
          isCompleted: false,
        });
        tagItems.set(tag.id, current);
      });
    });

    // Collect runs per tag
    testRuns?.forEach((testRun) => {
      testRun.tags?.forEach((tag) => {
        const current = tagItems.get(tag.id) || {
          repositoryCases: [],
          sessions: [],
          testRuns: [],
        };
        current.testRuns.push({
          id: testRun.id,
          name: testRun.name,
          isCompleted: false,
        });
        tagItems.set(tag.id, current);
      });
    });

    const filtered = tags
      .filter((tag) => {
        const items = tagItems.get(tag.id);
        const hasItems =
          items &&
          (items.repositoryCases.length > 0 ||
            items.sessions.length > 0 ||
            items.testRuns.length > 0);
        const matchesSearch = tag.name
          .toLowerCase()
          .includes(debouncedSearchString.toLowerCase());
        return hasItems && matchesSearch;
      })
      .map((tag) => {
        const items = tagItems.get(tag.id) || {
          repositoryCases: [],
          sessions: [],
          testRuns: [],
        };
        return {
          ...tag,
          repositoryCases: items.repositoryCases,
          sessions: items.sessions,
          testRuns: items.testRuns,
        };
      });

    // Apply sorting based on sortConfig
    return filtered.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortConfig.column) {
        case "name":
          aValue = a.name.toLowerCase();
          bValue = b.name.toLowerCase();
          break;
        case "cases":
          aValue = a.repositoryCases.filter((c) =>
            Object.prototype.hasOwnProperty.call(activeCaseMap, c.id)
          ).length;
          bValue = b.repositoryCases.filter((c) =>
            Object.prototype.hasOwnProperty.call(activeCaseMap, c.id)
          ).length;
          break;
        case "sessions":
          aValue = a.sessions.filter((s) =>
            Object.prototype.hasOwnProperty.call(activeSessionMap, s.id)
          ).length;
          bValue = b.sessions.filter((s) =>
            Object.prototype.hasOwnProperty.call(activeSessionMap, s.id)
          ).length;
          break;
        case "runs":
          aValue = a.testRuns.filter((r) =>
            Object.prototype.hasOwnProperty.call(activeRunMap, r.id)
          ).length;
          bValue = b.testRuns.filter((r) =>
            Object.prototype.hasOwnProperty.call(activeRunMap, r.id)
          ).length;
          break;
        default:
          aValue = a.name.toLowerCase();
          bValue = b.name.toLowerCase();
      }

      // Handle string comparison
      if (typeof aValue === "string" && typeof bValue === "string") {
        return sortConfig.direction === "asc"
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      // Handle numeric comparison
      if (sortConfig.direction === "asc") {
        return aValue - bValue;
      } else {
        return bValue - aValue;
      }
    });
  }, [
    tags,
    repositoryCases,
    sessions,
    testRuns,
    debouncedSearchString,
    sortConfig,
    activeCaseMap,
    activeSessionMap,
    activeRunMap,
  ]);

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

  const isLoadingCounts = isLoadingCases || isLoadingSessions || isLoadingRuns;

  const columns = useColumns(
    projectId as string,
    activeCaseMap,
    activeSessionMap,
    activeRunMap,
    t,
    isLoadingCounts
  );

  // Wait for all data to load - this prevents the flash
  if (
    isAuthLoading ||
    isLoadingTags ||
    isLoadingCases ||
    isLoadingSessions ||
    isLoadingRuns
  ) {
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
          <CardTitle>
            <SectionHeader className="flex items-center justify-between pb-2 pt-1">
              <CardTitle>{t("common.fields.tags")}</CardTitle>
              <Button
                variant="default"
                onClick={() => setShowAutoTagWizard(true)}
                disabled={
                  activeCaseIds.length +
                    activeSessionIds.length +
                    activeRunIds.length ===
                  0
                }
                data-testid="ai-auto-tag-button"
              >
                <Tags className="h-4 w-4" />
                {t("autoTag.actions.aiAutoTag")}
              </Button>
            </SectionHeader>
          </CardTitle>
          <CardDescription className="uppercase">
            <span className="flex items-center gap-2 uppercase shrink-0">
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

            {filteredTags.length > 0 && (
              <p className="text-sm text-muted-foreground shrink-0">
                {t("admin.auditLogs.showing", {
                  loaded: filteredTags.length.toLocaleString(),
                  total: filteredTags.length.toLocaleString(),
                })}
              </p>
            )}
          </div>
          <div className="mt-4 w-full">
            <VirtualizedDataTable
              columns={columns as any}
              data={filteredTags as any}
              onSortChange={handleSortChange}
              sortConfig={sortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
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
