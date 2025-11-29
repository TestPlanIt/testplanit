"use client";

import React, { useCallback, useMemo } from "react";
import type { Prisma } from "@prisma/client";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { BoxesIcon } from "lucide-react";
import { Link } from "~/lib/navigation";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "~/utils";
import { useTranslations } from "next-intl";
import { ProjectIcon } from "../ProjectIcon";
import { Skeleton } from "@/components/ui/skeleton";

interface ProjectListProps {
  projects?: Array<{ projectId: number } | ProjectLike>;
  filter?: Prisma.ProjectsWhereInput;
  count?: number;
  usePopover?: boolean;
  pageSize?: number;
  isLoading?: boolean;
}

type ProjectLike = {
  id: number;
  name?: string | null;
  iconUrl?: string | null;
};

type ProjectOption = {
  id: number;
  name: string;
  iconUrl: string | null;
};

const DEFAULT_PAGE_SIZE = 10;

export const ProjectListDisplay: React.FC<ProjectListProps> = ({
  projects = [],
  filter,
  count,
  usePopover = true,
  pageSize = DEFAULT_PAGE_SIZE,
  isLoading = false,
}) => {
  const t = useTranslations("common");

  const { projectIds, prefetchedProjects } = useMemo(() => {
    const ids = new Set<number>();
    const prefetchedMap = new Map<number, ProjectOption>();

    projects.forEach((project) => {
      if ("projectId" in project) {
        ids.add(project.projectId);
      } else if ("id" in project && typeof project.id === "number") {
        ids.add(project.id);
        prefetchedMap.set(project.id, {
          id: project.id,
          name: project.name ?? `Project ${project.id}`,
          iconUrl: project.iconUrl ?? null,
        });
      }
    });

    return {
      projectIds: Array.from(ids),
      prefetchedProjects: Array.from(prefetchedMap.values()),
    };
  }, [projects]);

  const computedCount =
    count ??
    (prefetchedProjects.length > 0
      ? prefetchedProjects.length
      : projectIds.length > 0
        ? projectIds.length
        : undefined);

  const baseConditions = useMemo(() => {
    const conditions: Prisma.ProjectsWhereInput[] = [{ isDeleted: false }];

    if (filter) {
      conditions.push(filter);
      return conditions;
    }

    if (projectIds.length === 0) {
      return null;
    }

    if (prefetchedProjects.length >= projectIds.length) {
      return null;
    }

    conditions.push({ id: { in: projectIds } });
    return conditions;
  }, [filter, projectIds, prefetchedProjects]);

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

  const fetchProjects = useCallback(
    async (query: string, page: number, size: number) => {
      const where = buildWhere(query);

      if (!where) {
        if (prefetchedProjects.length === 0) {
          return { results: [], total: 0 };
        }

        const trimmed = query.trim().toLowerCase();
        const filtered = trimmed
          ? prefetchedProjects.filter((project) =>
              project.name.toLowerCase().includes(trimmed)
            )
          : prefetchedProjects;
        const start = page * size;
        const paginated = filtered.slice(start, start + size);
        return { results: paginated, total: filtered.length };
      }

      const params = {
        where,
        orderBy: { name: "asc" } as const,
        skip: page * size,
        take: size,
        select: {
          id: true,
          name: true,
          iconUrl: true,
        },
      };

      const response = await fetch(
        `/api/model/Projects/findMany?q=${encodeURIComponent(JSON.stringify(params))}`
      );

      if (!response.ok) {
        console.error("Failed to load projects", await response.text());
        return { results: [], total: 0 };
      }

      const payload = await response.json();
      const results = Array.isArray(payload?.data)
        ? (payload.data as ProjectOption[])
        : [];

      let total = computedCount ?? results.length;
      const needsCount = query.trim().length > 0 || computedCount === undefined;

      if (needsCount) {
        const countResponse = await fetch(
          `/api/model/Projects/count?q=${encodeURIComponent(JSON.stringify({ where }))}`
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
    [buildWhere, computedCount, prefetchedProjects]
  );

  const handleValueChange = useCallback((_option: ProjectOption | null) => {
    // Navigation handled inside rendered option link
  }, []);

  // Show skeleton while loading and count is undefined
  if (isLoading && computedCount === undefined) {
    return <Skeleton className="h-6 w-12" />;
  }

  if (!baseConditions && prefetchedProjects.length === 0) {
    return null;
  }

  if (computedCount !== undefined && computedCount === 0) {
    return null;
  }

  const triggerLabel =
    computedCount !== undefined && computedCount > 0
      ? computedCount.toLocaleString()
      : "";

  const searchPlaceholder = t("searchProjects", {
    count: computedCount ?? 0,
  });

  if (!usePopover) {
    if (prefetchedProjects.length === 0) {
      return null;
    }

    return (
      <div className="flex flex-wrap gap-2">
        {prefetchedProjects.map((project) => (
          <Link
            key={project.id}
            href={`/projects/overview/${project.id}`}
            className={cn(
              badgeVariants({ variant: "default" }),
              "items-center px-3"
            )}
          >
            <div className="max-w-5 max-h-5 shrink-0">
              <ProjectIcon iconUrl={project.iconUrl} />
            </div>
            <span>{project.name}</span>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <AsyncCombobox<ProjectOption>
      value={null}
      onValueChange={handleValueChange}
      fetchOptions={fetchProjects}
      renderOption={(option) => (
        <Link
          href={`/projects/overview/${option.id}`}
          className="flex items-center gap-1"
        >
          <div className="max-w-5 max-h-5">
            <ProjectIcon iconUrl={option.iconUrl} height={20} width={20} />
          </div>
          <span className="truncate">{option.name}</span>
        </Link>
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
            <BoxesIcon className="w-4 h-4" />
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
