import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { ApplicationArea } from "@prisma/client";

// Type for permissions of a single area
export type AreaPermissions = {
  canAddEdit: boolean;
  canDelete: boolean;
  canClose: boolean;
};

// Type for permissions across all areas (if area is not specified)
export type AllAreaPermissions = Record<ApplicationArea, AreaPermissions>;

// Helper function to generate default permissions
const getDefaultPermissions = (
  area?: ApplicationArea
): AreaPermissions | AllAreaPermissions => {
  if (area) {
    return { canAddEdit: false, canDelete: false, canClose: false };
  } else {
    const allFalsePermissions: Partial<AllAreaPermissions> = {};
    Object.values(ApplicationArea).forEach((key) => {
      allFalsePermissions[key] = {
        canAddEdit: false,
        canDelete: false,
        canClose: false,
      };
    });
    return allFalsePermissions as AllAreaPermissions;
  }
};

// Overload signatures for the hook
export function useProjectPermissions(
  projectId: string | number,
  area: ApplicationArea
): {
  permissions: AreaPermissions | null;
  isLoading: boolean;
  error: Error | null;
};
export function useProjectPermissions(projectId: string | number): {
  permissions: AllAreaPermissions | null;
  isLoading: boolean;
  error: Error | null;
};

/**
 * Custom hook to fetch user permissions for a specific project and optionally a specific application area.
 *
 * @param projectId The ID of the project.
 * @param area Optional. The specific ApplicationArea to fetch permissions for. If omitted, fetches permissions for all areas.
 * @returns An object containing the fetched permissions, loading state, and error state.
 */
export function useProjectPermissions(
  projectId: string | number,
  area?: ApplicationArea
): {
  permissions: AreaPermissions | AllAreaPermissions | null;
  isLoading: boolean;
  error: Error | null;
} {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const numericProjectId =
    typeof projectId === "string" ? parseInt(projectId, 10) : projectId; // Added radix 10

  // Determine if the query should be enabled
  const isEnabled =
    !!userId &&
    !!numericProjectId &&
    !isNaN(numericProjectId) &&
    numericProjectId > 0;

  const queryKey = area
    ? ["userPermissions", numericProjectId, userId, area]
    : ["userPermissions", numericProjectId, userId, "all"];

  const { data, isLoading, error } = useQuery<
    AreaPermissions | AllAreaPermissions,
    Error
  >({
    queryKey: queryKey,
    queryFn: async () => {
      // No need to check isEnabled here, queryFn only runs when enabled
      const body: {
        userId: string;
        projectId: number;
        area?: ApplicationArea;
      } = {
        userId: userId!, // userId is guaranteed to exist here due to isEnabled check
        projectId: numericProjectId,
      };
      if (area) {
        body.area = area;
      }

      const response = await fetch("/api/get-user-permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          "Failed to fetch permissions:",
          response.status,
          errorText
        );
        throw new Error(
          `Failed to fetch permissions: ${response.status} ${errorText}`
        );
      }

      const result = await response.json();
      // The API returns { hasAccess, effectiveRole, permissions }
      // We only need the permissions part
      return result.permissions || result;
    },
    enabled: isEnabled, // Use the pre-calculated enabled flag
    staleTime: 5 * 60 * 1000, // Cache permissions for 5 minutes
    retry: 1, // Retry once on failure
  });

  // If query is disabled, return default permissions immediately
  if (!isEnabled) {
    return {
      permissions: getDefaultPermissions(area),
      isLoading: false,
      error: null,
    };
  }

  // If query is enabled, return the result from useQuery
  // Ensure we return null initially or on error, matching original behavior
  const permissions = data ?? null;

  return { permissions, isLoading, error: error ?? null };
}
