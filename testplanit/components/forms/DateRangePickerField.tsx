import { format } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn, type ClassValue } from "~/utils";
import { getDateFnsLocale } from "~/utils/locales";
import { Control } from "react-hook-form";
import { HelpPopover } from "@/components/ui/help-popover";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DateRange } from "react-day-picker";
import {
  startOfMonth,
  endOfMonth,
  subDays,
  subMonths,
  startOfQuarter,
  endOfQuarter,
  startOfYear,
  endOfYear,
  subYears,
  startOfWeek,
  endOfWeek,
  subWeeks,
  startOfDay,
  endOfDay,
} from "date-fns";

interface DateRangePickerFieldProps {
  control: Control<any>;
  name: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  minDate?: Date;
  maxDate?: Date;
  className?: ClassValue;
  helpKey?: string;
}

interface PredefinedRange {
  label: string;
  getValue: () => DateRange;
}

interface RangeCategory {
  label: string;
  ranges: Record<string, PredefinedRange>;
}

export function DateRangePickerField({
  control,
  name,
  label,
  placeholder,
  disabled = false,
  minDate = new Date("1900-01-01"),
  maxDate = new Date("2099-12-31"),
  className,
  helpKey,
}: DateRangePickerFieldProps) {
  const locale = useLocale();
  const t = useTranslations("common.actions");
  const tReports = useTranslations("reports.ui");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string>("custom");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rangeCategories: Record<string, RangeCategory> = {
    day: {
      label: tReports("dateRange.categories.day"),
      ranges: {
        today: {
          label: tReports("dateRange.today"),
          getValue: () => ({
            from: startOfDay(today),
            to: endOfDay(today),
          }),
        },
        yesterday: {
          label: tReports("dateRange.yesterday"),
          getValue: () => ({
            from: startOfDay(subDays(today, 1)),
            to: endOfDay(subDays(today, 1)),
          }),
        },
        last7Days: {
          label: tReports("dateRange.last7Days"),
          getValue: () => ({
            from: subDays(today, 6),
            to: today,
          }),
        },
        last30Days: {
          label: tReports("dateRange.last30Days"),
          getValue: () => ({
            from: subDays(today, 29),
            to: today,
          }),
        },
      },
    },
    week: {
      label: tReports("dateRange.categories.week"),
      ranges: {
        thisWeek: {
          label: tReports("dateRange.thisWeek"),
          getValue: () => ({
            from: startOfWeek(today, { weekStartsOn: 1 }),
            to: endOfWeek(today, { weekStartsOn: 1 }),
          }),
        },
        lastWeek: {
          label: tReports("dateRange.lastWeek"),
          getValue: () => {
            const lastWeek = subWeeks(today, 1);
            return {
              from: startOfWeek(lastWeek, { weekStartsOn: 1 }),
              to: endOfWeek(lastWeek, { weekStartsOn: 1 }),
            };
          },
        },
        last2Weeks: {
          label: tReports("dateRange.last2Weeks"),
          getValue: () => ({
            from: subWeeks(today, 2),
            to: today,
          }),
        },
      },
    },
    month: {
      label: tReports("dateRange.categories.month"),
      ranges: {
        thisMonth: {
          label: tReports("dateRange.thisMonth"),
          getValue: () => ({
            from: startOfMonth(today),
            to: endOfMonth(today),
          }),
        },
        lastMonth: {
          label: tReports("dateRange.lastMonth"),
          getValue: () => {
            const lastMonth = subMonths(today, 1);
            return {
              from: startOfMonth(lastMonth),
              to: endOfMonth(lastMonth),
            };
          },
        },
        last3Months: {
          label: tReports("dateRange.last3Months"),
          getValue: () => ({
            from: subMonths(today, 3),
            to: today,
          }),
        },
      },
    },
    quarter: {
      label: tReports("dateRange.categories.quarter"),
      ranges: {
        thisQuarter: {
          label: tReports("dateRange.thisQuarter"),
          getValue: () => ({
            from: startOfQuarter(today),
            to: endOfQuarter(today),
          }),
        },
        lastQuarter: {
          label: tReports("dateRange.lastQuarter"),
          getValue: () => {
            const lastQuarter = subMonths(today, 3);
            return {
              from: startOfQuarter(lastQuarter),
              to: endOfQuarter(lastQuarter),
            };
          },
        },
      },
    },
    year: {
      label: tReports("dateRange.categories.year"),
      ranges: {
        thisYear: {
          label: tReports("dateRange.thisYear"),
          getValue: () => ({
            from: startOfYear(today),
            to: endOfYear(today),
          }),
        },
        lastYear: {
          label: tReports("dateRange.lastYear"),
          getValue: () => {
            const lastYear = subYears(today, 1);
            return {
              from: startOfYear(lastYear),
              to: endOfYear(lastYear),
            };
          },
        },
        last12Months: {
          label: tReports("dateRange.last12Months"),
          getValue: () => ({
            from: subMonths(today, 12),
            to: today,
          }),
        },
      },
    },
  };

  // Helper to find a range by key across all categories
  const findRangeByKey = (
    key: string
  ): { range: PredefinedRange; categoryKey: string } | undefined => {
    for (const [categoryKey, category] of Object.entries(rangeCategories)) {
      if (key in category.ranges) {
        return { range: category.ranges[key], categoryKey };
      }
    }
    return undefined;
  };

  // Get display label for selected preset
  const getSelectedLabel = (): string => {
    if (selectedPreset === "custom") {
      return tReports("dateRange.custom");
    }
    if (selectedPreset === "allTime") {
      return tReports("dateRange.allTime");
    }
    const found = findRangeByKey(selectedPreset);
    return found?.range.label || tReports("dateRange.custom");
  };

  const formatDateRange = (dateRange: DateRange | undefined) => {
    if (!dateRange?.from) return null;
    const formatStr = "MMM d, yyyy";
    const localeObj = getDateFnsLocale(locale);

    if (dateRange.to) {
      return `${format(dateRange.from, formatStr, { locale: localeObj })} - ${format(
        dateRange.to,
        formatStr,
        { locale: localeObj }
      )}`;
    }
    return format(dateRange.from, formatStr, { locale: localeObj });
  };

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={cn("flex flex-col", className)}>
          {label && (
            <FormLabel className="flex items-center">
              {label}
              {helpKey && <HelpPopover helpKey={helpKey} />}
            </FormLabel>
          )}
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <FormControl>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !field.value && "text-muted-foreground"
                  )}
                  disabled={disabled}
                  data-testid="date-range-button"
                >
                  {field.value ? (
                    formatDateRange(field.value)
                  ) : (
                    <span>
                      {placeholder || tReports("dateRange.selectDateRange")}
                    </span>
                  )}
                  <CalendarDays className="ml-auto h-4 w-4 opacity-50" />
                </Button>
              </FormControl>
            </PopoverTrigger>
            <PopoverContent
              className="w-auto p-0"
              align="center"
              sideOffset={5}
            >
              <div className="px-3 py-2 text-sm text-muted-foreground text-center border-b border-border">
                {!field.value?.from
                  ? tReports("dateRange.chooseStartDate")
                  : tReports("dateRange.chooseEndDate")}
              </div>
              <div className="p-2 border-b border-border">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-between"
                      data-testid="date-range-preset-select"
                    >
                      {getSelectedLabel()}
                      <CalendarDays className="ml-2 h-4 w-4 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuItem
                      onClick={() => {
                        setSelectedPreset("custom");
                      }}
                    >
                      {tReports("dateRange.custom")}
                    </DropdownMenuItem>
                    {Object.entries(rangeCategories).map(
                      ([categoryKey, category]) => (
                        <DropdownMenuSub key={categoryKey}>
                          <DropdownMenuSubTrigger>
                            {category.label}
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            {Object.entries(category.ranges).map(
                              ([rangeKey, range]) => (
                                <DropdownMenuItem
                                  key={rangeKey}
                                  onClick={() => {
                                    setSelectedPreset(rangeKey);
                                    const rangeValue = range.getValue();
                                    field.onChange(rangeValue);
                                  }}
                                >
                                  {range.label}
                                </DropdownMenuItem>
                              )
                            )}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      )
                    )}
                    <DropdownMenuItem
                      onClick={() => {
                        setSelectedPreset("allTime");
                        field.onChange(undefined);
                      }}
                    >
                      {tReports("dateRange.allTime")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div>
                <Calendar
                  mode="range"
                  selected={field.value}
                  onSelect={(range) => {
                    field.onChange(range);
                  }}
                  disabled={(date) => date > maxDate || date < minDate}
                  autoFocus
                  numberOfMonths={2}
                />
              </div>
              <div className="p-2 border-t border-border flex gap-2">
                <Button
                  variant="ghost"
                  className="flex-1 justify-center text-sm"
                  onClick={() => {
                    field.onChange(undefined);
                    setSelectedPreset("custom");
                  }}
                  disabled={!field.value}
                >
                  {t("reset")}
                </Button>
                <Button
                  variant="ghost"
                  className="flex-1 justify-center text-sm"
                  onClick={() => {
                    field.onChange(undefined);
                    setSelectedPreset("custom");
                    setPopoverOpen(false);
                  }}
                  disabled={!field.value}
                >
                  {t("clear")}
                </Button>
                <Button
                  variant="default"
                  className="flex-1 justify-center text-sm"
                  onClick={() => {
                    setPopoverOpen(false);
                  }}
                >
                  {t("done")}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
