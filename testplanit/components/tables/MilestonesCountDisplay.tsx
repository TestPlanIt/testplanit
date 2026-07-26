"use client";

import { MilestoneIconAndName } from "@/components/MilestoneIconAndName";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { badgeVariants } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { MilestonesWhereInput } from "~/zenstack/input";
import { Milestone } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import React, { useCallback } from "react";
import { cn } from "~/utils";

interface MilestonesCountDisplayProps {
  /**
   * Where clause selecting the milestones an issue belongs to, e.g.
   * `{ milestoneIssues: { some: { issueId } }, isDeleted: false }`. The
   * popover list is fetched lazily from this filter, mirroring the
   * Cases/Runs/Sessions columns so the number comes from the counts API but
   * the list is only queried on open.
   */
  filter?: MilestonesWhereInput;
  count?: number;
  pageSize?: number;
  isLoading?: boolean;
}

/**
 * The milestone fields the shared MilestoneIconAndName chip needs:
 * `milestoneType.icon` drives the type icon, `projectId` the detail link, and
 * the tracker-linkage fields the Jira source badge — the same chip used on
 * milestone lists and run/session groupings, so the row looks identical.
 */
type MilestoneRow = {
  id: number;
  name: string;
  projectId: number;
  integrationId: number | null;
  externalKind: string | null;
  detachedAt: string | null;
  milestoneType?: { icon?: { name: string } | null } | null;
};

const DEFAULT_PAGE_SIZE = 10;

/**
 * Count badge + lazy popover of the milestones an issue is a member of,
 * matching the TestRuns/Sessions/Cases linkage columns on the issues tables.
 * Each milestone renders through the shared MilestoneOptionContent so it
 * carries the same type icon + Jira source badge as the milestone picker.
 * Renders nothing when the count is 0.
 */
export const MilestonesCountDisplay: React.FC<MilestonesCountDisplayProps> = ({
  filter,
  count,
  pageSize = DEFAULT_PAGE_SIZE,
  isLoading = false,
}) => {
  const locale = useLocale();
  const t = useTranslations("common");

  const fetchMilestones = useCallback(
    async (query: string, page: number, size: number) => {
      if (!filter) {
        return { results: [], total: 0 };
      }

      const trimmed = query.trim();
      const where: MilestonesWhereInput =
        trimmed.length > 0
          ? {
              AND: [
                filter,
                { name: { contains: trimmed, mode: "insensitive" } },
              ],
            }
          : filter;

      const params = {
        where,
        orderBy: [{ name: "asc" } as const],
        skip: page * size,
        take: size,
        select: {
          id: true,
          name: true,
          projectId: true,
          integrationId: true,
          externalKind: true,
          detachedAt: true,
          milestoneType: { select: { icon: { select: { name: true } } } },
        },
      };

      const response = await fetch(
        `/api/model/Milestones/findMany?q=${encodeURIComponent(JSON.stringify(params))}`
      );
      if (!response.ok) {
        console.error("Failed to load milestones", await response.text());
        return { results: [], total: 0 };
      }

      const payload = await response.json();
      const results = Array.isArray(payload?.data)
        ? (payload.data as MilestoneRow[])
        : [];

      const countResponse = await fetch(
        `/api/model/Milestones/count?q=${encodeURIComponent(JSON.stringify({ where }))}`
      );
      let total = results.length;
      if (countResponse.ok) {
        const countPayload = await countResponse.json();
        if (typeof countPayload?.data === "number") {
          total = countPayload.data;
        }
      }

      return { results, total };
    },
    [filter]
  );

  const handleValueChange = useCallback((_option: MilestoneRow | null) => {
    // Navigation handled inside the rendered option link.
  }, []);

  if (isLoading) {
    return <Skeleton className="h-6 w-12" />;
  }

  if (count !== undefined && count === 0) {
    return null;
  }

  const triggerLabel =
    count !== undefined && count > 0 ? count.toLocaleString(locale) : "";
  const searchPlaceholder = t("searchMilestones", { count: count ?? 0 });

  return (
    <AsyncCombobox<MilestoneRow>
      value={null}
      onValueChange={handleValueChange}
      fetchOptions={fetchMilestones}
      renderOption={(option) => (
        // Reuse the canonical milestone chip (link + type icon + Jira source
        // badge) so the row matches milestone lists and run/session groupings.
        <MilestoneIconAndName
          projectId={option.projectId}
          milestone={{
            id: option.id,
            name: option.name,
            milestoneType: option.milestoneType ?? { icon: null },
            integrationId: option.integrationId,
            externalKind: option.externalKind,
            detachedAt: option.detachedAt,
          }}
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
            <Milestone className="w-4 h-4 shrink-0" />
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
