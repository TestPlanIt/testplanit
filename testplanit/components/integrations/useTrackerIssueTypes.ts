"use client";

import { useQuery } from "@tanstack/react-query";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useCallback } from "react";
import { schema } from "~/zenstack/schema";

export interface TrackerIssueType {
  id: string;
  name: string;
}

export interface TrackerProjectMapping {
  id: string;
  externalProjectId: string;
  externalProjectKey: string;
  externalProjectName: string | null;
}

type TrackerIntegration = { id: number; provider: string } | null | undefined;

/**
 * Providers whose adapter implements `getIssueTypes` (verified by reading
 * lib/integrations/adapters/*Adapter.ts). Adapters run server-side only
 * (credentialed API clients), so this small client-safe set mirrors a
 * static, provider-determined fact rather than round-tripping to the
 * server just to learn it.
 *
 * GITHUB and GITEA are the LABEL-MODE members: their `getIssueTypes`
 * serves repository labels (neither tracker models issue types).
 */
const ISSUE_TYPE_CAPABLE_PROVIDERS = new Set([
  "JIRA",
  "AZURE_DEVOPS",
  "GITLAB",
  "REDMINE",
  "MANTISBT",
  "GITHUB",
  "GITEA",
  "CLICKUP",
]);

/** Providers whose designation vocabulary is labels, not issue types. Also
 *  the providers whose mappings key `getIssueTypes` on the full
 *  "owner/repo" ref (`externalProjectId`) rather than the short key. */
export const LABEL_MODE_PROVIDERS = new Set(["GITHUB", "GITEA"]);

export function isIssueTypeCapable(provider: string): boolean {
  return ISSUE_TYPE_CAPABLE_PROVIDERS.has(provider);
}

/** The tracker projects a TestPlanIt project maps for an integration. */
function useTrackerProjectMappings(
  projectId: number,
  integration: TrackerIntegration,
  enabled: boolean
) {
  return useClientQueries(schema).integrationProject.useFindMany(
    {
      where: {
        projectIntegration: {
          integrationId: integration?.id ?? -1,
          projectId,
        },
        isActive: true,
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        externalProjectId: true,
        externalProjectKey: true,
        externalProjectName: true,
      },
    },
    { enabled }
  ) as { data: TrackerProjectMapping[] | undefined; isLoading: boolean };
}

/** The ref a tracker's per-project endpoints key on for a mapping. */
function projectRefFor(provider: string, mapping: TrackerProjectMapping) {
  // Label-mode trackers key on the full "owner/repo" ref, which mappings
  // carry as externalProjectId.
  return LABEL_MODE_PROVIDERS.has(provider)
    ? mapping.externalProjectId
    : mapping.externalProjectKey;
}

/**
 * A project's tracker issue types across every external project it maps,
 * paged and searched for a MultiAsyncCombobox. Shared by the requirement
 * type settings and the webhook action filters.
 */
export function useTrackerIssueTypes(
  projectId: number,
  integration: TrackerIntegration
) {
  const capable = Boolean(
    integration && isIssueTypeCapable(integration.provider)
  );
  const { data: mappings } = useTrackerProjectMappings(
    projectId,
    integration,
    capable
  );

  const fetchIssueTypes = useCallback(
    async (query: string, page: number, pageSize: number) => {
      if (!integration) return { results: [], total: 0 };
      const byId = new Map<string, TrackerIssueType>();
      await Promise.all(
        (mappings ?? []).map(async (mapping) => {
          try {
            const projectRef = projectRefFor(integration.provider, mapping);
            const response = await fetch(
              `/api/integrations/${integration.id}/issue-types?projectKey=${encodeURIComponent(projectRef)}`
            );
            if (response.ok) {
              const data = await response.json();
              const issueTypes: TrackerIssueType[] = data.issueTypes || [];
              for (const issueType of issueTypes) {
                if (!byId.has(issueType.id)) {
                  byId.set(issueType.id, issueType);
                }
              }
            }
          } catch (error) {
            console.error("Failed to fetch issue types:", error);
          }
        })
      );
      const all = Array.from(byId.values());
      const filtered = query
        ? all.filter((issueType) =>
            issueType.name.toLowerCase().includes(query.toLowerCase())
          )
        : all;
      const start = page * pageSize;
      return {
        results: filtered.slice(start, start + pageSize),
        total: filtered.length,
      };
    },
    [mappings, integration]
  );

  return {
    capable,
    labelMode: Boolean(
      integration && LABEL_MODE_PROVIDERS.has(integration.provider)
    ),
    mappings,
    fetchIssueTypes,
  };
}

/**
 * The statuses a project's tracker uses, from the statuses route: one call
 * per mapped tracker project (or one without a project when none is
 * mapped), merged by name. Empty for a tracker that can't list statuses.
 */
export function useTrackerStatuses(
  projectId: number,
  integration: TrackerIntegration
) {
  const { data: mappings, isLoading: mappingsLoading } =
    useTrackerProjectMappings(projectId, integration, Boolean(integration));
  return useQuery({
    queryKey: [
      "tracker-statuses",
      integration?.id ?? null,
      (mappings ?? []).map((mapping) => mapping.id),
    ],
    enabled: Boolean(integration) && !mappingsLoading,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string[]> => {
      if (!integration) return [];
      const refs =
        mappings && mappings.length > 0
          ? mappings.map((mapping) =>
              projectRefFor(integration.provider, mapping)
            )
          : [undefined];
      // Fetched together, merged in mapping order so the list is stable.
      const lists = await Promise.all(
        refs.map(async (ref): Promise<{ name: string }[]> => {
          try {
            const query = ref ? `?projectKey=${encodeURIComponent(ref)}` : "";
            const response = await fetch(
              `/api/integrations/${integration.id}/statuses${query}`
            );
            if (!response.ok) return [];
            const data = await response.json();
            return (data.statuses ?? []) as { name: string }[];
          } catch (error) {
            console.error("Failed to fetch statuses:", error);
            return [];
          }
        })
      );
      const byName = new Map<string, string>();
      for (const status of lists.flat()) {
        if (status?.name && !byName.has(status.name.toLowerCase())) {
          byName.set(status.name.toLowerCase(), status.name);
        }
      }
      return [...byName.values()];
    },
  });
}
