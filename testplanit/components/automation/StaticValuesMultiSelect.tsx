"use client";

import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import { useMemo } from "react";
import type { AsyncOptionsFetcher } from "~/hooks/useAsyncComboboxOptions";

interface Option {
  value: string;
}

interface Props {
  values: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  testId?: string;
}

/**
 * The house multi-picker over a fixed list of strings: a multiselect
 * parameter's choices (execute dialog) and its default (target dialog).
 */
export function StaticValuesMultiSelect({
  values,
  selected,
  onChange,
  placeholder,
  ariaLabel,
  disabled,
  testId,
}: Props) {
  const fetchOptions = useMemo<AsyncOptionsFetcher<Option>>(
    () => async (query, page, pageSize) => {
      const lower = query.toLowerCase();
      const filtered = (
        lower ? values.filter((v) => v.toLowerCase().includes(lower)) : values
      ).map((value) => ({ value }));
      const start = page * pageSize;
      return {
        results: filtered.slice(start, start + pageSize),
        total: filtered.length,
      };
    },
    [values]
  );
  const selectedOptions = useMemo(
    () => selected.map((value) => ({ value })),
    [selected]
  );
  return (
    <div data-testid={testId}>
      <MultiAsyncCombobox<Option>
        value={selectedOptions}
        onValueChange={(next) => onChange(next.map((o) => o.value))}
        fetchOptions={fetchOptions}
        getOptionValue={(o) => o.value}
        getOptionLabel={(o) => o.value}
        renderOption={(o) => (
          <span className="font-mono text-sm">{o.value}</span>
        )}
        placeholder={placeholder}
        ariaLabel={ariaLabel}
        disabled={disabled}
        className="min-h-9 w-full text-sm"
        hideSelectAll
      />
    </div>
  );
}
