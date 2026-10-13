"use client";

import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import { useMemo, type ReactNode } from "react";
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
function makeLocalFetcher<Option extends RequirementFilterOption>(
  options: Option[],
  mapSearchResult?: (option: Option) => Option
): AsyncOptionsFetcher<Option> {
  return async (query, page, pageSize) => {
    const lower = query.toLowerCase();
    const filtered = lower
      ? options
          .filter((option) => option.label.toLowerCase().includes(lower))
          // e.g. the milestone scope picker drops its tree indentation on
          // an active search, exactly as MilestoneSelect does — a child
          // whose parent didn't match would indent under nothing.
          .map((option) => (mapSearchResult ? mapSearchResult(option) : option))
      : options;
    const start = page * pageSize;
    return {
      results: filtered.slice(start, start + pageSize),
      total: filtered.length,
    };
  };
}

interface RequirementsFilterComboboxProps<
  Option extends RequirementFilterOption,
> {
  /** Placeholder AND accessible name -- the trigger is a button whose
   *  selected badges do not name it, so tests and screen readers both
   *  reach these comboboxes by this string. */
  label: string;
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** Tooltip for the disabled state; rendered on a wrapper because a
   *  disabled button fires no pointer events of its own. */
  title?: string;
  testId: string;
  /** Custom dropdown-row and selected-chip renderers — the execution-scope
   *  pickers use these to show options the way the rest of the app does
   *  (milestone-type icon + indentation, the Combine configuration icon);
   *  the three filter axes keep the plain label default. */
  renderOption?: (option: Option) => ReactNode;
  renderSelectedOption?: (option: Option) => ReactNode;
  /** Applied to each match while a search is active (see makeLocalFetcher). */
  mapSearchResult?: (option: Option) => Option;
}

export function RequirementsFilterCombobox<
  Option extends RequirementFilterOption,
>({
  label,
  options,
  selected,
  onChange,
  disabled = false,
  title,
  testId,
  renderOption,
  renderSelectedOption,
  mapSearchResult,
}: RequirementsFilterComboboxProps<Option>) {
  const fetchOptions = useMemo(
    () => makeLocalFetcher(options, mapSearchResult),
    [options, mapSearchResult]
  );
  // A selected value whose option has since disappeared (a status no loaded
  // row carries any more) still renders as its own raw value rather than
  // vanishing from the trigger while remaining active in the query.
  const selectedOptions = useMemo(
    () =>
      selected.map(
        (value) =>
          options.find((option) => option.value === value) ??
          ({ value, label: value } as Option)
      ),
    [selected, options]
  );

  return (
    <span data-testid={testId} title={title}>
      <MultiAsyncCombobox<Option>
        value={selectedOptions}
        onValueChange={(next) => onChange(next.map((option) => option.value))}
        fetchOptions={fetchOptions}
        getOptionValue={(option) => option.value}
        getOptionLabel={(option) => option.label}
        renderOption={
          renderOption ??
          ((option) => (
            <span className="flex min-w-0 flex-1 items-center">
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.count !== undefined && (
                <span className="ms-2 text-xs text-muted-foreground">
                  {option.count}
                </span>
              )}
            </span>
          ))
        }
        renderSelectedOption={
          renderSelectedOption ?? ((option) => option.label)
        }
        placeholder={label}
        ariaLabel={label}
        disabled={disabled}
        className="min-h-8 w-auto min-w-40 max-w-72 text-xs"
        dropdownClassName="p-0 min-w-[260px] max-w-[400px]"
      />
    </span>
  );
}
