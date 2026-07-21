import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useDebounce } from "@/components/Debounce";
import { CustomColumnMeta } from "@/components/tables/ColumnSelection";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import { Filter } from "@/components/tables/Filter";
import { ProjectIcon } from "@/components/ProjectIcon";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpPopover } from "@/components/ui/help-popover";
import { SectionHeader } from "@/components/ui/typography";
import type { RowSelectionState } from "@tanstack/react-table";
import { Boxes, PenSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { searchProjects } from "~/app/actions/searchProjects";
import { useRequireAuth } from "~/hooks/useRequireAuth";
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

  // Fetch ALL configurations (no pagination, no search filter in query)
  const { data: allConfigurations, isLoading } = useClientQueries(
    schema
  ).configurations.useFindMany(
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

  // The virtualized table renders the entire filtered set (windowing the DOM),
  // so there's no page slice; row-selection indices below key into this array.
  const configurations = filteredConfigurations;

  const { mutate: updateConfiguration } =
    useClientQueries(schema).configurations.useUpdate();

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

  // Clear selection when the filtered set changes meaningfully (search or
  // project filter). Sort leaves the set intact, so we keep selection across it.
  useEffect(() => {
    setSelectedConfigurationIds([]);
    setLastSelectedIndex(null);
  }, [searchString, projectFilter]);

  // Derive the table's per-row selection from the ID set. tanstack-table keys
  // selection by row index, which we map back to the configuration ID via
  // `configurations[index]` (the full filtered set the table renders).
  const rowSelection: RowSelectionState = useMemo(() => {
    const sel: RowSelectionState = {};
    const selSet = new Set(selectedConfigurationIds);
    configurations.forEach((c, idx) => {
      if (selSet.has(c.id)) sel[idx] = true;
    });
    return sel;
  }, [configurations, selectedConfigurationIds]);

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
  };

  if (isAuthenticated && session?.user.access === "ADMIN") {
    return (
      <main>
        <Card>
          <CardHeader className="w-full">
            <div className="flex items-center justify-between gap-2">
              <SectionHeader className="flex items-center gap-2">
                <CardTitle>{tGlobal("common.fields.configurations")}</CardTitle>
                <HelpPopover helpKey="configurations" />
              </SectionHeader>
              <AddConfigurationWizard />
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <Filter
                  key="configuration-filter"
                  className="w-full min-w-[250px] sm:w-80"
                  placeholder={t("filterPlaceholder")}
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                />
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
                  unassignedIcon={<Boxes className="me-2 h-4 w-4" />}
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

              {filteredConfigurations.length > 0 && (
                <p className="text-end text-sm text-muted-foreground">
                  {tGlobal("admin.auditLogs.showing", {
                    loaded: filteredConfigurations.length.toLocaleString(),
                    total: filteredConfigurations.length.toLocaleString(),
                  })}
                </p>
              )}
            </div>
            <div className="mt-4 w-full">
              <VirtualizedDataTable
                columns={columns as any}
                data={configurations || []}
                flexColumnId="name"
                onSortChange={handleSortChange}
                sortConfig={sortConfig}
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={setColumnVisibility}
                isLoading={isLoading}
                rowSelection={rowSelection}
                fillViewport
                resetKey={`${debouncedSearchString}|${projectFilter?.id ?? ""}|${sortConfig?.column}|${sortConfig?.direction}`}
                testIdPrefix="admin-configurations-table"
                rowTestIdPrefix="admin-configuration-row"
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
