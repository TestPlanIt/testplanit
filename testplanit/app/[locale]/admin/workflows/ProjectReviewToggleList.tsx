"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useDebounce } from "@/components/Debounce";
import { ProjectIcon } from "@/components/ProjectIcon";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { ProjectNameCell } from "@/components/tables/ProjectNameCell";
import { Switch } from "@/components/ui/switch";
import { ColumnDef } from "@tanstack/react-table";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useReviewFeatureEnabled } from "~/hooks/useReviewFeatureEnabled";

const PAGE_SIZE = 50;

type ProjectRow = {
  id: number;
  name: string;
  iconUrl: string | null;
  reviewWorkflowEnabled: boolean;
};

export function ProjectReviewToggleList() {
  const locale = useLocale();
  const t = useTranslations("admin.workflows.projectReviewToggleList");
  const tCommon = useTranslations("common");
  const tGlobal = useTranslations();

  const { systemEnabled, isLoading: featureLoading } =
    useReviewFeatureEnabled();

  const [searchString, setSearchString] = useState("");
  const debouncedSearch = useDebounce(searchString, 300);
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "name", direction: "asc" });

  const handleSortChange = useCallback(
    (column: string) => {
      const direction =
        sortConfig.column === column && sortConfig.direction === "asc"
          ? "desc"
          : "asc";
      setSortConfig({ column, direction });
    },
    [sortConfig]
  );

  const where = useMemo(
    () => ({
      isDeleted: false,
      name: { contains: debouncedSearch, mode: "insensitive" as const },
    }),
    [debouncedSearch]
  );

  const { data: count } = useClientQueries(schema).projects.useCount(
    { where },
    { enabled: systemEnabled === true }
  );

  // Infinite scroll accumulates pages; the virtualized table windows the DOM.
  const infiniteBaseArgs = useMemo(
    () => ({
      where,
      select: {
        id: true,
        name: true,
        iconUrl: true,
        reviewWorkflowEnabled: true,
      },
      orderBy: { [sortConfig.column]: sortConfig.direction },
      take: PAGE_SIZE,
    }),
    [where, sortConfig]
  );

  const {
    data: projectsPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useClientQueries(schema).projects.useInfiniteFindMany(infiniteBaseArgs, {
    getNextPageParam: (lastPage, allPages) =>
      !lastPage || lastPage.length < PAGE_SIZE
        ? undefined
        : { ...infiniteBaseArgs, skip: allPages.flat().length },
    enabled: systemEnabled === true,
  });

  const projects = useMemo(
    () => (projectsPages?.pages.flat() ?? []) as ProjectRow[],
    [projectsPages]
  );

  const { mutateAsync: updateProjects } =
    useClientQueries(schema).projects.useUpdate();
  const updateRef = useRef(updateProjects);
  useEffect(() => {
    updateRef.current = updateProjects;
  });

  const handleToggle = useCallback(
    async (id: number, name: string, enabled: boolean) => {
      try {
        await updateRef.current({
          where: { id },
          data: { reviewWorkflowEnabled: enabled },
        });
        toast.success(
          enabled ? t("enabledToast", { name }) : t("disabledToast", { name })
        );
      } catch {
        toast.error(t("saveError"));
      }
    },
    [t]
  );

  const columns: ColumnDef<ProjectRow>[] = useMemo(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: tCommon("name"),
        enableSorting: true,
        enableResizing: true,
        size: 500,
        cell: ({ row }) => (
          <div className="flex items-start gap-1">
            <span className="mt-1 shrink-0">
              <ProjectIcon iconUrl={row.original.iconUrl} />
            </span>
            <ProjectNameCell
              value={row.original.name}
              projectId={row.original.id}
              size="sm"
            />
          </div>
        ),
      },
      {
        id: "reviewWorkflowEnabled",
        accessorKey: "reviewWorkflowEnabled",
        header: t("columnHeader"),
        enableSorting: true,
        size: 120,
        cell: ({ row }) => {
          const { id, name, reviewWorkflowEnabled } = row.original;
          return (
            <div className="text-center">
              <Switch
                data-testid={`project-review-workflow-switch-${id}`}
                aria-label={t("toggleAria", { name })}
                checked={reviewWorkflowEnabled}
                onCheckedChange={(checked) => handleToggle(id, name, checked)}
              />
            </div>
          );
        },
      },
    ],
    [t, tCommon, handleToggle]
  );

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  if (featureLoading) return null;
  if (systemEnabled !== true) return null;

  const showEmptyState = !isLoading && projects.length === 0;

  return (
    <div data-testid="project-review-toggle-list-card">
      <div className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col grow w-full sm:w-1/3 min-w-[150px]">
          <Filter
            key="project-review-filter"
            placeholder={t("filterPlaceholder")}
            initialSearchString={searchString}
            onSearchChange={setSearchString}
            dataTestId="project-review-toggle-search"
          />
        </div>
        {projects.length > 0 && (
          <p className="text-sm text-muted-foreground shrink-0">
            {tGlobal("admin.auditLogs.showing", {
              loaded: projects.length.toLocaleString(locale),
              total: (count ?? projects.length).toLocaleString(locale),
            })}
          </p>
        )}
      </div>
      {showEmptyState && (
        <p
          data-testid="project-review-toggle-empty-state"
          className="mt-4 text-sm text-muted-foreground"
        >
          {t("emptyState")}
        </p>
      )}
      <div className="mt-4 h-[500px] min-h-[300px] w-full">
        <DataTable
          virtualized
          columns={columns as ColumnDef<any, any>[]}
          data={projects}
          onSortChange={handleSortChange}
          sortConfig={sortConfig}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
          isLoading={isLoading || isFetchingNextPage}
          hasMore={!!hasNextPage}
          onLoadMore={fetchNextPage}
          resetKey={`${debouncedSearch}|${sortConfig.column}|${sortConfig.direction}`}
          testIdPrefix="project-review-toggle-table"
          rowTestIdPrefix="project-review-toggle-row"
        />
      </div>
    </div>
  );
}
