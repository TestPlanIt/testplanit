"use client";

import { useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Check, X, CalendarDays } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns";
import { useLocale } from "next-intl";
import { getDateFnsLocale } from "~/utils/locales";
import { cn } from "~/utils";

type DateOperator = "on" | "before" | "after" | "between" | "last7" | "last30" | "last90" | "thisYear";

interface DateFilterInputProps {
  fieldId: number;
  onFilterApply: (operator: DateOperator, value1?: Date, value2?: Date) => void;
  onClearFilter?: () => void;
  currentFilter: string | null;
}

const operatorLabels: Record<DateOperator, string> = {
  on: "On date (=)",
  before: "Before date (<)",
  after: "After date (>)",
  between: "Between dates",
  last7: "Last 7 days",
  last30: "Last 30 days",
  last90: "Last 90 days",
  thisYear: "This year",
};

const operatorSymbols: Record<DateOperator, string> = {
  on: "on",
  before: "before",
  after: "after",
  between: "between",
  last7: "last 7 days",
  last30: "last 30 days",
  last90: "last 90 days",
  thisYear: "this year",
};

export function DateFilterInput({
  fieldId,
  onFilterApply,
  onClearFilter,
  currentFilter,
}: DateFilterInputProps) {
  const locale = useLocale();
  const [operator, setOperator] = useState<DateOperator>("on");
  const [date1, setDate1] = useState<Date | undefined>(undefined);
  const [date2, setDate2] = useState<Date | undefined>(undefined);
  const [popover1Open, setPopover1Open] = useState(false);
  const [popover2Open, setPopover2Open] = useState(false);

  // Parse current filter if it exists
  useEffect(() => {
    if (currentFilter) {
      // Use pipe separator to avoid conflicts with ISO date format
      if (currentFilter.includes("|")) {
        const parts = currentFilter.split("|");
        setOperator(parts[0] as DateOperator);

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
        setOperator(currentFilter as DateOperator);
      }
    }
  }, [currentFilter]);

  const handleApply = () => {
    // Relative date filters don't need date inputs
    if (["last7", "last30", "last90", "thisYear"].includes(operator)) {
      console.log("[DateFilterInput] Applying relative filter:", operator);
      onFilterApply(operator);
      return;
    }

    // Other operators require at least one date
    if (!date1) return;

    console.log("[DateFilterInput] Applying filter:", { operator, date1, date2 });

    if (operator === "between") {
      if (!date2) return;
      onFilterApply(operator, date1, date2);
    } else {
      onFilterApply(operator, date1);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleApply();
    }
  };

  const isValid = () => {
    // Relative date filters are always valid
    if (["last7", "last30", "last90", "thisYear"].includes(operator)) {
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

  const needsDateInput = !["last7", "last30", "last90", "thisYear"].includes(operator);

  const hasActiveFilter = currentFilter !== null && currentFilter !== undefined && currentFilter !== "";

  // Format the current filter for display
  const formatFilterDisplay = (filter: string) => {
    if (!filter) return filter;

    // Use pipe separator
    if (!filter.includes("|")) {
      // No pipe - it's a relative date filter
      const symbol = operatorSymbols[filter as DateOperator] || filter;
      return symbol;
    }

    const parts = filter.split("|");
    const op = parts[0] as DateOperator;
    const symbol = operatorSymbols[op] || op;

    if (parts.length === 3) {
      // Between operator with two dates
      const date1 = new Date(parts[1]);
      const date2 = new Date(parts[2]);
      if (!isNaN(date1.getTime()) && !isNaN(date2.getTime())) {
        const d1 = format(date1, "PP", { locale: getDateFnsLocale(locale) });
        const d2 = format(date2, "PP", { locale: getDateFnsLocale(locale) });
        return `${symbol} ${d1} and ${d2}`;
      }
      return `${symbol} Invalid Date`;
    } else if (parts[1]) {
      // Single date
      const date = new Date(parts[1]);
      if (!isNaN(date.getTime())) {
        const d = format(date, "PP", { locale: getDateFnsLocale(locale) });
        return `${symbol} ${d}`;
      }
      return `${symbol} Invalid Date`;
    }
    return symbol;
  };

  return (
    <div className="p-2 space-y-2 bg-muted/30 rounded-md">
      {hasActiveFilter && (
        <div className="flex items-center justify-between text-xs bg-primary/10 p-1.5 rounded">
          <span className="text-primary font-medium">
            Filter active: {formatFilterDisplay(currentFilter)}
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
            title="Clear filter"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      <Select value={operator} onValueChange={(val) => setOperator(val as DateOperator)}>
        <SelectTrigger className="w-full h-8 text-xs">
          <SelectValue placeholder="Select operator" />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(operatorLabels) as DateOperator[]).map((op) => (
            <SelectItem key={op} value={op} className="text-xs">
              {operatorLabels[op]}
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
                  <span>Select date</span>
                )}
                <CalendarDays className="ml-auto h-3 w-3 opacity-50" />
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
                  }
                }}
                autoFocus
              />
            </PopoverContent>
          </Popover>

          {operator === "between" && (
            <>
              <span className="text-xs text-muted-foreground">and</span>
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
                      <span>Select date</span>
                    )}
                    <CalendarDays className="ml-auto h-3 w-3 opacity-50" />
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
        <Button
          size="sm"
          onClick={handleApply}
          className="h-8 w-full text-xs"
        >
          Apply Filter
        </Button>
      )}

      {operator === "between" && date1 && date2 && date1 >= date2 && (
        <p className="text-xs text-destructive">First date must be before second date</p>
      )}
    </div>
  );
}
