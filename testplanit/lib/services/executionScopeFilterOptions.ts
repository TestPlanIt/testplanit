import { baseDb } from "~/lib/db";

/**
 * The milestone and configuration options for a project's execution-scope
 * filter (see `executionScopeParam.ts`). Project-scoped only: a milestone
 * belongs to one project, so a cross-project picker would be a grab-bag of
 * same-named rows from different projects.
 *
 * Completed milestones stay listed on purpose — "results on the shipped
 * release" is the milestone axis's whole point. Configurations follow the
 * run-creation picker's enabled+assigned convention.
 */
export async function getExecutionScopeFilterOptions(projectId: number) {
  const [milestones, configurations] = await Promise.all([
    baseDb.milestones.findMany({
      where: { projectId, isDeleted: false },
      // Everything the shared MilestoneOptionContent renders — the type
      // icon, the tree position, and the tracker-source badge fields — so a
      // report's filter menu can show milestones the way every other picker
      // does.
      select: {
        id: true,
        name: true,
        parentId: true,
        integrationId: true,
        externalKind: true,
        externalState: true,
        externalUrl: true,
        detachedAt: true,
        mergedToExternalId: true,
        milestoneType: { select: { icon: { select: { name: true } } } },
      },
      orderBy: { name: "asc" },
    }),
    baseDb.configurations.findMany({
      where: {
        isDeleted: false,
        isEnabled: true,
        projects: { some: { projectId } },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { milestones, configurations };
}
