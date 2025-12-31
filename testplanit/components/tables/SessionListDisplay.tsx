"use client";

import React, { useCallback, useMemo } from "react";
import type { Prisma } from "@prisma/client";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Compass } from "lucide-react";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "~/utils";
import { useTranslations } from "next-intl";
import { SessionTableDisplay } from "@/components/tables/SessionTableDisplay";
import { Skeleton } from "@/components/ui/skeleton";

interface SessionsListProps {
  sessionIds?: number[];
  sessions?: SessionOption[];
  filter?: Prisma.SessionsWhereInput;
  count?: number;
  pageSize?: number;
  isCompleted?: boolean;
  isLoading?: boolean;
}

type SessionOption = {
  id: number;
  name: string;
  projectId: number;
  isCompleted: boolean;
};

const DEFAULT_PAGE_SIZE = 10;

export const SessionsListDisplay: React.FC<SessionsListProps> = ({
  sessionIds,
  sessions,
  filter,
  count,
  pageSize = DEFAULT_PAGE_SIZE,
  isLoading = false,
}) => {
  const t = useTranslations("common");

  const prefetchedSessions = useMemo(() => sessions ?? [], [sessions]);

  const computedCount =
    count ??
    (prefetchedSessions.length > 0
      ? prefetchedSessions.length
      : sessionIds
        ? sessionIds.length
        : undefined);

  const baseConditions = useMemo(() => {
    const conditions: Prisma.SessionsWhereInput[] = [{ isDeleted: false }];

    if (filter) {
      conditions.push(filter);
    } else if (sessionIds && sessionIds.length > 0) {
      conditions.push({ id: { in: sessionIds } });
    } else if (!filter && (!sessionIds || sessionIds.length === 0)) {
      return null;
    }

    return conditions;
  }, [filter, sessionIds]);

  const buildWhere = useCallback(
    (search: string) => {
      if (!baseConditions) {
        return null;
      }

      const trimmed = search.trim();
      const conditions = [...baseConditions];

      if (trimmed.length > 0) {
        conditions.push({
          name: { contains: trimmed, mode: "insensitive" },
        });
      }

      if (conditions.length === 1) {
        return conditions[0];
      }

      return { AND: conditions };
    },
    [baseConditions]
  );

  const fetchSessions = useCallback(
    async (query: string, page: number, size: number) => {
      const where = buildWhere(query);

      if (!where) {
        if (prefetchedSessions.length === 0) {
          return { results: [], total: 0 };
        }

        const trimmed = query.trim().toLowerCase();
        const filtered = trimmed
          ? prefetchedSessions.filter((session) =>
              session.name.toLowerCase().includes(trimmed)
            )
          : prefetchedSessions;
        const start = page * size;
        const paginated = filtered.slice(start, start + size);
        return { results: paginated, total: filtered.length };
      }

      const params = {
        where,
        orderBy: [
          { isCompleted: "asc" } as const,
          { createdAt: "desc" } as const,
        ],
        skip: page * size,
        take: size,
        select: {
          id: true,
          name: true,
          projectId: true,
          isCompleted: true,
        },
      };

      const response = await fetch(
        `/api/model/Sessions/findMany?q=${encodeURIComponent(JSON.stringify(params))}`
      );

      if (!response.ok) {
        console.error("Failed to load sessions", await response.text());
        return { results: [], total: 0 };
      }

      const payload = await response.json();
      const results = Array.isArray(payload?.data)
        ? (payload.data as SessionOption[])
        : [];

      let total = computedCount ?? results.length;
      const needsCount = query.trim().length > 0 || computedCount === undefined;

      if (needsCount) {
        const countResponse = await fetch(
          `/api/model/Sessions/count?q=${encodeURIComponent(JSON.stringify({ where }))}`
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
    [buildWhere, computedCount, prefetchedSessions]
  );

  const handleValueChange = useCallback((_option: SessionOption | null) => {
    // Navigation handled by SessionTableDisplay
  }, []);

  // Show skeleton while loading and count is undefined
  if (isLoading && computedCount === undefined) {
    return <Skeleton className="h-6 w-12" />;
  }

  if (!baseConditions && prefetchedSessions.length === 0) {
    return null;
  }

  if (computedCount !== undefined && computedCount === 0) {
    return null;
  }

  const triggerLabel =
    computedCount !== undefined && computedCount > 0
      ? computedCount.toLocaleString()
      : "";

  const searchPlaceholder = t("searchSessions", {
    count: computedCount ?? 0,
  });

  return (
    <AsyncCombobox<SessionOption>
      value={null}
      onValueChange={handleValueChange}
      fetchOptions={fetchSessions}
      renderOption={(option) => (
        <SessionTableDisplay
          id={option.id}
          name={option.name}
          link={`/projects/sessions/${option.projectId}/${option.id}`}
          maxLines={2}
          isCompleted={option.isCompleted}
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
            <Compass className="w-4 h-4 shrink-0" />
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
