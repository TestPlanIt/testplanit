"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useMemo } from "react";
import {
  buildRequirementMaps,
  countDescendants,
} from "@/projects/requirements/[projectId]/requirementsListRows";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import type { Issue } from "~/zenstack/models";
import { schema } from "~/zenstack/schema";

/**
 * Every requirement in the project, for the surfaces that need tree context
 * WITHOUT the list mounted -- the full-width panel's breadcrumb and the
 * standalone requirement route.
 *
 * The query arguments are byte-identical to `RequirementsListView`'s own
 * project-wide fetch ON PURPOSE: ZenStack derives the React Query key from
 * the arguments, so matching them means these share that one cache entry on
 * the workspace page rather than firing a second request. A narrower
 * `select` would read fewer columns but produce a DIFFERENT key, costing an
 * extra round trip on the page where the rows are already in memory. On the
 * standalone route, where no list is mounted, this is the one query that
 * runs -- and the two hooks below share it with each other for the same
 * reason.
 *
 * `REQUIREMENT_SCOPE_WHERE` is not optional decoration -- an unscoped read
 * of the Issue model is exactly the leak `lib/services/issueRoleScope.ts`
 * exists to close, and the structural containment gate asserts every read
 * site carries it.
 */
function useProjectRequirements(projectId: number | undefined) {
  const enabled = Number.isFinite(projectId);
  return useClientQueries(schema).issue.useFindMany(
    {
      where: {
        projectId: Number(projectId),
        isDeleted: false,
        ...REQUIREMENT_SCOPE_WHERE,
      },
      orderBy: { name: "asc" },
    },
    { enabled }
  );
}

/**
 * The chain of requirements above `requirementId`, outermost first, for the
 * detail panel's breadcrumb.
 *
 * The walk is defensive about cycles: the hierarchy has a database-level
 * cycle guard, but a breadcrumb that could loop forever on bad data would
 * hang the render, so the visited set bounds it regardless.
 */
export function useRequirementAncestors(
  projectId: number | undefined,
  requirementId: number | null | undefined
): { ancestors: Issue[]; isLoading: boolean } {
  const { data, isLoading } = useProjectRequirements(projectId);

  const ancestors = useMemo(() => {
    if (!data || requirementId == null) return [];
    const byId = new Map<number, Issue>();
    for (const row of data as Issue[]) {
      byId.set(row.id, row);
    }
    const chain: Issue[] = [];
    const visited = new Set<number>([requirementId]);
    let current = byId.get(requirementId)?.parentId ?? null;
    while (current != null && !visited.has(current)) {
      visited.add(current);
      const parent = byId.get(current);
      // A parent outside the visible set (filtered by scope, or soft
      // deleted) ends the chain rather than rendering a gap -- the
      // breadcrumb shows the part of the path the viewer may actually see.
      if (!parent) break;
      chain.push(parent);
      current = parent.parentId ?? null;
    }
    return chain.reverse();
  }, [data, requirementId]);

  return { ancestors, isLoading };
}

/**
 * How many requirements sit beneath `requirementId`, which is what
 * `DeleteRequirementModal` needs to say how much a delete takes with it.
 *
 * Inside the workspace that number comes from the list's own in-memory
 * `childrenMap`; the standalone route has no list, so it rebuilds the same
 * map from the same rows using the SAME pure helpers the list uses
 * (`buildRequirementMaps` + `countDescendants`) rather than a second
 * definition of "descendant" that could drift from the one the tree shows.
 *
 * `isLoading` matters here in a way it does not for the breadcrumb: a count
 * that is still 0 because nothing has loaded would tell the user a delete is
 * harmless when it is not, so callers must gate the affordance on it.
 */
export function useRequirementDescendantCount(
  projectId: number | undefined,
  requirementId: number | null | undefined
): { descendantCount: number; isLoading: boolean } {
  const { data, isLoading } = useProjectRequirements(projectId);

  const descendantCount = useMemo(() => {
    if (!data || requirementId == null) return 0;
    const { childrenMap } = buildRequirementMaps(data as Issue[]);
    return countDescendants(childrenMap, requirementId);
  }, [data, requirementId]);

  return { descendantCount, isLoading };
}
