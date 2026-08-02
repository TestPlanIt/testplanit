"use client";

import { ProjectNameDisplay } from "@/components/search/ProjectNameDisplay";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { badgeVariants } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { RepositoryCaseSource } from "~/zenstack/models";
import type { RepositoryCasesWhereInput } from "~/zenstack/input";
import { ListChecks } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import React, { useCallback, useMemo } from "react";
import { cn } from "~/utils";
import { CaseDisplay } from "./CaseDisplay";

interface CasesListProps {
  caseIds?: number[];
  filter?: RepositoryCasesWhereInput;
  count?: number;
  pageSize?: number;
  isLoading?: boolean;
  /**
   * Show each case's project name in the dropdown rows — for lists that span
   * projects (e.g. the milestone Issues panel's cross-project total), so a
   * row can't be mistaken for one of the current project's cases.
   */
  showProject?: boolean;
  /** Open case links in a new tab (adds the external-link hover affordance). */
  openInNewTab?: boolean;
  /** Rendered before the count in the trigger badge (e.g. "+"). */
  triggerPrefix?: string;
  /** Badge variant for the trigger; the solid default reads as this-project. */
  triggerVariant?: "default" | "secondary" | "destructive" | "outline";
}

interface CaseOption {
  id: number;
  name: string;
  source: RepositoryCaseSource;
  automated?: boolean;
  hasParameters?: boolean;
  projectId: number;
  project?: { name: string; iconUrl?: string | null } | null;
}

const DEFAULT_PAGE_SIZE = 10;

export const CasesListDisplay: React.FC<CasesListProps> = ({
  caseIds,
  filter,
  count,
  pageSize = DEFAULT_PAGE_SIZE,
  isLoading = false,
  showProject = false,
  openInNewTab = false,
  triggerPrefix,
  triggerVariant = "default",
}) => {
  const locale = useLocale();
  const t = useTranslations("common");

  const computedCount =
    count ?? (typeof caseIds !== "undefined" ? caseIds.length : undefined);

  const baseConditions = useMemo(() => {
    const conditions: RepositoryCasesWhereInput[] = [{ isDeleted: false }];

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
          automated: true,
          hasParameters: true,
          projectId: true,
          ...(showProject
            ? { project: { select: { name: true, iconUrl: true } } }
            : {}),
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
    [buildWhere, computedCount, showProject]
  );

  const handleValueChange = useCallback((_option: CaseOption | null) => {
    // Navigation is handled by the embedded Link inside CaseDisplay.
  }, []);

  if (isLoading) {
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
      ? computedCount.toLocaleString(locale)
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
        <div className="flex w-full items-center justify-between gap-2">
          <CaseDisplay
            id={option.id}
            name={option.name}
            // Direct project-qualified URL — the bare /case/{id} resolver
            // hop doesn't resolve reliably for cases in OTHER projects, and
            // the fetch already knows each case's projectId.
            link={`/projects/repository/${option.projectId}/${option.id}`}
            linkTarget={openInNewTab ? "_blank" : undefined}
            source={option.source}
            automated={option.automated}
            hasParameters={option.hasParameters}
            maxLines={2}
          />
          {showProject && option.project?.name && (
            // Capped tight so the case name keeps most of the row — the full
            // project name stays reachable via the display's own tooltip.
            <span className="min-w-0 max-w-[90px] shrink-0">
              <ProjectNameDisplay
                projectName={option.project.name}
                projectId={option.projectId}
                iconUrl={option.project.iconUrl}
                className="text-xs text-muted-foreground"
                fitContainer
              />
            </span>
          )}
        </div>
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
              badgeVariants({ variant: triggerVariant }),
              "gap-1 whitespace-nowrap text-xs"
            )}
          >
            <ListChecks className="w-4 h-4" />
            {displayLabel && (
              <span>
                {triggerPrefix
                  ? `${triggerPrefix}${displayLabel}`
                  : displayLabel}
              </span>
            )}
          </button>
        );
      }}
      dropdownClassName="p-0 min-w-[480px] max-w-[720px]"
      pageSize={pageSize}
      showTotal
    />
  );
};
