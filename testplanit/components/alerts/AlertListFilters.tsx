"use client";

import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AlertFilters, AlertTriState } from "./alertFilters";

const STATES: AlertTriState[] = ["all", "on", "off"];

/**
 * Two labeled All / On / Off selects for the alerts table: whether the alert
 * is enabled, and whether it notifies the viewer. Sits beside the text filter.
 */
export function AlertListFilters({
  filters,
  onChange,
}: {
  filters: AlertFilters;
  onChange: (next: AlertFilters) => void;
}) {
  const t = useTranslations("alerts");
  const tCommon = useTranslations("common");

  const stateLabel = (state: AlertTriState) =>
    state === "all"
      ? tCommon("filters.all")
      : state === "on"
        ? t("filters.on")
        : t("filters.off");

  const renderSelect = (
    key: keyof AlertFilters,
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
    </div>
  );
}
