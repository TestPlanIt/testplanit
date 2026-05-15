"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  useFindManyConfigurations,
  useFindManyDataSet,
  useFindManyStatus,
} from "~/lib/hooks";
import type { MatrixFilters } from "~/lib/matrix/types";

interface MatrixFilterBarProps {
  projectId: number;
  filters: MatrixFilters;
  onChange: (next: Partial<MatrixFilters>) => void;
}

interface OptionRow {
  id: number;
  name: string;
}

/**
 * URL-backed multi-select filter chrome for the Matrix view.
 *
 * Filter sources:
 *   - Status: project-wide (no projectId scope on the model).
 *   - Configurations: project-scoped; includes a synthetic
 *     `{ id: 0, name: configNone }` entry so the user can filter for runs
 *     with no configuration (matches the cell axis "(none)" sentinel).
 *   - DataSets: project-scoped.
 *   - Date range: bounds TestRuns.createdAt as ISO date strings.
 *
 * State writes go through the parent's `onChange` (i.e. the `useMatrixFilters`
 * hook's `setFilters`) so URL is the single source of truth — no local state.
 */
export function MatrixFilterBar({
  projectId,
  filters,
  onChange,
}: MatrixFilterBarProps) {
  const t = useTranslations("projects.matrix");

  const { data: statusesRaw } = useFindManyStatus({
    where: { isDeleted: false },
    orderBy: { order: "asc" },
    select: { id: true, name: true },
  });

  // Configurations is a global (system-wide) model — no projectId scope on the
  // model itself. Project relevance is implicit via the runs that consume them.
  const { data: configurationsRaw } = useFindManyConfigurations({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const { data: datasetsRaw } = useFindManyDataSet({
    where: { projectId, isDeleted: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const statuses = (statusesRaw ?? []) as OptionRow[];

  // Synthetic "no configuration" sentinel matches the cell axis (none) column.
  const configurations = useMemo<OptionRow[]>(() => {
    const real = (configurationsRaw ?? []) as OptionRow[];
    return [{ id: 0, name: t("configNone") }, ...real];
  }, [configurationsRaw, t]);

  const datasets = (datasetsRaw ?? []) as OptionRow[];

  const statusIds = filters.statusIds ?? [];
  const configIds = filters.configIds ?? [];
  const datasetIds = filters.datasetIds ?? [];

  const hasAnyFilter =
    statusIds.length > 0 ||
    configIds.length > 0 ||
    datasetIds.length > 0 ||
    Boolean(filters.dateFrom) ||
    Boolean(filters.dateTo);

  function toggle(values: number[], id: number): number[] {
    return values.includes(id)
      ? values.filter((v) => v !== id)
      : [...values, id];
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b p-3"
      data-testid="matrix-filter-bar"
    >
      <MultiSelectDropdown
        label={t("filterStatus", { count: statusIds.length })}
        options={statuses}
        selectedIds={statusIds}
        onToggle={(id) =>
          onChange({ statusIds: toggle(statusIds, id) })
        }
        onClear={() => onChange({ statusIds: [] })}
        clearLabel={t("clearFilter")}
        emptyLabel={t("filterEmpty")}
        testId="matrix-filter-status"
      />

      <MultiSelectDropdown
        label={t("filterConfig", { count: configIds.length })}
        options={configurations}
        selectedIds={configIds}
        onToggle={(id) =>
          onChange({ configIds: toggle(configIds, id) })
        }
        onClear={() => onChange({ configIds: [] })}
        clearLabel={t("clearFilter")}
        emptyLabel={t("filterEmpty")}
        testId="matrix-filter-config"
      />

      <MultiSelectDropdown
        label={t("filterDataset", { count: datasetIds.length })}
        options={datasets}
        selectedIds={datasetIds}
        onToggle={(id) =>
          onChange({ datasetIds: toggle(datasetIds, id) })
        }
        onClear={() => onChange({ datasetIds: [] })}
        clearLabel={t("clearFilter")}
        emptyLabel={t("filterEmpty")}
        testId="matrix-filter-dataset"
      />

      <div className="flex items-center gap-1">
        <label
          htmlFor="matrix-filter-date-from"
          className="text-sm text-muted-foreground"
        >
          {t("filterDateFrom")}
        </label>
        <Input
          id="matrix-filter-date-from"
          data-testid="matrix-filter-date-from"
          type="date"
          className="h-8 w-[160px]"
          value={filters.dateFrom ?? ""}
          onChange={(e) =>
            onChange({ dateFrom: e.target.value || undefined })
          }
        />
      </div>

      <div className="flex items-center gap-1">
        <label
          htmlFor="matrix-filter-date-to"
          className="text-sm text-muted-foreground"
        >
          {t("filterDateTo")}
        </label>
        <Input
          id="matrix-filter-date-to"
          data-testid="matrix-filter-date-to"
          type="date"
          className="h-8 w-[160px]"
          value={filters.dateTo ?? ""}
          onChange={(e) =>
            onChange({ dateTo: e.target.value || undefined })
          }
        />
      </div>

      {hasAnyFilter && (
        <Button
          variant="ghost"
          size="sm"
          data-testid="matrix-filter-reset"
          onClick={() =>
            onChange({
              statusIds: [],
              configIds: [],
              datasetIds: [],
              dateFrom: undefined,
              dateTo: undefined,
            })
          }
        >
          {t("resetFilters")}
        </Button>
      )}
    </div>
  );
}

interface MultiSelectDropdownProps {
  label: string;
  options: OptionRow[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  onClear: () => void;
  clearLabel: string;
  emptyLabel: string;
  testId: string;
}

function MultiSelectDropdown({
  label,
  options,
  selectedIds,
  onToggle,
  onClear,
  clearLabel,
  emptyLabel,
  testId,
}: MultiSelectDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" data-testid={testId}>
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[320px] w-[260px] overflow-auto"
      >
        {selectedIds.length > 0 && (
          <>
            <DropdownMenuLabel
              className="cursor-pointer text-xs font-normal text-muted-foreground hover:text-foreground"
              onClick={onClear}
            >
              {clearLabel}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        {options.length === 0 ? (
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {emptyLabel}
          </DropdownMenuLabel>
        ) : (
          options.map((opt) => (
            <DropdownMenuCheckboxItem
              key={opt.id}
              checked={selectedIds.includes(opt.id)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => onToggle(opt.id)}
            >
              {opt.name}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
