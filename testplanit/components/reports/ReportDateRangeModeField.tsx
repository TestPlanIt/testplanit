"use client";

import { Label } from "@/components/ui/label";
import { cn } from "~/utils";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useLocale, useTranslations } from "next-intl";
import { useRelativeDateRangeLabel } from "~/hooks/useRelativeDateRangeLabel";
import {
  parseRelativeDateRange,
  resolveRelativeDateRange,
  type RelativeDateRangeBody,
} from "~/lib/reports/dateRangePresets";
import { formatDateRange } from "~/utils/dateFormat";
import type { ReportDataMode } from "./ReportDataModeField";

/**
 * Whether a saved or shared report keeps its relative date range ("last
 * week", worked out each time it opens) or fixes the dates it covers now.
 */
export type ReportDateRangeMode = "relative" | "fixed";

/**
 * The config to store for the chosen mode. Fixed drops the relative range
 * and keeps the dates it resolves to today, so the report always covers
 * exactly what the dialog showed. A config with no relative range is
 * returned as is.
 */
export function applyDateRangeMode<T extends Record<string, unknown>>(
  config: T,
  mode: ReportDateRangeMode
): T {
  const relative = parseRelativeDateRange(config as RelativeDateRangeBody);
  if (!relative || mode === "relative") return config;
  const {
    dateRangePreset: _preset,
    dateRangeAmount: _amount,
    dateRangeUnit: _unit,
    dateRangeTimezone,
    ...rest
  } = config;
  const resolved = resolveRelativeDateRange(relative, {
    timezone: dateRangeTimezone as string | null | undefined,
  });
  return {
    ...rest,
    startDate: resolved.startDate,
    endDate: resolved.endDate,
  } as unknown as T;
}

interface ReportDateRangeModeFieldProps {
  /** The run being saved or shared. */
  config: Record<string, unknown>;
  /** Frozen data fixes the dates regardless, so the choice is replaced by a note. */
  dataMode: ReportDataMode;
  value: ReportDateRangeMode;
  onChange: (value: ReportDateRangeMode) => void;
}

/**
 * Relative or fixed dates for a saved or shared report. Rendered only when
 * the run uses a relative range — a custom range has nothing to choose.
 */
export function ReportDateRangeModeField({
  config,
  dataMode,
  value,
  onChange,
}: ReportDateRangeModeFieldProps) {
  const t = useTranslations("reports.dateRangeMode");
  const locale = useLocale();
  const relativeLabel = useRelativeDateRangeLabel();

  const relative = parseRelativeDateRange(config as RelativeDateRangeBody);
  if (!relative) return null;

  const timeZone = config.dateRangeTimezone as string | null | undefined;
  const resolved = resolveRelativeDateRange(relative, { timezone: timeZone });
  const dates =
    formatDateRange(resolved.startDate, resolved.endDate, {
      locale,
      timeZone,
    }) ?? "";
  const rangeName = relativeLabel(relative);

  if (dataMode === "frozen") {
    return (
      <div className="space-y-2" data-testid="report-date-range-mode">
        <Label>{t("label")}</Label>
        <p
          className="text-sm text-muted-foreground"
          data-testid="report-date-range-frozen-note"
        >
          {t("frozenNote", { range: rangeName, dates })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="report-date-range-mode">
      <Label>{t("label")}</Label>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as ReportDateRangeMode)}
        className="sm:grid-cols-2"
      >
        {(["relative", "fixed"] as const).map((option) => (
          <div
            key={option}
            className={cn(
              "flex cursor-pointer items-start space-x-2 rounded-lg border p-3",
              value === option && "bg-primary/10 border-primary/40"
            )}
            onClick={() => onChange(option)}
          >
            <RadioGroupItem
              data-testid={`report-date-range-mode-${option}`}
              value={option}
              id={`report-date-range-mode-${option}`}
              className="mt-1"
            />
            <div className="flex-1">
              <Label
                htmlFor={`report-date-range-mode-${option}`}
                className="font-medium cursor-pointer"
              >
                {option === "relative"
                  ? t("relative.title", { range: rangeName })
                  : t("fixed.title")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t(`${option}.description`, { dates })}
              </p>
            </div>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}
