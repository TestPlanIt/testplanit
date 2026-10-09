"use client";

import { useCallback } from "react";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { CaseDisplay } from "@/components/tables/CaseDisplay";

interface CaseOption {
  id: number;
  name: string;
  automated: boolean;
}

/**
 * Pick one repository case by name or id. Searches server-side through the
 * generated client so a large repository never loads in full.
 */
export function CaseSearchSelect({
  projectId,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  projectId: number;
  value: CaseOption | null;
  onChange: (value: CaseOption | null) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const fetchOptions = useCallback(
    async (query: string, page: number, pageSize: number) => {
      const trimmed = query.trim();
      const numeric = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
      const where = {
        projectId,
        isDeleted: false,
        ...(trimmed
          ? {
              OR: [
                { name: { contains: trimmed, mode: "insensitive" } },
                ...(numeric != null ? [{ id: numeric }] : []),
              ],
            }
          : {}),
      };
      // Same RPC the linked-cases picker uses: a server-side search through
      // the policy layer, so a large repository never loads in full.
      const listParams = {
        where,
        select: { id: true, name: true, automated: true },
        orderBy: { name: "asc" },
        skip: page * pageSize,
        take: pageSize,
      };
      const [listRes, countRes] = await Promise.all([
        fetch(
          `/api/model/repositoryCases/findMany?q=${encodeURIComponent(JSON.stringify(listParams))}`
        ),
        fetch(
          `/api/model/repositoryCases/count?q=${encodeURIComponent(JSON.stringify({ where }))}`
        ),
      ]);
      const list = await listRes.json();
      const count = await countRes.json();
      return {
        results: (Array.isArray(list.data) ? list.data : []) as CaseOption[],
        total: typeof count.data === "number" ? count.data : 0,
      };
    },
    [projectId]
  );

  return (
    <AsyncCombobox<CaseOption>
      value={value}
      onValueChange={onChange}
      fetchOptions={fetchOptions}
      getOptionValue={(option) => option.id}
      renderOption={(option) => (
        <CaseDisplay testCase={option} showIcon={true} size="small" />
      )}
      placeholder={placeholder}
      ariaLabel={placeholder}
      triggerLabel={value ? `${value.name} (#${value.id})` : undefined}
      disabled={disabled}
      className="w-full"
    />
  );
}
