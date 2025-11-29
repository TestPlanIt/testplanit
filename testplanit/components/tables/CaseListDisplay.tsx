"use client";

import React, { useCallback, useMemo } from "react";
import type { Prisma, RepositoryCaseSource } from "@prisma/client";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { CaseDisplay } from "./CaseDisplay";
import { ListChecks } from "lucide-react";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "~/utils";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";

interface CasesListProps {
  caseIds?: number[];
  filter?: Prisma.RepositoryCasesWhereInput;
  count?: number;
  pageSize?: number;
  isLoading?: boolean;
}

interface CaseOption {
  id: number;
  name: string;
  source: RepositoryCaseSource;
}

const DEFAULT_PAGE_SIZE = 10;

export const CasesListDisplay: React.FC<CasesListProps> = ({
  caseIds,
  filter,
  count,
  pageSize = DEFAULT_PAGE_SIZE,
  isLoading = false,
}) => {
  const t = useTranslations("common");

  const computedCount =
    count ?? (typeof caseIds !== "undefined" ? caseIds.length : undefined);

  const baseConditions = useMemo(() => {
    const conditions: Prisma.RepositoryCasesWhereInput[] = [
      { isDeleted: false },
    ];

    if (filter) {
      conditions.push(filter);
    } else if (caseIds && caseIds.length > 0) {
      conditions.push({ id: { in: caseIds } });
    } else {
      return null;
    }

    return conditions;
  }, [filter, caseIds]);

  const buildWhere = useCallback(
    (search: string) => {
      if (!baseConditions) {
        return null;
      }

      const conditions = [...baseConditions];
      const trimmed = search.trim();

      if (trimmed.length > 0) {
        conditions.push({
          OR: [
            { name: { contains: trimmed, mode: "insensitive" } },
            { className: { contains: trimmed, mode: "insensitive" } },
          ],
        });
      }

      if (conditions.length === 1) {
        return conditions[0];
      }

      return { AND: conditions };
    },
    [baseConditions]
  );

  const fetchCases = useCallback(
    async (query: string, page: number, size: number) => {
      const where = buildWhere(query);

      if (!where) {
        return { results: [], total: 0 };
      }

      const params = {
        where,
        orderBy: { name: "asc" } as const,
        skip: page * size,
        take: size,
        select: {
          id: true,
          name: true,
          source: true,
        },
      };

      const response = await fetch(
        `/api/model/RepositoryCases/findMany?q=${encodeURIComponent(JSON.stringify(params))}`
      );

      if (!response.ok) {
        console.error("Failed to load cases", await response.text());
        return { results: [], total: 0 };
      }

      const payload = await response.json();
      const results = Array.isArray(payload?.data)
        ? (payload.data as CaseOption[])
        : [];

      let total = computedCount !== undefined ? computedCount : results.length;
      const needsCount = query.trim().length > 0 || computedCount === undefined;

      if (needsCount) {
        const countResponse = await fetch(
          `/api/model/RepositoryCases/count?q=${encodeURIComponent(JSON.stringify({ where }))}`
        );

        if (countResponse.ok) {
          const countPayload = await countResponse.json();

          if (typeof countPayload?.data === "number") {
            total = countPayload.data;
          }
        }
      }

      return { results, total };
    },
    [buildWhere, computedCount]
  );

  const handleValueChange = useCallback((_option: CaseOption | null) => {
    // Navigation is handled by the embedded Link inside CaseDisplay.
  }, []);

  // Show skeleton while loading and count is undefined
  if (isLoading && computedCount === undefined) {
    return <Skeleton className="h-6 w-12" />;
  }

  if (!baseConditions) {
    return null;
  }

  if (computedCount !== undefined && computedCount === 0) {
    return null;
  }

  const triggerLabel =
    computedCount !== undefined && computedCount > 0
      ? computedCount.toLocaleString()
      : "";
  const searchPlaceholder = t("searchCases", {
    count: computedCount ?? 0,
  });

  return (
    <AsyncCombobox<CaseOption>
      value={null}
      onValueChange={handleValueChange}
      fetchOptions={fetchCases}
      renderOption={(option) => (
        <CaseDisplay
          id={option.id}
          name={option.name}
          link={`/case/${option.id}`}
          source={option.source}
          maxLines={2}
        />
      )}
      getOptionValue={(option) => option.id}
      placeholder={searchPlaceholder}
      triggerLabel={triggerLabel}
      renderTrigger={({ triggerLabel }) => {
        const displayLabel =
          typeof triggerLabel === "number"
            ? triggerLabel.toString()
            : typeof triggerLabel === "string"
              ? triggerLabel
              : "";
        return (
          <button
            type="button"
            aria-label={searchPlaceholder}
            className={cn(
              badgeVariants({ variant: "default" }),
              "gap-1 whitespace-nowrap text-xs"
            )}
          >
            <ListChecks className="w-4 h-4" />
            {displayLabel && <span>{displayLabel}</span>}
          </button>
        );
      }}
      dropdownClassName="p-0 min-w-[480px] max-w-[720px]"
      pageSize={pageSize}
      showTotal
    />
  );
};
