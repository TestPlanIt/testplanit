"use client";

import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import { useCallback, useMemo } from "react";

/** One page of a list held in memory, filtered by a search text. */
export function pageOf<T>(
  items: T[],
  label: (item: T) => string,
  query: string,
  page: number,
  pageSize: number
): { results: T[]; total: number } {
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? items.filter((item) => label(item).toLowerCase().includes(needle))
    : items;
  return {
    results: filtered.slice(page * pageSize, (page + 1) * pageSize),
    total: filtered.length,
  };
}

export type ChoiceOption = { id: string; name: string };

/** A field that takes several of a fixed list of values. */
export function MultiChoiceField({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: ChoiceOption[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const fetchOptions = useCallback(
    async (query: string, page: number, pageSize: number) =>
      pageOf(options, (option) => option.name, query, page, pageSize),
    [options]
  );
  const selected = useMemo(
    () => options.filter((option) => value.includes(option.id)),
    [options, value]
  );
  return (
    <MultiAsyncCombobox<ChoiceOption>
      value={selected}
      onValueChange={(next) => onChange(next.map((option) => option.id))}
      fetchOptions={fetchOptions}
      renderOption={(option) => option.name}
      getOptionValue={(option) => option.id}
      getOptionLabel={(option) => option.name}
      placeholder={`Select ${name}`}
      ariaLabel={name}
      className="w-full"
      hideSelectAll
    />
  );
}
