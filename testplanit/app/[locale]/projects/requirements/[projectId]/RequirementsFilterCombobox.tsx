"use client";

import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import { useMemo } from "react";
import type { AsyncOptionsFetcher } from "~/hooks/useAsyncComboboxOptions";

/**
 * The requirements list's Coverage/Status/Source filters, each a
 * multi-select over an option list this page already holds in memory
 * (`collectCoverageStatusOptions`/`collectRequirementStatusOptions` below
 * the lazy threshold, the server's own facets above it).
 *
 * Modelled on `JunitFilterBar.tsx`'s `FacetCombobox` -- the same
 * `MultiAsyncCombobox`, the same in-memory fetcher shim, the same
 * value-array-in/value-array-out contract -- so the two facet bars in this
 * app behave identically rather than each inventing its own multi-select.
 */

export interface RequirementFilterOption {
  value: string;
  label: string;
  /** Right-aligned trailing count, when the axis has one to show. */
  count?: number;
}

/**
 * Serves an already-loaded option list through `MultiAsyncCombobox`'s async
 * fetcher contract. Verbatim in shape to `JunitFilterBar.tsx`'s own
 * `makeLocalFetcher`, matching on the LABEL because that is the text the
 * user can actually see in the row (`status:12` is never typed at this box).
 */
function makeLocalFetcher(
  options: RequirementFilterOption[]
): AsyncOptionsFetcher<RequirementFilterOption> {
  return async (query, page, pageSize) => {
    const lower = query.toLowerCase();
    const filtered = lower
      ? options.filter((option) => option.label.toLowerCase().includes(lower))
      : options;
    const start = page * pageSize;
    return {
      results: filtered.slice(start, start + pageSize),
      total: filtered.length,
    };
  };
}

interface RequirementsFilterComboboxProps {
  /** Placeholder AND accessible name -- the trigger is a button whose
   *  selected badges do not name it, so tests and screen readers both
   *  reach these comboboxes by this string. */
  label: string;
  options: RequirementFilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** Tooltip for the disabled state; rendered on a wrapper because a
   *  disabled button fires no pointer events of its own. */
  title?: string;
  testId: string;
}

export function RequirementsFilterCombobox({
  label,
  options,
  selected,
  onChange,
  disabled = false,
  title,
  testId,
}: RequirementsFilterComboboxProps) {
  const fetchOptions = useMemo(() => makeLocalFetcher(options), [options]);
  // A selected value whose option has since disappeared (a status no loaded
  // row carries any more) still renders as its own raw value rather than
  // vanishing from the trigger while remaining active in the query.
  const selectedOptions = useMemo(
    () =>
      selected.map(
        (value) =>
          options.find((option) => option.value === value) ?? {
            value,
            label: value,
          }
      ),
    [selected, options]
  );

  return (
    <span data-testid={testId} title={title}>
      <MultiAsyncCombobox<RequirementFilterOption>
        value={selectedOptions}
        onValueChange={(next) => onChange(next.map((option) => option.value))}
        fetchOptions={fetchOptions}
        getOptionValue={(option) => option.value}
        getOptionLabel={(option) => option.label}
        renderOption={(option) => (
          <span className="flex min-w-0 flex-1 items-center">
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.count !== undefined && (
              <span className="ms-2 text-xs text-muted-foreground">
                {option.count}
              </span>
            )}
          </span>
        )}
        renderSelectedOption={(option) => option.label}
        placeholder={label}
        ariaLabel={label}
        disabled={disabled}
        className="min-h-8 w-auto min-w-40 max-w-72 text-xs"
        dropdownClassName="p-0 min-w-[260px] max-w-[400px]"
      />
    </span>
  );
}
