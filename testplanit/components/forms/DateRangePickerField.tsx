import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { HelpPopover } from "@/components/ui/help-popover";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarDays } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { DateRange } from "react-day-picker";
import { Control, FieldPath, FieldValues } from "react-hook-form";
import {
  DATE_RANGE_PRESET_CATEGORIES,
  MAX_ROLLING_RANGE_AMOUNT,
  ROLLING_RANGE_UNITS,
  isDateRangePresetKey,
  resolveRelativeDateRange,
  type DateRangePresetCategory,
  type DateRangePresetKey,
  type RelativeDateRange,
  type RollingRangeUnit,
} from "~/lib/reports/dateRangePresets";
import { useRelativeDateRangeLabel } from "~/hooks/useRelativeDateRangeLabel";
import { cn, type ClassValue } from "~/utils";
import { formatDateRange } from "~/utils/dateFormat";

interface DateRangePickerFieldProps<T extends FieldValues = FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  minDate?: Date;
  maxDate?: Date;
  className?: ClassValue;
  helpKey?: string;
  /**
   * Preset key the picker starts on, matching a key in `rangeCategories`
   * (e.g. "thisWeek"). Set it alongside a pre-seeded form value so the preset
   * dropdown names the range instead of reading "Custom".
   */
  defaultPreset?: string;
  /**
   * The relative range currently chosen, when the caller keeps it (a report
   * run carries it so the range follows the calendar). null = custom dates.
   * Omit to let the picker keep it internally.
   */
  preset?: RelativeDateRange | null;
  onPresetChange?: (preset: RelativeDateRange | null) => void;
  /**
   * The calendar a relative range resolves on. Defaults to the browser's.
   */
  timezone?: string | null;
}

const DEFAULT_ROLLING: RelativeDateRange = {
  preset: "lastN",
  amount: 7,
  unit: "days",
};

export function DateRangePickerField<T extends FieldValues = FieldValues>({
  control,
  name,
  label,
  placeholder,
  disabled = false,
  minDate = new Date("1900-01-01"),
  maxDate = new Date("2099-12-31"),
  className,
  helpKey,
  defaultPreset = "custom",
  preset: controlledPreset,
  onPresetChange,
  timezone,
}: DateRangePickerFieldProps<T>) {
  const locale = useLocale();
  const t = useTranslations("common.actions");
  const tReports = useTranslations("reports.ui");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [internalPreset, setInternalPreset] =
    useState<RelativeDateRange | null>(() =>
      isDateRangePresetKey(defaultPreset) ? { preset: defaultPreset } : null
    );
  // "All time" clears the range; remembered so the dropdown can name it.
  const [allTime, setAllTime] = useState(defaultPreset === "allTime");

  const preset =
    controlledPreset !== undefined ? controlledPreset : internalPreset;
  const setPreset = (next: RelativeDateRange | null) => {
    setInternalPreset(next);
    onPresetChange?.(next);
  };

  const relativeLabel = useRelativeDateRangeLabel();
  const presetLabel = (key: DateRangePresetKey) =>
    relativeLabel({ preset: key });

  const categoryLabel = (category: DateRangePresetCategory) =>
    tReports(`dateRange.categories.${category}`);

  const unitLabel = (unit: RollingRangeUnit) =>
    tReports(`dateRange.rollingUnits.${unit}`);

  // The calendar days the range covers, as local Dates for the calendar.
  const rangeFor = (relative: RelativeDateRange): DateRange => {
    const resolved = resolveRelativeDateRange(relative, { timezone });
    return { from: resolved.fromDay, to: resolved.toDay };
  };

  const getSelectedLabel = (hasValue: boolean): string => {
    if (preset) return relativeLabel(preset);
    if (!hasValue && allTime) return tReports("dateRange.allTime");
    return tReports("dateRange.custom");
  };

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const choosePreset = (next: RelativeDateRange) => {
          setAllTime(false);
          setPreset(next);
          field.onChange(rangeFor(next));
        };
        const chooseCustom = (value: DateRange | undefined) => {
          setAllTime(false);
          setPreset(null);
          field.onChange(value);
        };
        return (
          <FormItem className={cn("flex flex-col", className)}>
            {label && (
              // `w-fit` constrains the label's hit area to its visible content.
              // FormLabel auto-attaches `htmlFor={formItemId}` pointing at the
              // trigger button below; a `flex` label without `w-fit` stretches
              // full-width and turns the empty space to the right of the text
              // into a hidden trigger — that "phantom" hit area also fights
              // with outside-click-to-close once the picker is open.
              <FormLabel className="flex w-fit items-center">
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
                      "w-full justify-start text-start font-normal",
                      !field.value && "text-muted-foreground"
                    )}
                    disabled={disabled}
                    data-testid="date-range-button"
                  >
                    {field.value ? (
                      <span className="flex min-w-0 items-center gap-2">
                        {preset && (
                          <span className="shrink-0 font-medium">
                            {getSelectedLabel(true)}
                          </span>
                        )}
                        <span
                          className={cn(
                            "truncate",
                            preset && "text-muted-foreground"
                          )}
                        >
                          {formatDateRange(field.value.from, field.value.to, {
                            locale,
                          })}
                        </span>
                      </span>
                    ) : (
                      <span>
                        {placeholder || tReports("dateRange.selectDateRange")}
                      </span>
                    )}
                    <CalendarDays className="ms-auto h-4 w-4 opacity-50" />
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
                <div className="p-2 border-b border-border grid gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-between"
                        data-testid="date-range-preset-select"
                      >
                        {getSelectedLabel(Boolean(field.value))}
                        <CalendarDays className="ms-2 h-4 w-4 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56">
                      <DropdownMenuItem
                        onClick={() => {
                          setAllTime(false);
                          setPreset(null);
                        }}
                      >
                        {tReports("dateRange.custom")}
                      </DropdownMenuItem>
                      {(
                        Object.entries(DATE_RANGE_PRESET_CATEGORIES) as Array<
                          [
                            DateRangePresetCategory,
                            readonly DateRangePresetKey[],
                          ]
                        >
                      ).map(([category, keys]) => (
                        <DropdownMenuSub key={category}>
                          <DropdownMenuSubTrigger>
                            {categoryLabel(category)}
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            {keys.map((key) => (
                              <DropdownMenuItem
                                key={key}
                                onClick={() => choosePreset({ preset: key })}
                              >
                                {presetLabel(key)}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      ))}
                      <DropdownMenuItem
                        data-testid="date-range-preset-rolling"
                        onClick={() =>
                          choosePreset(
                            preset?.preset === "lastN"
                              ? preset
                              : DEFAULT_ROLLING
                          )
                        }
                      >
                        {tReports("dateRange.rolling.label")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setAllTime(true);
                          setPreset(null);
                          field.onChange(undefined);
                        }}
                      >
                        {tReports("dateRange.allTime")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {preset?.preset === "lastN" && (
                    <div
                      className="flex items-center gap-2"
                      data-testid="date-range-rolling-editor"
                    >
                      <span className="text-sm">
                        {tReports("dateRange.rolling.last")}
                      </span>
                      <Input
                        type="number"
                        min={1}
                        max={MAX_ROLLING_RANGE_AMOUNT}
                        value={preset.amount}
                        onChange={(event) => {
                          const amount = Number(event.target.value);
                          if (
                            Number.isInteger(amount) &&
                            amount >= 1 &&
                            amount <= MAX_ROLLING_RANGE_AMOUNT
                          ) {
                            choosePreset({ ...preset, amount });
                          }
                        }}
                        className="h-8 w-20"
                        aria-label={tReports("dateRange.rolling.amount")}
                        data-testid="date-range-rolling-amount"
                      />
                      <Select
                        value={preset.unit}
                        onValueChange={(unit) =>
                          choosePreset({
                            ...preset,
                            unit: unit as RollingRangeUnit,
                          })
                        }
                      >
                        <SelectTrigger
                          className="h-8 flex-1"
                          aria-label={tReports("dateRange.rolling.unit")}
                          data-testid="date-range-rolling-unit"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLLING_RANGE_UNITS.map((unit) => (
                            <SelectItem key={unit} value={unit}>
                              {unitLabel(unit)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                <div>
                  <Calendar
                    mode="range"
                    selected={field.value}
                    onSelect={(range) => chooseCustom(range)}
                    disabled={(date) => date > maxDate || date < minDate}
                    autoFocus
                    numberOfMonths={2}
                  />
                </div>
                <div className="p-2 border-t border-border flex gap-2">
                  <Button
                    variant="ghost"
                    className="flex-1 justify-center text-sm"
                    onClick={() => chooseCustom(undefined)}
                    disabled={!field.value}
                  >
                    {t("reset")}
                  </Button>
                  <Button
                    variant="ghost"
                    className="flex-1 justify-center text-sm"
                    onClick={() => {
                      chooseCustom(undefined);
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
            {preset && onPresetChange && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="date-range-relative-hint"
              >
                {tReports("dateRange.relativeHint")}
              </p>
            )}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}
