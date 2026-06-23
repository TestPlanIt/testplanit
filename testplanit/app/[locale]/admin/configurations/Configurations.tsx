import { useDebounce } from "@/components/Debounce";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { CustomColumnMeta } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { ProjectIcon } from "@/components/ProjectIcon";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RowSelectionState } from "@tanstack/react-table";
import { Boxes, PenSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { searchProjects } from "~/app/actions/searchProjects";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { usePagination } from "~/lib/contexts/PaginationContext";
import { usePageSizeOptions } from "~/hooks/usePageSizeOptions";
import AddConfigurationWizard from "./AddConfigurationWizard";
import { BulkEditConfigurations } from "./BulkEditConfigurations";
import { ConfigWithVariants, useColumns } from "./configColumns";
import { DeleteConfiguration } from "./DeleteConfig";
import { EditConfiguration } from "./EditConfig";

export default function ConfigurationList(): React.ReactElement {
  return <Configurations />;
}

function Configurations(): React.ReactElement | null {
  const {
    session,
    isLoading: isAuthLoading,
    isAuthenticated,
  } = useRequireAuth();
  const t = useTranslations("admin.configurations");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
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
  const [sortConfig, setSortConfig] = useState<
    | {
        column: string;
        direction: "asc" | "desc";
      }
    | undefined
  >({
    column: "name",
    direction: "asc",
  });
  const [searchString, setSearchString] = useState("");
  const debouncedSearchString = useDebounce(searchString, 500);
  const [projectFilter, setProjectFilter] = useState<{
    id: number;
    name: string;
    iconUrl: string | null;
  } | null>(null);

  // Calculate skip and take based on pageSize
  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const skip = (currentPage - 1) * effectivePageSize;

  // Fetch ALL configurations (no pagination, no search filter in query)
  const { data: allConfigurations, isLoading } = useClientQueries(schema).configurations.useFindMany(
    {
      orderBy: sortConfig
        ? sortConfig.column === "variants" || sortConfig.column === "projects"
          ? { [sortConfig.column]: { _count: sortConfig.direction } }
          : { [sortConfig.column]: sortConfig.direction }
        : { name: "asc" },
      where: {
        isDeleted: false,
      },
      include: {
        variants: { include: { variant: true } },
        projects: {
          select: {
            projectId: true,
            project: { select: { id: true, name: true, iconUrl: true } },
          },
        },
      },
    },
    {
      enabled: !!session?.user,
      refetchOnWindowFocus: true,
    }
  );

  // Filter configurations client-side based on search string and project
  const filteredConfigurations = useMemo(() => {
    if (!allConfigurations) return [];

    let result = allConfigurations;

    if (projectFilter) {
      result = result.filter((config) =>
        config.projects?.some((p) => p.projectId === projectFilter.id)
      );
    }

    const searchLower = debouncedSearchString.trim().toLowerCase();
    if (searchLower) {
      result = result.filter((config) =>
        config.name.toLowerCase().includes(searchLower)
      );
    }

    return result;
  }, [allConfigurations, debouncedSearchString, projectFilter]);

  // Update total items based on filtered configurations count
  useEffect(() => {
    setTotalItems(filteredConfigurations.length);
  }, [filteredConfigurations, setTotalItems]);

  // Apply client-side pagination
  const configurations = useMemo(() => {
    return filteredConfigurations.slice(skip, skip + effectivePageSize);
  }, [filteredConfigurations, skip, effectivePageSize]);

  const { mutate: updateConfiguration } = useClientQueries(schema).configurations.useUpdate();

  // Stabilize mutation ref — ZenStack's mutate changes identity every render
  const updateConfigurationRef = useRef(updateConfiguration);
  useEffect(() => {
    updateConfigurationRef.current = updateConfiguration;
  });

  const handleToggle = useCallback((id: number, isEnabled: boolean) => {
    updateConfigurationRef.current({
      where: { id },
      data: { isEnabled },
    });
  }, []);

  const [editingConfiguration, setEditingConfiguration] =
    useState<ConfigWithVariants | null>(null);
  const [deletingConfiguration, setDeletingConfiguration] =
    useState<ConfigWithVariants | null>(null);

  // Row-selection state for bulk edit. We track configuration IDs (not row
  // indices) so selection survives pagination and sorting; the rowSelection
  // passed to the DataTable is derived from this set for the current page.
  const [selectedConfigurationIds, setSelectedConfigurationIds] = useState<
    number[]
  >([]);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(
    null
  );
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);

  // Shift-aware per-row checkbox handler: plain click toggles a single row,
  // shift+click adds every row between the last clicked row and this one.
  const handleCheckboxClick = useCallback(
    (rowIndex: number, event: React.MouseEvent) => {
      const clicked = configurations[rowIndex];
      if (!clicked) return;
      if (
        event.shiftKey &&
        lastSelectedIndex !== null &&
        lastSelectedIndex !== rowIndex
      ) {
        const start = Math.min(lastSelectedIndex, rowIndex);
        const end = Math.max(lastSelectedIndex, rowIndex);
        const rangeIds: number[] = [];
        for (let i = start; i <= end; i++) {
          const c = configurations[i];
          if (c) rangeIds.push(c.id);
        }
        setSelectedConfigurationIds((prev) =>
          Array.from(new Set([...prev, ...rangeIds]))
        );
      } else {
        setSelectedConfigurationIds((prev) =>
          prev.includes(clicked.id)
            ? prev.filter((id) => id !== clicked.id)
            : [...prev, clicked.id]
        );
        setLastSelectedIndex(rowIndex);
      }
    },
    [configurations, lastSelectedIndex]
  );

  // Shift-aware select-all checkbox handler: plain click toggles the current
  // page; shift+click toggles every filtered configuration across pages.
  const handleSelectAllClick = useCallback(
    (event: React.MouseEvent) => {
      const scopeIds = (
        event.shiftKey ? filteredConfigurations : configurations
      ).map((c) => c.id);
      if (scopeIds.length === 0) return;
      setSelectedConfigurationIds((prev) => {
        const prevSet = new Set(prev);
        const allInScopeSelected = scopeIds.every((id) => prevSet.has(id));
        if (allInScopeSelected) {
          const drop = new Set(scopeIds);
          return prev.filter((id) => !drop.has(id));
        }
        return Array.from(new Set([...prev, ...scopeIds]));
      });
    },
    [configurations, filteredConfigurations]
  );

  // Used by the select-all checkbox's shift-aware tooltip to decide whether
  // a shift+click would Select or Deselect every filtered configuration.
  const isAllFilteredSelected = useMemo(() => {
    if (filteredConfigurations.length === 0) return false;
    const selSet = new Set(selectedConfigurationIds);
    return filteredConfigurations.every((c) => selSet.has(c.id));
  }, [filteredConfigurations, selectedConfigurationIds]);

  const columns = useColumns(
    tCommon,
    handleToggle,
    setEditingConfiguration,
    setDeletingConfiguration,
    handleCheckboxClick,
    handleSelectAllClick,
    filteredConfigurations.length,
    isAllFilteredSelected
  );

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >(() => {
    const initialVisibility: Record<string, boolean> = {};
    columns.forEach((column) => {
      initialVisibility[column.id as string] =
        (column.meta as CustomColumnMeta)?.isVisible ?? true;
    });
    return initialVisibility;
  });

  const pageSizeOptions = usePageSizeOptions(totalItems);

  // Reset to first page when search or project filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchString, projectFilter, setCurrentPage]);

  // Clear selection when the filtered set changes meaningfully (search or
  // project filter). Pagination and sort leave the set intact, so we keep
  // selection across those.
  useEffect(() => {
    setSelectedConfigurationIds([]);
    setLastSelectedIndex(null);
  }, [searchString, projectFilter]);

  // Derive the DataTable's per-row selection from the ID set for the visible
  // page slice. tanstack-table keys selection by row index, which we map back
  // to the configuration ID via `configurations[index]`.
  const rowSelection: RowSelectionState = useMemo(() => {
    const sel: RowSelectionState = {};
    const selSet = new Set(selectedConfigurationIds);
    configurations.forEach((c, idx) => {
      if (selSet.has(c.id)) sel[idx] = true;
    });
    return sel;
  }, [configurations, selectedConfigurationIds]);

  // Reset to first page when page size changes
  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, setCurrentPage]);

  if (isAuthLoading) {
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
    setCurrentPage(1); // Reset to first page when sorting changes
  };

  if (isAuthenticated && session?.user.access === "ADMIN") {
    return (
      <main>
        <Card>
          <CardHeader className="w-full">
            <div className="flex items-center justify-between text-primary">
              <div className="flex items-center justify-between text-primary text-xl md:text-2xl">
                <CardTitle>{tGlobal("common.fields.configurations")}</CardTitle>
              </div>
              <div>
                <AddConfigurationWizard />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-row items-start">
              <div className="flex flex-row items-center grow w-full min-w-[250px] gap-2">
                <div className="text-muted-foreground grow text-nowrap max-w-sm">
                  <Filter
                    key="configuration-filter"
                    placeholder={t("filterPlaceholder")}
                    initialSearchString={searchString}
                    onSearchChange={setSearchString}
                  />
                </div>
                <AsyncCombobox<{
                  id: number;
                  name: string;
                  iconUrl: string | null;
                }>
                  value={projectFilter}
                  onValueChange={setProjectFilter}
                  fetchOptions={searchProjects}
                  renderOption={(project) => (
                    <div className="flex items-center gap-1 min-w-0">
                      <ProjectIcon
                        iconUrl={project.iconUrl}
                        width={16}
                        height={16}
                      />
                      <span className="truncate">{project.name}</span>
                    </div>
                  )}
                  getOptionValue={(project) => project.id}
                  placeholder={tCommon("fields.projects")}
                  className="w-[200px] shrink-0 sm:w-[280px]"
                  pageSize={20}
                  showTotal={true}
                  showUnassigned={true}
                  unassignedLabel={t("allProjects")}
                  unassignedIcon={<Boxes className="mr-2 h-4 w-4" />}
                />
                {selectedConfigurationIds.length > 0 && (
                  <Button
                    type="button"
                    onClick={() => setIsBulkEditOpen(true)}
                    data-testid="bulk-edit-configurations-button"
                    className="shrink-0"
                  >
                    <PenSquare className="w-4 h-4" />
                    {t("bulkEdit.button", {
                      count: selectedConfigurationIds.length,
                    })}
                  </Button>
                )}
              </div>

              <div className="flex flex-col items-end shrink-0">
                {totalItems > 0 && (
                  <>
                    <div className="justify-end">
                      <PaginationInfo
                        key="configuration-pagination-info"
                        startIndex={startIndex}
                        endIndex={endIndex}
                        totalRows={totalItems}
                        searchString={searchString}
                        pageSize={
                          typeof pageSize === "number" ? pageSize : "All"
                        }
                        pageSizeOptions={pageSizeOptions}
                        handlePageSizeChange={(size) => setPageSize(size)}
                      />
                    </div>
                    <div className="justify-end -mx-4">
                      <PaginationComponent
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={setCurrentPage}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="mt-4 flex justify-between">
              <DataTable<ConfigWithVariants, unknown>
                columns={columns}
                data={configurations || []}
                onSortChange={handleSortChange}
                sortConfig={sortConfig}
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={setColumnVisibility}
                pageSize={typeof pageSize === "number" ? pageSize : totalItems}
                isLoading={isLoading}
                rowSelection={rowSelection}
              />
            </div>
          </CardContent>
        </Card>
        {editingConfiguration && (
          <EditConfiguration
            configuration={editingConfiguration}
            open={true}
            onClose={() => setEditingConfiguration(null)}
          />
        )}
        {deletingConfiguration && (
          <DeleteConfiguration
            configuration={deletingConfiguration}
            open={true}
            onClose={() => setDeletingConfiguration(null)}
          />
        )}
        {isBulkEditOpen && (
          <BulkEditConfigurations
            configurationIds={selectedConfigurationIds}
            open={true}
            onClose={() => {
              setIsBulkEditOpen(false);
              setSelectedConfigurationIds([]);
              setLastSelectedIndex(null);
            }}
          />
        )}
      </main>
    );
  }

  return null;
}
