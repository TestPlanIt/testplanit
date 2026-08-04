"use client";

import {
  operatorLabelKey,
  type FilterInputValue,
} from "@/components/filterInputValue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

type NumericOperator = "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "between";

const LEGACY_OPERATORS: readonly string[] = [
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
  "between",
];

// Registry operators that take no value (has-value / is-empty); only offered
// in structured mode via the `operators` prop.
const VALUELESS_OPERATORS: readonly string[] = ["any", "none"];

interface NumericFilterInputProps {
  fieldId: number;
  fieldType: string;
  onFilterApply?: (
    operator: NumericOperator,
    value1: number,
    value2?: number
  ) => void;
  onClearFilter?: () => void;
  currentFilter: string | null;
  /** Structured chip-editor mode: the committed {operator, values}. */
  value?: FilterInputValue | null;
  /**
   * Structured change path — emits only complete, parseable states (the chip
   * editor debounces free-text edits before persisting).
   */
  onValueChange?: (next: FilterInputValue) => void;
  /** Operator whitelist for structured mode; defaults to the legacy set. */
  operators?: readonly string[];
}

// Comparison operators render as locale-neutral math symbols; every other
// operator reads from `common.operators.*`.
const OPERATOR_SYMBOLS: Record<string, string> = {
  eq: "=",
  ne: "≠",
  lt: "<",
  lte: "≤",
  gt: ">",
  gte: "≥",
};

const LABELLED_OPERATORS: readonly string[] = [
  ...LEGACY_OPERATORS,
  ...VALUELESS_OPERATORS,
];

export function NumericFilterInput({
  fieldId: _fieldId,
  fieldType,
  onFilterApply,
  onClearFilter,
  currentFilter,
  value,
  onValueChange,
  operators,
}: NumericFilterInputProps) {
  const t = useTranslations();
  const [operator, setOperator] = useState<string>("eq");
  const [value1, setValue1] = useState<string>("");
  const [value2, setValue2] = useState<string>("");

  const operatorOptions = operators ?? LEGACY_OPERATORS;
  const isValueless = VALUELESS_OPERATORS.includes(operator);

  // Parse current filter if it exists
  useEffect(() => {
    if (currentFilter && currentFilter.includes(":")) {
      const parts = currentFilter.split(":");
      if (parts.length >= 2) {
        setOperator(parts[0]);
        setValue1(parts[1]);
        if (parts.length === 3) {
          setValue2(parts[2]);
        }
      }
    }
  }, [currentFilter]);

  // Structured mode: sync from the committed predicate value.
  useEffect(() => {
    if (!value) return;
    setOperator(value.operator);
    setValue1(value.values[0] !== undefined ? String(value.values[0]) : "");
    setValue2(value.values[1] !== undefined ? String(value.values[1]) : "");
  }, [value]);

  const emitStructured = (op: string, raw1: string, raw2: string) => {
    if (!onValueChange) return;
    if (VALUELESS_OPERATORS.includes(op)) {
      onValueChange({ operator: op, values: [] });
      return;
    }
    const num1 = parseFloat(raw1);
    if (isNaN(num1)) return;
    if (op === "between") {
      const num2 = parseFloat(raw2);
      if (isNaN(num2) || num1 >= num2) return;
      onValueChange({ operator: op, values: [num1, num2] });
      return;
    }
    onValueChange({ operator: op, values: [num1] });
  };

  const handleApply = () => {
    if (isValueless) {
      emitStructured(operator, value1, value2);
      return;
    }
    const num1 = parseFloat(value1);
    if (isNaN(num1)) return;

    if (operator === "between") {
      const num2 = parseFloat(value2);
      if (isNaN(num2)) return;
      onFilterApply?.(operator, num1, num2);
    } else {
      onFilterApply?.(operator as NumericOperator, num1);
    }
    emitStructured(operator, value1, value2);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleApply();
    }
  };

  const isValid = () => {
    if (isValueless) return true;
    const num1 = parseFloat(value1);
    if (isNaN(num1)) return false;

    if (operator === "between") {
      const num2 = parseFloat(value2);
      if (isNaN(num2)) return false;
      return num1 < num2;
    }

    return true;
  };

  const hasActiveFilter = currentFilter && currentFilter.includes(":");

  const operatorLabel = (op: string) =>
    OPERATOR_SYMBOLS[op] ??
    (LABELLED_OPERATORS.includes(op)
      ? t(`common.operators.${operatorLabelKey(op)}`)
      : op);

  // Format the current filter for display with symbols
  const formatFilterDisplay = (filter: string) => {
    if (!filter || !filter.includes(":")) return filter;
    const parts = filter.split(":");
    const op = parts[0];
    const symbol = operatorLabel(op);

    if (op === "between" && parts.length === 3) {
      return `${symbol} ${parts[1]} ${t("common.and")} ${parts[2]}`;
    }
    return `${symbol} ${parts[1]}`;
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
              setValue1("");
              setValue2("");
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
          emitStructured(val, value1, value2);
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

      {!isValueless && (
        <div className="flex gap-2 items-center">
          <Input
            type="number"
            step={fieldType === "Integer" ? "1" : "any"}
            placeholder={t("common.placeholders.value")}
            value={value1}
            onChange={(e) => {
              setValue1(e.target.value);
              emitStructured(operator, e.target.value, value2);
            }}
            onKeyPress={handleKeyPress}
            className="h-8 text-xs"
          />

          {operator === "between" && (
            <>
              <span className="text-xs text-muted-foreground">
                {t("common.and")}
              </span>
              <Input
                type="number"
                step={fieldType === "Integer" ? "1" : "any"}
                placeholder={t("common.placeholders.value")}
                value={value2}
                onChange={(e) => {
                  setValue2(e.target.value);
                  emitStructured(operator, value1, e.target.value);
                }}
                onKeyPress={handleKeyPress}
                className="h-8 text-xs"
              />
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

      {operator === "between" &&
        value1 &&
        value2 &&
        parseFloat(value1) >= parseFloat(value2) && (
          <p className="text-xs text-destructive">
            {t("search.filters.validation.firstValueMustBeLessThanSecond")}
          </p>
        )}
    </div>
  );
}
