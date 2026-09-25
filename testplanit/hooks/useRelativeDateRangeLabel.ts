import { useTranslations } from "next-intl";
import { useCallback } from "react";
import type {
  DateRangePresetKey,
  RelativeDateRange,
} from "~/lib/reports/dateRangePresets";

/**
 * Names a relative date range the way the date picker's menu does ("Last
 * week", "Last 14 days"), so the picker, the share viewer and the saved
 * report strip all read the same.
 */
export function useRelativeDateRangeLabel(): (
  range: RelativeDateRange
) => string {
  const tReports = useTranslations("reports.ui");
  const tCommon = useTranslations("common");

  return useCallback(
    (range: RelativeDateRange) => {
      if (range.preset === "lastN") {
        return tReports(`dateRange.rolling.${range.unit}`, {
          count: range.amount,
        });
      }
      return presetLabel(range.preset, tReports, tCommon);
    },
    [tReports, tCommon]
  );
}

function presetLabel(
  key: DateRangePresetKey,
  tReports: ReturnType<typeof useTranslations>,
  tCommon: ReturnType<typeof useTranslations>
): string {
  // Three presets predate the date-range strings and live under common.
  switch (key) {
    case "last7Days":
      return tCommon("operators.last7");
    case "last30Days":
      return tCommon("operators.last30");
    case "thisYear":
      return tCommon("operators.thisYear");
    default:
      return tReports(`dateRange.${key}`);
  }
}
