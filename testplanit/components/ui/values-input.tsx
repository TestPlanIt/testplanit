"use client";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "~/utils";

interface ValuesInputProps {
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  /** A key that also adds the typed value, besides Enter (e.g. a comma). */
  separator?: string;
  /** Classes for the chips and the field, e.g. "font-mono". */
  className?: string;
  testIdPrefix: string;
}

/**
 * Tag list of free-text values: Enter (or the separator) adds the typed
 * value, Backspace on an empty field removes the last one.
 */
export function ValuesInput({
  values,
  onChange,
  disabled,
  placeholder,
  ariaLabel,
  separator,
  className,
  testIdPrefix,
}: ValuesInputProps) {
  const tCommon = useTranslations("common");
  const [draft, setDraft] = useState("");

  const commit = () => {
    const value = draft.trim();
    setDraft("");
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
  };

  return (
    <div className="space-y-1.5">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {values.map((value) => (
            <Badge
              key={value}
              variant="secondary"
              className={cn("gap-1", className)}
              data-testid={`${testIdPrefix}-value`}
            >
              {value}
              {!disabled && (
                <button
                  type="button"
                  className="rounded-sm hover:text-destructive"
                  onClick={() => onChange(values.filter((v) => v !== value))}
                  aria-label={tCommon("actions.remove")}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || (separator && e.key === separator)) {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        className={cn("text-sm", className)}
        data-testid={`${testIdPrefix}-values-input`}
      />
    </div>
  );
}
