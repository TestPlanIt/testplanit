"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";

type LinkOperator = "contains" | "startsWith" | "endsWith" | "equals" | "domain";

interface LinkFilterInputProps {
  fieldId: number;
  onFilterApply: (operator: LinkOperator, value: string) => void;
  onClearFilter?: () => void;
  currentFilter: string | null;
}

const operatorLabels: Record<LinkOperator, string> = {
  contains: "URL contains",
  domain: "Domain contains",
  startsWith: "URL starts with",
  endsWith: "URL ends with",
  equals: "Exact URL match",
};

const operatorSymbols: Record<LinkOperator, string> = {
  contains: "URL contains",
  startsWith: "URL starts with",
  endsWith: "URL ends with",
  equals: "URL equals",
  domain: "domain",
};

export function LinkFilterInput({
  fieldId,
  onFilterApply,
  onClearFilter,
  currentFilter,
}: LinkFilterInputProps) {
  const t = useTranslations();
  const [operator, setOperator] = useState<LinkOperator>("contains");
  const [value, setValue] = useState<string>("");

  // Parse current filter if it exists
  useEffect(() => {
    if (currentFilter && currentFilter.includes("|")) {
      const parts = currentFilter.split("|");
      if (parts.length >= 2) {
        setOperator(parts[0] as LinkOperator);
        setValue(parts[1] || "");
      }
    }
  }, [currentFilter]);

  const handleApply = () => {
    if (!value.trim()) return;
    onFilterApply(operator, value.trim());
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleApply();
    }
  };

  const isValid = () => {
    return value.trim().length > 0;
  };

  const hasActiveFilter = currentFilter !== null && currentFilter !== undefined && currentFilter !== "";

  // Format the current filter for display
  const formatFilterDisplay = (filter: string) => {
    if (!filter || !filter.includes("|")) return filter;
    const parts = filter.split("|");
    const op = parts[0] as LinkOperator;
    const symbol = operatorSymbols[op] || op;
    const val = parts[1] || "";
    return `${symbol} "${val}"`;
  };

  return (
    <div className="p-2 space-y-2 bg-muted/30 rounded-md">
      {hasActiveFilter && (
        <div className="flex items-center justify-between text-xs bg-primary/10 p-1.5 rounded">
          <span className="text-primary font-medium">
            {t("search.filters.filterActive")} {formatFilterDisplay(currentFilter)}
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
            title="Clear filter"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      <Select value={operator} onValueChange={(val) => setOperator(val as LinkOperator)}>
        <SelectTrigger className="w-full h-8 text-xs">
          <SelectValue placeholder="Select operator" />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(operatorLabels) as LinkOperator[]).map((op) => (
            <SelectItem key={op} value={op} className="text-xs">
              {operatorLabels[op]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex gap-2 items-center">
        <Input
          type="text"
          placeholder={operator === "domain" ? "example.com" : "Enter URL pattern..."}
          value={value}
          onChange={(e) => setValue(e.target.value)}
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

      {operator === "domain" && (
        <p className="text-xs text-muted-foreground">
          {t("search.filters.link.domainHelp")}
        </p>
      )}
    </div>
  );
}
