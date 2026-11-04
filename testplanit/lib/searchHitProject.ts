/**
 * The project a search hit is shown under. Issue documents carry every
 * project the issue is visible in, displayed project first; every other
 * entity carries its one project.
 */
export function searchHitProjectId(
  source: { projectId?: number | number[] | null } | null | undefined
): number | undefined {
  const projectId = Array.isArray(source?.projectId)
    ? source.projectId[0]
    : source?.projectId;
  return typeof projectId === "number" ? projectId : undefined;
}
