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
import { Check } from "lucide-react";

type NumericOperator = "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "between";

interface NumericFilterInputProps {
  fieldId: number;
  fieldType: string;
  onFilterApply: (operator: NumericOperator, value1: number, value2?: number) => void;
  currentFilter: string | null;
}

const operatorLabels: Record<NumericOperator, string> = {
  eq: "Equals (=)",
  ne: "Not equals (≠)",
  lt: "Less than (<)",
  lte: "Less than or equal (≤)",
  gt: "Greater than (>)",
  gte: "Greater than or equal (≥)",
  between: "Between",
};

export function NumericFilterInput({
  fieldId,
  fieldType,
  onFilterApply,
  currentFilter,
}: NumericFilterInputProps) {
  const [operator, setOperator] = useState<NumericOperator>("eq");
  const [value1, setValue1] = useState<string>("");
  const [value2, setValue2] = useState<string>("");

  // Parse current filter if it exists
  useEffect(() => {
    if (currentFilter && currentFilter.includes(":")) {
      const parts = currentFilter.split(":");
      if (parts.length >= 2) {
        setOperator(parts[0] as NumericOperator);
        setValue1(parts[1]);
        if (parts.length === 3) {
          setValue2(parts[2]);
        }
      }
    }
  }, [currentFilter]);

  const handleApply = () => {
    const num1 = parseFloat(value1);
    if (isNaN(num1)) return;

    if (operator === "between") {
      const num2 = parseFloat(value2);
      if (isNaN(num2)) return;
      onFilterApply(operator, num1, num2);
    } else {
      onFilterApply(operator, num1);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleApply();
    }
  };

  const isValid = () => {
    const num1 = parseFloat(value1);
    if (isNaN(num1)) return false;

    if (operator === "between") {
      const num2 = parseFloat(value2);
      if (isNaN(num2)) return false;
      return num1 < num2;
    }

    return true;
  };

  return (
    <div className="p-2 space-y-2 bg-muted/30 rounded-md">
      <Select value={operator} onValueChange={(val) => setOperator(val as NumericOperator)}>
        <SelectTrigger className="w-full h-8 text-xs">
          <SelectValue placeholder="Select operator" />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(operatorLabels) as NumericOperator[]).map((op) => (
            <SelectItem key={op} value={op} className="text-xs">
              {operatorLabels[op]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex gap-2 items-center">
        <Input
          type="number"
          step={fieldType === "Integer" ? "1" : "any"}
          placeholder="Value"
          value={value1}
          onChange={(e) => setValue1(e.target.value)}
          onKeyPress={handleKeyPress}
          className="h-8 text-xs"
        />

        {operator === "between" && (
          <>
            <span className="text-xs text-muted-foreground">and</span>
            <Input
              type="number"
              step={fieldType === "Integer" ? "1" : "any"}
              placeholder="Value"
              value={value2}
              onChange={(e) => setValue2(e.target.value)}
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

      {operator === "between" && value1 && value2 && parseFloat(value1) >= parseFloat(value2) && (
        <p className="text-xs text-destructive">First value must be less than second value</p>
      )}
    </div>
  );
}
