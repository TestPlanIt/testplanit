"use client";

import { Tag } from "lucide-react";
import { useCallback } from "react";
import { AsyncCombobox } from "@/components/ui/async-combobox";

interface TagOption {
  id: number;
  name: string;
}

/**
 * Pick one tag by name. Tags are instance-wide and number in the hundreds
 * on a busy install, so the list is searched server-side through the model
 * RPC rather than loaded in full.
 */
export function TagSearchSelect({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: TagOption | null;
  onChange: (value: TagOption | null) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const fetchOptions = useCallback(
    async (query: string, page: number, pageSize: number) => {
      const trimmed = query.trim();
      const where = {
        isDeleted: false,
        ...(trimmed
          ? { name: { contains: trimmed, mode: "insensitive" } }
          : {}),
      };
      const listParams = {
        where,
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        skip: page * pageSize,
        take: pageSize,
      };
      const [listRes, countRes] = await Promise.all([
        fetch(
          `/api/model/tags/findMany?q=${encodeURIComponent(JSON.stringify(listParams))}`
        ),
        fetch(
          `/api/model/tags/count?q=${encodeURIComponent(JSON.stringify({ where }))}`
        ),
      ]);
      const list = await listRes.json();
      const count = await countRes.json();
      return {
        results: (Array.isArray(list.data) ? list.data : []) as TagOption[],
        total: typeof count.data === "number" ? count.data : 0,
      };
    },
    []
  );

  return (
    <AsyncCombobox<TagOption>
      value={value}
      onValueChange={onChange}
      fetchOptions={fetchOptions}
      getOptionValue={(option) => option.id}
      renderOption={(option) => (
        <span
          className="inline-flex items-center gap-2"
          data-testid={`alert-tag-option-${option.id}`}
        >
          <Tag className="h-3.5 w-3.5 text-muted-foreground" />
          {option.name}
        </span>
      )}
      placeholder={placeholder}
      ariaLabel={placeholder}
      triggerLabel={value?.name}
      disabled={disabled}
      className="w-full"
    />
  );
}
