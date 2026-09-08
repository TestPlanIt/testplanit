"use client";

import {
  operatorLabelKey,
  type FilterInputValue,
} from "@/components/filterInputValue";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import { format } from "date-fns";
import { CalendarDays, Check, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { cn } from "~/utils";
import { getDateFnsLocale } from "~/utils/locales";

type DateOperator =
  | "on"
  | "before"
  | "after"
  | "between"
  | "last7"
  | "last30"
  | "last90"
  | "thisYear";

const LEGACY_OPERATORS: readonly string[] = [
  "on",
  "before",
  "after",
  "between",
  "last7",
  "last30",
  "last90",
  "thisYear",
];

const RELATIVE_OPERATORS: readonly string[] = [
  "last7",
  "last30",
  "last90",
  "thisYear",
];

// Relative operators plus the registry has-value / is-empty operators (the
// latter only offered in structured mode via the `operators` prop).
const VALUELESS_OPERATORS: readonly string[] = [
  ...RELATIVE_OPERATORS,
  "any",
  "none",
];

interface DateFilterInputProps {
  fieldId: number;
  onFilterApply?: (
    operator: DateOperator,
    value1?: Date,
    value2?: Date
  ) => void;
  onClearFilter?: () => void;
  currentFilter: string | null;
  /** Structured chip-editor mode: the committed {operator, values} (ISO strings). */
  value?: FilterInputValue | null;
  /** Structured change path — emits only complete states. */
  onValueChange?: (next: FilterInputValue) => void;
  /** Operator whitelist for structured mode; defaults to the legacy set. */
  operators?: readonly string[];
}

// Operators that have a `common.operators.*` label; anything outside this set
// (a hand-edited URL) falls back to the raw token rather than a missing key.
const LABELLED_OPERATORS: readonly string[] = [
  ...LEGACY_OPERATORS,
  "any",
  "none",
];

export function DateFilterInput({
  fieldId: _fieldId,
  onFilterApply,
  onClearFilter,
  currentFilter,
  value,
  onValueChange,
  operators,
}: DateFilterInputProps) {
  const t = useTranslations();
  const locale = useLocale();
  const [operator, setOperator] = useState<string>("on");
  const [date1, setDate1] = useState<Date | undefined>(undefined);
  const [date2, setDate2] = useState<Date | undefined>(undefined);
  const [popover1Open, setPopover1Open] = useState(false);
  const [popover2Open, setPopover2Open] = useState(false);

  const operatorOptions = operators ?? LEGACY_OPERATORS;

  // Parse current filter if it exists
  useEffect(() => {
    if (currentFilter) {
      // Use pipe separator to avoid conflicts with ISO date format
      if (currentFilter.includes("|")) {
        const parts = currentFilter.split("|");
        setOperator(parts[0]);

        if (parts[1]) {
          const date = new Date(parts[1]);
          if (!isNaN(date.getTime())) {
            setDate1(date);
          }
        }

        if (parts[2]) {
          const date = new Date(parts[2]);
          if (!isNaN(date.getTime())) {
            setDate2(date);
          }
        }
      } else {
        // Relative date operator without date value (last7, last30, etc.)
        setOperator(currentFilter);
      }
    }
  }, [currentFilter]);

  // Structured mode: sync from the committed predicate value.
  useEffect(() => {
    if (!value) return;
    setOperator(value.operator);
    const parseDate = (raw: string | number | undefined) => {
      if (raw === undefined) return undefined;
      const parsed = new Date(String(raw));
      return isNaN(parsed.getTime()) ? undefined : parsed;
    };
    setDate1(parseDate(value.values[0]));
    setDate2(parseDate(value.values[1]));
  }, [value]);

  const emitStructured = (op: string, d1?: Date, d2?: Date) => {
    if (!onValueChange) return;
    if (VALUELESS_OPERATORS.includes(op)) {
      onValueChange({ operator: op, values: [] });
      return;
    }
    if (!d1) return;
    if (op === "between") {
      if (!d2 || d1 >= d2) return;
      onValueChange({
        operator: op,
        values: [format(d1, "yyyy-MM-dd"), format(d2, "yyyy-MM-dd")],
      });
      return;
    }
    onValueChange({ operator: op, values: [format(d1, "yyyy-MM-dd")] });
  };

  const handleApply = () => {
    // Valueless filters (relative ranges, has-value/is-empty) need no dates
    if (VALUELESS_OPERATORS.includes(operator)) {
      if (RELATIVE_OPERATORS.includes(operator)) {
        onFilterApply?.(operator as DateOperator);
      }
      emitStructured(operator);
      return;
    }

    // Other operators require at least one date
    if (!date1) return;

    if (operator === "between") {
      if (!date2) return;
      onFilterApply?.(operator, date1, date2);
    } else {
      onFilterApply?.(operator as DateOperator, date1);
    }
    emitStructured(operator, date1, date2);
  };

  const _handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleApply();
    }
  };

  const isValid = () => {
    // Valueless filters are always valid
    if (VALUELESS_OPERATORS.includes(operator)) {
      return true;
    }

    // Other operators need at least date1
    if (!date1) return false;

    // Between needs both dates and date1 < date2
    if (operator === "between") {
      if (!date2) return false;
      return date1 < date2;
    }

    return true;
  };

  const needsDateInput = !VALUELESS_OPERATORS.includes(operator);

  const hasActiveFilter =
    currentFilter !== null &&
    currentFilter !== undefined &&
    currentFilter !== "";

  const operatorLabel = (op: string) =>
    LABELLED_OPERATORS.includes(op)
      ? t(`common.operators.${operatorLabelKey(op)}`)
      : op;

  // Format the current filter for display
  const formatFilterDisplay = (filter: string) => {
    if (!filter) return filter;

    // Use pipe separator
    if (!filter.includes("|")) {
      // No pipe - it's a relative date filter
      return operatorLabel(filter);
    }

    const parts = filter.split("|");
    const symbol = operatorLabel(parts[0]);
    const invalid = t("search.filters.invalidDate");

    if (parts.length === 3) {
      // Between operator with two dates
      const date1 = new Date(parts[1]);
      const date2 = new Date(parts[2]);
      if (!isNaN(date1.getTime()) && !isNaN(date2.getTime())) {
        const d1 = format(date1, "PP", { locale: getDateFnsLocale(locale) });
        const d2 = format(date2, "PP", { locale: getDateFnsLocale(locale) });
        return `${symbol} ${d1} ${t("common.and")} ${d2}`;
      }
      return `${symbol} ${invalid}`;
    } else if (parts[1]) {
      // Single date
      const date = new Date(parts[1]);
      if (!isNaN(date.getTime())) {
        const d = format(date, "PP", { locale: getDateFnsLocale(locale) });
        return `${symbol} ${d}`;
      }
      return `${symbol} ${invalid}`;
    }
    return symbol;
  };

  return (
    <div className="p-2 space-y-2 bg-muted/30 rounded-md">
      {hasActiveFilter && (
        <div className="flex items-center justify-between text-xs bg-primary/10 p-1.5 rounded">
          <span className="text-primary font-medium">
            {t("search.filters.filterActive")}{" "}
            {formatFilterDisplay(currentFilter)}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDate1(undefined);
              setDate2(undefined);
              if (onClearFilter) {
                onClearFilter();
              }
            }}
            className="h-5 w-5 p-0"
            title={t("common.aria.clearFilter")}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      <Select
        value={operator}
        onValueChange={(val) => {
          setOperator(val);
          // Valueless operators are complete on selection; dated operators
          // wait for a (valid) date pick.
          emitStructured(val, date1, date2);
        }}
      >
        <SelectTrigger
          className="w-full h-8 text-xs"
          aria-label={t("common.placeholders.selectOperator")}
        >
          <SelectValue placeholder={t("common.placeholders.selectOperator")} />
        </SelectTrigger>
        <SelectContent>
          {operatorOptions.map((op) => (
            <SelectItem key={op} value={op} className="text-xs">
              {t(`common.operators.${operatorLabelKey(op)}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {needsDateInput && (
        <div className="flex gap-2 items-center">
          <Popover open={popover1Open} onOpenChange={setPopover1Open}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "h-8 text-xs flex-1 justify-start font-normal",
                  !date1 && "text-muted-foreground"
                )}
              >
                {date1 ? (
                  format(date1, "PP", { locale: getDateFnsLocale(locale) })
                ) : (
                  <span>{t("search.selectDate")}</span>
                )}
                <CalendarDays className="ms-auto h-3 w-3 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={date1}
                onSelect={(date) => {
                  if (date) {
                    setDate1(date);
                    setPopover1Open(false);
                    emitStructured(operator, date, date2);
                  }
                }}
                autoFocus
              />
            </PopoverContent>
          </Popover>

          {operator === "between" && (
            <>
              <span className="text-xs text-muted-foreground">
                {t("common.and")}
              </span>
              <Popover open={popover2Open} onOpenChange={setPopover2Open}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "h-8 text-xs flex-1 justify-start font-normal",
                      !date2 && "text-muted-foreground"
                    )}
                  >
                    {date2 ? (
                      format(date2, "PP", { locale: getDateFnsLocale(locale) })
                    ) : (
                      <span>{t("search.selectDate")}</span>
                    )}
                    <CalendarDays className="ms-auto h-3 w-3 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date2}
                    onSelect={(date) => {
                      if (date) {
                        setDate2(date);
                        setPopover2Open(false);
                        emitStructured(operator, date1, date);
                      }
                    }}
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
            </>
          )}

          <Button
            size="sm"
            onClick={handleApply}
            disabled={!isValid()}
            className="h-8 w-8 p-0 shrink-0"
          >
            <Check className="h-3 w-3" />
          </Button>
        </div>
      )}

      {!needsDateInput && (
        <Button size="sm" onClick={handleApply} className="h-8 w-full text-xs">
          {t("search.filters.applyFilter")}
        </Button>
      )}

      {operator === "between" && date1 && date2 && date1 >= date2 && (
        <p className="text-xs text-destructive">
          {t("search.filters.validation.firstDateMustBeBeforeSecond")}
        </p>
      )}
    </div>
  );
}
