/**
 * Filter-menu option lists that must not shrink as the viewer picks.
 *
 * The reports whose menus carry case counts (automation trends, flaky tests,
 * and the cross-project Projects filter) re-fetch their options whenever a
 * selection changes so the counts stay live, and the menu is rebuilt from the
 * response. The server counts each group with the current selection applied,
 * so rebuilt naively a list shrinks to what the viewer already picked —
 * taking away the options they need to select a second value, and making a
 * multi-select filter behave as single-select. So each list is the union of
 * every option the report has offered, and only the counts come from the
 * newest response.
 */

export interface ProjectFilterOption {
  id: number;
  name: string;
}

export interface CountedProjectFilterOption extends ProjectFilterOption {
  count: number;
}

/**
 * `previous` plus any option in `incoming` it does not already have (matched
 * by `keyOf`), in the order first seen, each stored without its count.
 * Entries `accept` rejects are skipped. Returns `previous` itself when
 * nothing is new, so a caller holding this in state does not re-render on
 * every refetch.
 */
export function mergeSeenOptions<T extends object>(
  previous: T[],
  incoming: unknown,
  keyOf: (option: any) => unknown,
  accept: (option: any) => boolean = (option) => option != null
): T[] {
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return previous;
  }

  const byKey = new Map(previous.map((option) => [keyOf(option), option]));
  let added = false;
  for (const option of incoming) {
    if (!accept(option)) continue;
    const key = keyOf(option);
    if (!byKey.has(key)) {
      const { count: _count, ...rest } = option;
      byKey.set(key, rest as T);
      added = true;
    }
  }

  return added ? Array.from(byKey.values()) : previous;
}

/**
 * The remembered options, each carrying its count from the latest response.
 * An option the current filters exclude stays listed, showing zero.
 */
export function withLatestCounts<T extends object>(
  seen: T[],
  latest: unknown,
  keyOf: (option: any) => unknown
): Array<T & { count: number }> {
  const countByKey = new Map<unknown, number>(
    (Array.isArray(latest) ? latest : []).map((option: any) => [
      keyOf(option),
      typeof option?.count === "number" ? option.count : 0,
    ])
  );

  return seen.map((option) => ({
    ...option,
    count: countByKey.get(keyOf(option)) ?? 0,
  }));
}

const projectId = (project: any) => project?.id;

/** The cross-project Projects filter's remembered options. */
export function mergeSeenProjectOptions(
  previous: ProjectFilterOption[],
  incoming: unknown
): ProjectFilterOption[] {
  const merged = mergeSeenOptions<ProjectFilterOption>(
    previous,
    incoming,
    projectId,
    (project) =>
      Boolean(project) &&
      typeof project.id === "number" &&
      typeof project.name === "string"
  );
  return merged === previous
    ? previous
    : merged.map((project) => ({ id: project.id, name: project.name }));
}

/** The Projects filter's remembered options with their latest counts. */
export function withLatestProjectCounts(
  seen: ProjectFilterOption[],
  latest: unknown
): CountedProjectFilterOption[] {
  return withLatestCounts(seen, latest, projectId);
}
