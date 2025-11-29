"use client";

import React, { useCallback, useMemo } from "react";
import type { Prisma } from "@prisma/client";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { PlayCircle, Combine } from "lucide-react";
import { Link } from "~/lib/navigation";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "~/utils";
import { useTranslations } from "next-intl";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";

interface TestRunsListDisplayProps {
  testRunIds?: number[];
  testRuns?: TestRunOption[];
  filter?: Prisma.TestRunsWhereInput;
  count?: number;
  pageSize?: number;
  isLoading?: boolean;
}

type TestRunOption = {
  id: number;
  name: string;
  projectId: number;
  isCompleted: boolean;
  configurationGroupId?: string | null;
  configuration?: { id: number; name: string } | null;
};

const clampClassForLines = (maxLines?: number) => {
  if (!maxLines || maxLines <= 0) return undefined;
  if (maxLines === 1) return "truncate";
  switch (maxLines) {
    case 2:
      return "line-clamp-2";
    case 3:
      return "line-clamp-3";
    case 4:
      return "line-clamp-4";
    case 5:
      return "line-clamp-5";
    case 6:
      return "line-clamp-6";
    default:
      return "line-clamp-6";
  }
};

interface TestRunLinkDisplayProps {
  id: number;
  name: string;
  projectId: number;
  isCompleted: boolean;
  maxLines?: number;
  className?: string;
  configurationGroupId?: string | null;
  configuration?: { id: number; name: string } | null;
}

const TestRunLinkDisplay: React.FC<TestRunLinkDisplayProps> = ({
  id,
  name,
  projectId,
  isCompleted,
  maxLines,
  className,
  configurationGroupId,
  configuration,
}) => {
  const t = useTranslations("common");
  if (!id) return null;

  const clampClass = clampClassForLines(maxLines);
  const textClass = cn(clampClass ?? "truncate", className, "flex-1 text-left");

  const hasClampedClass =
    clampClass === "truncate" ||
    clampClass?.includes("line-clamp") ||
    className?.includes("line-clamp") ||
    className?.includes("truncate");

  const shouldShowTooltip = hasClampedClass;

  const content = (
    <Link
      href={`/projects/runs/${projectId}/${id}`}
      className={cn(
        "flex items-start gap-1 hover:text-primary group max-w-full",
        isCompleted ? "text-muted-foreground/80" : undefined
      )}
    >
      <PlayCircle className="w-4 h-4 shrink-0 mt-0.5" />
      <span className={textClass}>{name}</span>
      {configurationGroupId && (
        <Combine className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground" />
      )}
    </Link>
  );

  if (!shouldShowTooltip) {
    return content;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent>
          <span>{name}</span>
          {configurationGroupId && configuration && (
            <p className="flex text-xs mt-1">
              <Combine className="w-3 h-3 shrink-0 mr-1" />
              {configuration.name}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const DEFAULT_PAGE_SIZE = 10;

export const TestRunsListDisplay: React.FC<TestRunsListDisplayProps> = ({
  testRunIds,
  testRuns,
  filter,
  count,
  pageSize = DEFAULT_PAGE_SIZE,
  isLoading = false,
}) => {
  const t = useTranslations("common");

  const prefetchedRuns = useMemo(() => testRuns ?? [], [testRuns]);

  const computedCount =
    count ??
    (prefetchedRuns.length > 0
      ? prefetchedRuns.length
      : testRunIds
        ? testRunIds.length
        : undefined);

  const baseConditions = useMemo(() => {
    const conditions: Prisma.TestRunsWhereInput[] = [{ isDeleted: false }];

    if (filter) {
      conditions.push(filter);
    } else if (testRunIds && testRunIds.length > 0) {
      conditions.push({ id: { in: testRunIds } });
    } else if (!filter && (!testRunIds || testRunIds.length === 0)) {
      return null;
    }

    return conditions;
  }, [filter, testRunIds]);

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

  const fetchRuns = useCallback(
    async (query: string, page: number, size: number) => {
      const where = buildWhere(query);

      if (!where) {
        if (prefetchedRuns.length === 0) {
          return { results: [], total: 0 };
        }

        const trimmed = query.trim().toLowerCase();
        const filtered = trimmed
          ? prefetchedRuns.filter((run) =>
              run.name.toLowerCase().includes(trimmed)
            )
          : prefetchedRuns;
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
        `/api/model/TestRuns/findMany?q=${encodeURIComponent(JSON.stringify(params))}`
      );

      if (!response.ok) {
        console.error("Failed to load test runs", await response.text());
        return { results: [], total: 0 };
      }

      const payload = await response.json();
      const results = Array.isArray(payload?.data)
        ? (payload.data as TestRunOption[])
        : [];

      let total = computedCount ?? results.length;
      const needsCount = query.trim().length > 0 || computedCount === undefined;

      if (needsCount) {
        const countResponse = await fetch(
          `/api/model/TestRuns/count?q=${encodeURIComponent(JSON.stringify({ where }))}`
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
    [buildWhere, computedCount, prefetchedRuns]
  );

  const handleValueChange = useCallback((_option: TestRunOption | null) => {
    // Navigation handled inside rendered option link
  }, []);

  // Show skeleton while loading and count is undefined
  if (isLoading && computedCount === undefined) {
    return <Skeleton className="h-6 w-12" />;
  }

  if (!baseConditions && prefetchedRuns.length === 0) {
    return null;
  }

  if (computedCount !== undefined && computedCount === 0) {
    return null;
  }

  const triggerLabel =
    computedCount !== undefined && computedCount > 0
      ? computedCount.toLocaleString()
      : "";

  const searchPlaceholder = t("searchRuns", {
    count: computedCount ?? 0,
  });

  return (
    <AsyncCombobox<TestRunOption>
      value={null}
      onValueChange={handleValueChange}
      fetchOptions={fetchRuns}
      renderOption={(option) => (
        <TestRunLinkDisplay
          id={option.id}
          name={option.name}
          projectId={option.projectId}
          isCompleted={option.isCompleted}
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
            <PlayCircle className="w-4 h-4 shrink-0" />
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
