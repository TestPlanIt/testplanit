"use client";

import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AlertFilters, AlertTriState } from "./alertFilters";

const STATES: AlertTriState[] = ["all", "on", "off"];

export interface AlertCreator {
  id: string;
  name: string;
  email?: string | null;
}

/**
 * Two labeled All / On / Off selects for the alerts table: whether the alert
 * is enabled, and whether it notifies the viewer. Sits beside the text filter.
 */
export function AlertListFilters({
  filters,
  onChange,
  creators,
}: {
  filters: AlertFilters;
  onChange: (next: AlertFilters) => void;
  /** The users who have created at least one listed alert. */
  creators: AlertCreator[];
}) {
  const t = useTranslations("alerts");
  const tCommon = useTranslations("common");
  const tAudit = useTranslations("admin.auditLogs");

  // The creator list is small and already in memory: search and page it
  // locally so the combobox behaves like the audit log's user filter.
  const fetchCreators = useCallback(
    async (query: string, page: number, pageSize: number) => {
      const needle = query.trim().toLowerCase();
      const matching = creators.filter(
        (u) =>
          needle.length === 0 ||
          (u.name ?? "").toLowerCase().includes(needle) ||
          (u.email ?? "").toLowerCase().includes(needle)
      );
      return {
        results: matching.slice(page * pageSize, (page + 1) * pageSize),
        total: matching.length,
      };
    },
    [creators]
  );
  const selectedCreators = useMemo(
    () =>
      filters.createdBy
        .map((id) => creators.find((u) => u.id === id))
        .filter((u): u is AlertCreator => u != null),
    [filters.createdBy, creators]
  );

  const stateLabel = (state: AlertTriState) =>
    state === "all"
      ? tCommon("filters.all")
      : state === "on"
        ? t("filters.on")
        : t("filters.off");

  const renderSelect = (
    key: "enabled" | "notifyMe",
    label: string,
    testId: string
  ) => (
    <div className="flex items-center gap-2">
      <Label htmlFor={testId} className="whitespace-nowrap">
        {label}
      </Label>
      <Select
        value={filters[key]}
        onValueChange={(value) =>
          onChange({ ...filters, [key]: value as AlertTriState })
        }
      >
        <SelectTrigger id={testId} data-testid={testId} className="w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATES.map((state) => (
            <SelectItem
              key={state}
              value={state}
              data-testid={`${testId}-${state}`}
            >
              {stateLabel(state)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div
      role="group"
      aria-label={t("filters.label")}
      className="flex flex-wrap items-center gap-4"
    >
      {renderSelect("enabled", t("columns.enabled"), "alert-filter-enabled")}
      {renderSelect(
        "notifyMe",
        t("columns.notifyMe"),
        "alert-filter-notify-me"
      )}
      <div className="flex items-center gap-2">
        <Label className="whitespace-nowrap">
          {tCommon("fields.createdBy")}
        </Label>
        <div data-testid="alert-filter-created-by">
          <MultiAsyncCombobox<AlertCreator>
            value={selectedCreators}
            onValueChange={(next) =>
              onChange({ ...filters, createdBy: next.map((u) => u.id) })
            }
            fetchOptions={fetchCreators}
            getOptionValue={(u) => u.id}
            getOptionLabel={(u) => u.name || u.email || u.id}
            renderOption={(u) => (
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">
                  {u.name || u.email || u.id}
                </span>
                {u.name && u.email && (
                  <span className="truncate text-xs text-muted-foreground">
                    {u.email}
                  </span>
                )}
              </div>
            )}
            placeholder={tAudit("allUsers")}
            ariaLabel={tCommon("fields.createdBy")}
            className="w-auto min-w-40 max-w-72"
            dropdownClassName="p-0 min-w-[240px] max-w-[400px]"
            pageSize={10}
          />
        </div>
      </div>
    </div>
  );
}
