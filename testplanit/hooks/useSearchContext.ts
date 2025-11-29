"use client";

import { useParams } from "next/navigation";
import { usePathname } from "~/lib/navigation";
import { useSession } from "next-auth/react";
import { useMemo } from "react";
import {
  SearchableEntityType,
  SearchContext,
  UnifiedSearchFilters,
} from "~/types/search";

/**
 * Hook to determine search context based on current route
 * Provides smart defaults for search filters based on the current page
 */
export function useSearchContext(): SearchContext {
  const pathname = usePathname();
  const params = useParams();
  const { data: session } = useSession();

  return useMemo(() => {
    // Remove locale prefix from pathname for easier matching
    // The locale is always in the format /xx or /xx-XX (e.g., /en or /en-US)
    const pathWithoutLocale = pathname.replace(
      /^\/[a-z]{2}(-[A-Z]{2})?\//,
      "/"
    );

    // Extract projectId from params
    const projectId = params.projectId ? Number(params.projectId) : null;

    // Global search from header
    if (!pathWithoutLocale.startsWith("/projects/")) {
      return {
        currentEntity: null,
        projectId: null,
        defaultFilters: {},
        availableEntities: getAllAvailableEntities(session),
        isGlobalSearch: true,
      };
    }

    // Repository cases page
    if (pathWithoutLocale.includes("/repository/")) {
      return {
        currentEntity: SearchableEntityType.REPOSITORY_CASE,
        projectId,
        defaultFilters: {
          entityTypes: [SearchableEntityType.REPOSITORY_CASE],
          repositoryCase: projectId ? { projectIds: [projectId] } : {},
        },
        availableEntities: getAllAvailableEntities(session),
        isGlobalSearch: false,
      };
    }

    // Shared steps page
    if (pathWithoutLocale.includes("/shared-steps/")) {
      return {
        currentEntity: SearchableEntityType.SHARED_STEP,
        projectId,
        defaultFilters: {
          entityTypes: [SearchableEntityType.SHARED_STEP],
          sharedStep: projectId
            ? { projectIds: [projectId] }
            : { projectIds: [] },
        },
        availableEntities: getAllAvailableEntities(session),
        isGlobalSearch: false,
      };
    }

    // Test runs page
    if (pathWithoutLocale.includes("/runs/")) {
      return {
        currentEntity: SearchableEntityType.TEST_RUN,
        projectId,
        defaultFilters: {
          entityTypes: [SearchableEntityType.TEST_RUN],
          testRun: projectId ? { projectIds: [projectId] } : {},
        },
        availableEntities: getAllAvailableEntities(session),
        isGlobalSearch: false,
      };
    }

    // Sessions page
    if (pathWithoutLocale.includes("/sessions/")) {
      return {
        currentEntity: SearchableEntityType.SESSION,
        projectId,
        defaultFilters: {
          entityTypes: [SearchableEntityType.SESSION],
          session: projectId ? { projectIds: [projectId] } : {},
        },
        availableEntities: getAllAvailableEntities(session),
        isGlobalSearch: false,
      };
    }

    // Issues page
    if (pathWithoutLocale.includes("/issues/")) {
      return {
        currentEntity: SearchableEntityType.ISSUE,
        projectId,
        defaultFilters: {
          entityTypes: [SearchableEntityType.ISSUE],
          issue: projectId ? { projectIds: [projectId] } : {},
        },
        availableEntities: getAllAvailableEntities(session),
        isGlobalSearch: false,
      };
    }

    // Milestones page
    if (pathWithoutLocale.includes("/milestones/")) {
      return {
        currentEntity: SearchableEntityType.MILESTONE,
        projectId,
        defaultFilters: {
          entityTypes: [SearchableEntityType.MILESTONE],
          milestone: projectId ? { projectIds: [projectId] } : {},
        },
        availableEntities: getAllAvailableEntities(session),
        isGlobalSearch: false,
      };
    }

    // Projects listing page
    if (
      pathWithoutLocale === "/projects" ||
      pathWithoutLocale === "/projects/"
    ) {
      return {
        currentEntity: SearchableEntityType.PROJECT,
        projectId: null,
        defaultFilters: {
          entityTypes: [SearchableEntityType.PROJECT],
        },
        availableEntities: [SearchableEntityType.PROJECT],
        isGlobalSearch: false,
      };
    }

    // Project overview page or any other project page
    if (pathWithoutLocale.includes("/projects/") && projectId) {
      return {
        currentEntity: null,
        projectId,
        defaultFilters: {
          // Default to searching all entities within the project
          repositoryCase: { projectIds: [projectId] },
          testRun: { projectIds: [projectId] },
          session: { projectIds: [projectId] },
          sharedStep: { projectIds: [projectId] },
          issue: { projectIds: [projectId] },
          milestone: { projectIds: [projectId] },
        },
        availableEntities: getAllAvailableEntities(session),
        isGlobalSearch: false,
      };
    }

    // Default context
    return {
      currentEntity: null,
      projectId: null,
      defaultFilters: {},
      availableEntities: getAllAvailableEntities(session),
      isGlobalSearch: true,
    };
  }, [pathname, params, session]);
}

/**
 * Get all available entity types based on user permissions
 */
function getAllAvailableEntities(session: any): SearchableEntityType[] {
  if (!session?.user) {
    return [];
  }

  const entities: SearchableEntityType[] = [];

  // Everyone with access can search projects
  if (session.user.access !== "NONE") {
    entities.push(SearchableEntityType.PROJECT);
  }

  // Add other entities based on permissions
  // For now, we'll allow access to all entities if user has any access
  // This can be refined based on specific role permissions
  if (session.user.access !== "NONE") {
    entities.push(
      SearchableEntityType.REPOSITORY_CASE,
      SearchableEntityType.SHARED_STEP,
      SearchableEntityType.TEST_RUN,
      SearchableEntityType.SESSION,
      SearchableEntityType.ISSUE,
      SearchableEntityType.MILESTONE
    );
  }

  return entities;
}

/**
 * Hook to get search scope options for the current context
 */
export function useSearchScope() {
  const context = useSearchContext();

  return useMemo(() => {
    const scopes = [];

    // Add current entity scope if applicable
    if (context.currentEntity && context.projectId) {
      scopes.push({
        label: `Current ${getEntityLabel(context.currentEntity)}`,
        value: "current",
        entityTypes: [context.currentEntity],
        projectId: context.projectId,
      });
    }

    // Add project scope if in a project
    if (context.projectId) {
      scopes.push({
        label: "Current Project",
        value: "project",
        entityTypes: context.availableEntities,
        projectId: context.projectId,
      });
    }

    // Add all projects scope
    scopes.push({
      label: "All Projects",
      value: "all",
      entityTypes: context.availableEntities,
      projectId: null,
    });

    return scopes;
  }, [context]);
}

/**
 * Get human-readable label for entity type
 */
export function getEntityLabel(entityType: SearchableEntityType): string {
  const labels: Record<SearchableEntityType, string> = {
    [SearchableEntityType.REPOSITORY_CASE]: "Repository Cases",
    [SearchableEntityType.SHARED_STEP]: "Shared Steps",
    [SearchableEntityType.TEST_RUN]: "Test Runs",
    [SearchableEntityType.SESSION]: "Sessions",
    [SearchableEntityType.PROJECT]: "Projects",
    [SearchableEntityType.ISSUE]: "Issues",
    [SearchableEntityType.MILESTONE]: "Milestones",
  };

  return labels[entityType] || entityType;
}

/**
 * Get icon name for entity type
 */
export function getEntityIcon(entityType: SearchableEntityType): string {
  const icons: Record<SearchableEntityType, string> = {
    [SearchableEntityType.REPOSITORY_CASE]: "list-checks",
    [SearchableEntityType.SHARED_STEP]: "layers",
    [SearchableEntityType.TEST_RUN]: "play-circle",
    [SearchableEntityType.SESSION]: "compass",
    [SearchableEntityType.PROJECT]: "boxes",
    [SearchableEntityType.ISSUE]: "bug",
    [SearchableEntityType.MILESTONE]: "milestone",
  };

  return icons[entityType] || "file";
}
