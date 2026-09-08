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

type TextOperator =
  "contains" | "startsWith" | "endsWith" | "equals" | "notContains";

const LEGACY_OPERATORS: readonly string[] = [
  "contains",
  "startsWith",
  "endsWith",
  "equals",
  "notContains",
];

// Registry operators that take no value (has-value / is-empty); only offered
// in structured mode via the `operators` prop.
const VALUELESS_OPERATORS: readonly string[] = ["any", "none"];

// Operators that have a `common.operators.*` label; anything outside this set
// (a hand-edited URL) falls back to the raw token rather than a missing key.
const LABELLED_OPERATORS: readonly string[] = [
  ...LEGACY_OPERATORS,
  ...VALUELESS_OPERATORS,
];

interface TextFilterInputProps {
  fieldId: number;
  onFilterApply?: (operator: TextOperator, value: string) => void;
  onClearFilter?: () => void;
  currentFilter: string | null;
  /** Structured chip-editor mode: the committed {operator, values}. */
  value?: FilterInputValue | null;
  /**
   * Structured change path — emits only complete states (the chip editor
   * debounces free-text edits before persisting).
   */
  onValueChange?: (next: FilterInputValue) => void;
  /** Operator whitelist for structured mode; defaults to the legacy set. */
  operators?: readonly string[];
}

export function TextFilterInput({
  fieldId: _fieldId,
  onFilterApply,
  onClearFilter,
  currentFilter,
  value: structuredValue,
  onValueChange,
  operators,
}: TextFilterInputProps) {
  const t = useTranslations();
  const [operator, setOperator] = useState<string>("contains");
  const [value, setValue] = useState<string>("");

  const operatorOptions = operators ?? LEGACY_OPERATORS;
  const isValueless = VALUELESS_OPERATORS.includes(operator);

  // Parse current filter if it exists
  useEffect(() => {
    if (currentFilter && currentFilter.includes("|")) {
      const parts = currentFilter.split("|");
      if (parts.length >= 2) {
        setOperator(parts[0]);
        setValue(parts[1] || "");
      }
    }
  }, [currentFilter]);

  // Structured mode: sync from the committed predicate value.
  useEffect(() => {
    if (!structuredValue) return;
    setOperator(structuredValue.operator);
    setValue(
      structuredValue.values[0] !== undefined
        ? String(structuredValue.values[0])
        : ""
    );
  }, [structuredValue]);

  const emitStructured = (op: string, raw: string) => {
    if (!onValueChange) return;
    if (VALUELESS_OPERATORS.includes(op)) {
      onValueChange({ operator: op, values: [] });
      return;
    }
    const trimmed = raw.trim();
    if (!trimmed) return;
    onValueChange({ operator: op, values: [trimmed] });
  };

  const handleApply = () => {
    if (isValueless) {
      emitStructured(operator, value);
      return;
    }
    if (!value.trim()) return;
    onFilterApply?.(operator as TextOperator, value.trim());
    emitStructured(operator, value);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleApply();
    }
  };

  const isValid = () => {
    return isValueless || value.trim().length > 0;
  };

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
    if (!filter || !filter.includes("|")) return filter;
    const parts = filter.split("|");
    const val = parts[1] || "";
    return `${operatorLabel(parts[0])} "${val}"`;
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
              setValue("");
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
          emitStructured(val, value);
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
            type="text"
            placeholder={t("common.placeholders.enterText")}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              emitStructured(operator, e.target.value);
            }}
            onKeyPress={handleKeyPress}
            className="h-8 text-xs"
          />

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
    </div>
  );
}
