"use client";

import { useDebounce } from "@/components/Debounce";
import { ProjectIcon } from "@/components/ProjectIcon";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { usePageSizeOptions } from "~/hooks/usePageSizeOptions";
import { useReviewFeatureEnabled } from "~/hooks/useReviewFeatureEnabled";
import { usePagination } from "~/lib/contexts/PaginationContext";
import {
  useCountProjects,
  useFindManyProjects,
  useUpdateProjects,
} from "~/lib/hooks";

type ProjectRow = {
  id: number;
  name: string;
  iconUrl: string | null;
  reviewWorkflowEnabled: boolean;
};

export function ProjectReviewToggleList() {
  const t = useTranslations("admin.workflows.projectReviewToggleList");
  const tCommon = useTranslations("common");

  const { systemEnabled, isLoading: featureLoading } =
    useReviewFeatureEnabled();

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
  const pageSizeOptions = usePageSizeOptions(totalItems);

  const [searchString, setSearchString] = useState("");
  const debouncedSearch = useDebounce(searchString, 300);

  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const skip = (currentPage - 1) * effectivePageSize;

  const where = useMemo(
    () => ({
      isDeleted: false,
      name: { contains: debouncedSearch, mode: "insensitive" as const },
    }),
    [debouncedSearch]
  );

  const { data: count } = useCountProjects(
    { where },
    { enabled: systemEnabled === true }
  );

  useEffect(() => {
    if (typeof count === "number") setTotalItems(count);
  }, [count, setTotalItems]);

  const { data: projects, isLoading } = useFindManyProjects(
    {
      where,
      select: {
        id: true,
        name: true,
        iconUrl: true,
        reviewWorkflowEnabled: true,
      },
      orderBy: { name: "asc" },
      take: effectivePageSize > 0 ? effectivePageSize : undefined,
      skip,
    },
    { enabled: systemEnabled === true }
  );

  const { mutateAsync: updateProjects } = useUpdateProjects();
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

  const prevSearchRef = useRef(searchString);
  const prevPageSizeRef = useRef(pageSize);
  useEffect(() => {
    if (searchString === prevSearchRef.current) return;
    prevSearchRef.current = searchString;
    setCurrentPage(1);
  }, [searchString, setCurrentPage]);
  useEffect(() => {
    if (pageSize === prevPageSizeRef.current) return;
    prevPageSizeRef.current = pageSize;
    setCurrentPage(1);
  }, [pageSize, setCurrentPage]);

  const columns: ColumnDef<ProjectRow>[] = useMemo(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: tCommon("name"),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <ProjectIcon iconUrl={row.original.iconUrl} />
            <span>{row.original.name}</span>
          </div>
        ),
      },
      {
        id: "reviewWorkflowEnabled",
        accessorKey: "reviewWorkflowEnabled",
        header: t("columnHeader"),
        enableSorting: false,
        size: 120,
        cell: ({ row }) => {
          const { id, name, reviewWorkflowEnabled } = row.original;
          return (
            <div className="text-center">
              <Switch
                data-testid={`project-review-workflow-switch-${id}`}
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

  const showEmptyState =
    !isLoading && (projects?.length ?? 0) === 0 && totalItems === 0;

  return (
    <Card data-testid="project-review-toggle-list-card">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-row items-start">
          <div className="flex flex-col grow w-full sm:w-1/3 min-w-[150px]">
            <Filter
              key="project-review-filter"
              placeholder={t("filterPlaceholder")}
              initialSearchString={searchString}
              onSearchChange={setSearchString}
              dataTestId="project-review-toggle-search"
            />
          </div>
          <div className="flex flex-col w-full sm:w-2/3 items-end">
            {totalItems > 0 && (
              <>
                <PaginationInfo
                  startIndex={startIndex}
                  endIndex={endIndex}
                  totalRows={totalItems}
                  searchString={searchString}
                  pageSize={typeof pageSize === "number" ? pageSize : "All"}
                  pageSizeOptions={pageSizeOptions}
                  handlePageSizeChange={setPageSize}
                />
                <PaginationComponent
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                />
              </>
            )}
          </div>
        </div>
        {showEmptyState && (
          <p
            data-testid="project-review-toggle-empty-state"
            className="mt-4 text-sm text-muted-foreground"
          >
            {t("emptyState")}
          </p>
        )}
        <div className="mt-4">
          <DataTable
            columns={columns}
            data={(projects as ProjectRow[]) ?? []}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            isLoading={isLoading}
            pageSize={typeof pageSize === "number" ? pageSize : 10}
          />
        </div>
      </CardContent>
    </Card>
  );
}
