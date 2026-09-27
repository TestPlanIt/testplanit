import { useQuery } from "@tanstack/react-query";
import type { ProjectAccessRosterEntry } from "~/lib/services/projectAccessRoster";

export type { ProjectAccessRosterEntry };

/**
 * Every user who can open a project, with their effective role, from
 * `GET /api/projects/[projectId]/access`. The route answers 403 for
 * callers without project-admin authority; the page gates on that before
 * enabling the query, so a 403 here surfaces as an error rather than a
 * redirect.
 */
export function useProjectAccessRoster(
  projectId: number,
  options: { enabled?: boolean } = {}
) {
  return useQuery<ProjectAccessRosterEntry[], Error>({
    queryKey: ["projectAccessRoster", projectId],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/access`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to load project access");
      }
      const body = (await response.json()) as {
        users: ProjectAccessRosterEntry[];
      };
      return body.users;
    },
    enabled:
      (options.enabled ?? true) && Number.isInteger(projectId) && projectId > 0,
    staleTime: 30_000,
  });
}
