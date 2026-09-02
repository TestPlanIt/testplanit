/**
 * The Projects filter's option list on the cross-project reports.
 *
 * Those reports re-fetch their filter options whenever a selection changes so
 * the per-option counts stay live, and the menu is rebuilt from the response.
 * Rebuilt naively, the list can shrink as the viewer picks — taking away the
 * options they need to select a second project, and making the filter look
 * single-select. So the list is the union of every project the report has
 * offered, and only the counts come from the newest response.
 */

export interface ProjectFilterOption {
  id: number;
  name: string;
}

export interface CountedProjectFilterOption extends ProjectFilterOption {
  count: number;
}

/**
 * `previous` plus any project in `incoming` it does not already have, in the
 * order first seen. Returns `previous` itself when nothing is new, so a caller
 * holding this in state does not re-render on every refetch.
 */
export function mergeSeenProjectOptions(
  previous: ProjectFilterOption[],
  incoming: unknown
): ProjectFilterOption[] {
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return previous;
  }

  const byId = new Map(previous.map((project) => [project.id, project]));
  let added = false;
  for (const project of incoming) {
    if (
      !project ||
      typeof project.id !== "number" ||
      typeof project.name !== "string"
    ) {
      continue;
    }
    if (!byId.has(project.id)) {
      byId.set(project.id, { id: project.id, name: project.name });
      added = true;
    }
  }

  return added ? Array.from(byId.values()) : previous;
}

/**
 * The remembered options, each carrying its count from the latest response.
 * A project the current filters exclude stays listed, showing zero.
 */
export function withLatestProjectCounts(
  seen: ProjectFilterOption[],
  latest: unknown
): CountedProjectFilterOption[] {
  const countById = new Map<number, number>(
    (Array.isArray(latest) ? latest : []).map((project: any) => [
      project?.id,
      typeof project?.count === "number" ? project.count : 0,
    ])
  );

  return seen.map((project) => ({
    ...project,
    count: countById.get(project.id) ?? 0,
  }));
}
