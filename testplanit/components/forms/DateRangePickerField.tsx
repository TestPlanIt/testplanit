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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

  const predefinedRanges: Record<string, PredefinedRange> = {
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
    last7days: {
      label: tReports("dateRange.last7Days"),
      getValue: () => ({
        from: subDays(today, 6),
        to: today,
      }),
    },
    last14days: {
      label: tReports("dateRange.last14Days"),
      getValue: () => ({
        from: subDays(today, 13),
        to: today,
      }),
    },
    last30days: {
      label: tReports("dateRange.last30Days"),
      getValue: () => ({
        from: subDays(today, 29),
        to: today,
      }),
    },
    last90days: {
      label: tReports("dateRange.last90Days"),
      getValue: () => ({
        from: subDays(today, 89),
        to: today,
      }),
    },
    thisWeek: {
      label: tReports("dateRange.thisWeek"),
      getValue: () => ({
        from: startOfWeek(today, { weekStartsOn: 1 }), // Monday as start of week
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
    thisMonth: {
      label: tReports("dateRange.thisMonth"),
      getValue: () => ({
        from: startOfMonth(today),
        to: endOfMonth(today),
      }),
    },
    previousMonth: {
      label: tReports("dateRange.previousMonth"),
      getValue: () => {
        const previousMonth = subMonths(today, 1);
        return {
          from: startOfMonth(previousMonth),
          to: endOfMonth(previousMonth),
        };
      },
    },
    thisQuarter: {
      label: tReports("dateRange.thisQuarter"),
      getValue: () => ({
        from: startOfQuarter(today),
        to: endOfQuarter(today),
      }),
    },
    previousQuarter: {
      label: tReports("dateRange.previousQuarter"),
      getValue: () => {
        const previousQuarter = subMonths(today, 3);
        return {
          from: startOfQuarter(previousQuarter),
          to: endOfQuarter(previousQuarter),
        };
      },
    },
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
              <div className="p-2 space-y-2">
                <Select
                  value={selectedPreset}
                  onValueChange={(value) => {
                    setSelectedPreset(value);
                    if (value !== "custom" && predefinedRanges[value]) {
                      const range = predefinedRanges[value].getValue();
                      field.onChange(range);
                    }
                  }}
                >
                  <SelectTrigger data-testid="date-range-preset-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="custom">
                      {tReports("dateRange.custom")}
                    </SelectItem>
                    {Object.entries(predefinedRanges).map(([key, range]) => (
                      <SelectItem key={key} value={key}>
                        {range.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="border-t border-border">
                <Calendar
                  mode="range"
                  selected={field.value}
                  onSelect={(range) => {
                    field.onChange(range);
                    if (range?.from && range?.to) {
                      setPopoverOpen(false);
                    }
                  }}
                  disabled={(date) => date > maxDate || date < minDate}
                  autoFocus
                  numberOfMonths={2}
                />
              </div>
              <div className="p-2 border-t border-border">
                <Button
                  variant="ghost"
                  className="w-full justify-center text-sm"
                  onClick={() => {
                    field.onChange(undefined);
                    setSelectedPreset("custom");
                    setPopoverOpen(false);
                  }}
                  disabled={!field.value}
                >
                  {t("clear")}
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
