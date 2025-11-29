/**
 * Custom hook for fetching and mapping colors for issue badges
 * Colors are pulled dynamically from the database Color table
 */

import { useMemo } from "react";
import { useFindManyColor } from "~/lib/hooks";

interface ColorFamily {
  id: number;
  name: string;
  colors: Array<{
    id: number;
    value: string;
    order: number;
  }>;
}

export interface IssueBadgeStyle {
  backgroundColor: string;
  color: string;
  borderColor: string;
}

/**
 * Hook to fetch colors from the database and provide mapping functions
 * for issue priorities and statuses
 */
export function useIssueColors() {
  // Fetch all colors with their color families
  const { data: colors, isLoading } = useFindManyColor({
    include: {
      colorFamily: true,
    },
    orderBy: [{ colorFamily: { order: "asc" } }, { order: "asc" }],
  });

  // Organize colors by family name for easy lookup
  const colorsByFamily = useMemo(() => {
    if (!colors) return null;

    const families: Record<string, ColorFamily> = {};

    colors.forEach((color) => {
      const familyName = color.colorFamily.name;
      if (!families[familyName]) {
        families[familyName] = {
          id: color.colorFamily.id,
          name: familyName,
          colors: [],
        };
      }
      families[familyName].colors.push({
        id: color.id,
        value: color.value,
        order: color.order,
      });
    });

    // Sort colors within each family by order
    Object.values(families).forEach((family) => {
      family.colors.sort((a, b) => a.order - b.order);
    });

    return families;
  }, [colors]);

  /**
   * Get a specific color shade from a family
   * @param familyName - Name of the color family (e.g., "Red", "Blue")
   * @param shadeIndex - Index of the shade (0 = darkest, higher = lighter)
   */
  const getColor = (familyName: string, shadeIndex: number): string => {
    if (!colorsByFamily) return "#B1B2B3"; // Default gray fallback

    const family = colorsByFamily[familyName];
    if (!family || !family.colors[shadeIndex]) {
      return "#B1B2B3"; // Default gray fallback
    }

    return family.colors[shadeIndex].value;
  };

  /**
   * Get badge styles for issue priority
   */
  const getPriorityStyle = (
    priority: string | null | undefined
  ): IssueBadgeStyle => {
    if (!colorsByFamily) {
      // Return default while loading
      return {
        backgroundColor: "#C8C9CA",
        color: "#6C6D6E",
        borderColor: "#B1B2B3",
      };
    }

    if (!priority) {
      return {
        backgroundColor: getColor("Black", 5), // Lightest gray
        color: getColor("Black", 1), // Dark gray
        borderColor: getColor("Black", 4), // Medium gray
      };
    }

    const normalizedPriority = priority.toLowerCase().trim();

    switch (normalizedPriority) {
      case "urgent":
      case "highest":
      case "critical":
      case "sanity":
        return {
          backgroundColor: getColor("Red", 6), // Lightest red
          color: getColor("Red", 0), // Darkest red
          borderColor: getColor("Red", 2), // Medium red
        };

      case "high":
        return {
          backgroundColor: getColor("Red", 5), // Lightest orange
          color: getColor("Red", 0), // Darkest orange
          borderColor: getColor("Red", 2), // Medium orange
        };

      case "medium":
        return {
          backgroundColor: getColor("Green", 5), // Lightest green
          color: getColor("Green", 1), // Dark green
          borderColor: getColor("Green", 2), // Medium green
        };

      case "low":
      case "lowest":
        return {
          backgroundColor: getColor("Blue", 5), // Lightest blue
          color: getColor("Blue", 0), // Darkest blue
          borderColor: getColor("Blue", 2), // Medium blue
        };

      default:
        // Unknown priority - use neutral gray
        return {
          backgroundColor: getColor("Black", 5),
          color: getColor("Black", 1),
          borderColor: getColor("Black", 4),
        };
    }
  };

  /**
   * Get badge styles for issue status
   */
  const getStatusStyle = (
    status: string | null | undefined
  ): IssueBadgeStyle => {
    if (!colorsByFamily) {
      // Return default while loading
      return {
        backgroundColor: "#C8C9CA",
        color: "#6C6D6E",
        borderColor: "#B1B2B3",
      };
    }

    if (!status) {
      return {
        backgroundColor: getColor("Black", 5),
        color: getColor("Black", 1),
        borderColor: getColor("Black", 4),
      };
    }

    const normalizedStatus = status
      .toLowerCase()
      .trim()
      .replace(/[_\s]+/g, " ");

    switch (normalizedStatus) {
      case "open":
      case "new":
      case "todo":
      case "to do":
      case "backlog":
        return {
          backgroundColor: getColor("Indigo", 5), // Lightest indigo
          color: getColor("Indigo", 0), // Darkest indigo
          borderColor: getColor("Indigo", 2), // Medium indigo
        };

      case "in progress":
      case "in development":
      case "doing":
      case "working":
      case "active":
        return {
          backgroundColor: getColor("Green", 5), // Lightest green
          color: getColor("Green", 0), // Darkest green
          borderColor: getColor("Green", 2), // Medium green
        };

      case "done":
      case "closed":
      case "resolved":
      case "completed":
      case "fixed":
        return {
          backgroundColor: getColor("Black", 6), // Lightest gray
          color: getColor("Black", 1), // Dark gray
          borderColor: getColor("Black", 4), // Medium gray
        };

      case "blocked":
      case "on hold":
      case "paused":
        return {
          backgroundColor: getColor("Red", 5), // Lightest red
          color: getColor("Red", 0), // Darkest red
          borderColor: getColor("Red", 2), // Medium red
        };

      case "review":
      case "in review":
      case "testing":
      case "qa":
        return {
          backgroundColor: getColor("Yellow", 5), // Lightest yellow
          color: getColor("Yellow", 0), // Darkest yellow
          borderColor: getColor("Yellow", 2), // Medium yellow
        };

      default:
        // Unknown status - use neutral gray
        return {
          backgroundColor: getColor("Black", 5),
          color: getColor("Black", 1),
          borderColor: getColor("Black", 4),
        };
    }
  };

  /**
   * Get just the color value for priority (useful for dots/indicators)
   */
  const getPriorityDotColor = (priority: string | null | undefined): string => {
    if (!colorsByFamily) return "#B1B2B3";
    if (!priority) return getColor("Black", 4);

    const normalizedPriority = priority.toLowerCase().trim();

    switch (normalizedPriority) {
      case "urgent":
      case "highest":
      case "critical":
        return getColor("Red", 2);
      case "high":
        return getColor("Orange", 2);
      case "medium":
        return getColor("Yellow", 2);
      case "low":
      case "lowest":
        return getColor("Green", 2);
      default:
        return getColor("Black", 4);
    }
  };

  /**
   * Get just the color value for status (useful for dots/indicators)
   */
  const getStatusDotColor = (status: string | null | undefined): string => {
    if (!colorsByFamily) return "#B1B2B3";
    if (!status) return getColor("Black", 4);

    const normalizedStatus = status
      .toLowerCase()
      .trim()
      .replace(/[_\s]+/g, " ");

    switch (normalizedStatus) {
      case "open":
      case "new":
      case "todo":
      case "to do":
      case "backlog":
        return getColor("Blue", 2);
      case "in progress":
      case "in development":
      case "doing":
      case "working":
      case "active":
        return getColor("Green", 2);
      case "done":
      case "closed":
      case "resolved":
      case "completed":
      case "fixed":
        return getColor("Black", 5);
      case "blocked":
      case "on hold":
      case "paused":
        return getColor("Red", 2);
      case "review":
      case "in review":
      case "testing":
      case "qa":
        return getColor("Violet", 2);
      default:
        return getColor("Black", 4);
    }
  };

  return {
    isLoading,
    colors: colorsByFamily,
    getPriorityStyle,
    getStatusStyle,
    getPriorityDotColor,
    getStatusDotColor,
    getColor, // Expose for advanced use cases
  };
}

/**
 * Legacy compatibility: Get Badge variant for priority
 * @deprecated Use getPriorityStyle() from useIssueColors() hook instead
 */
export function getIssuePriorityVariant(
  priority: string | null | undefined
): "default" | "secondary" | "destructive" {
  if (!priority) return "secondary";

  const normalizedPriority = priority.toLowerCase().trim();

  if (
    normalizedPriority === "urgent" ||
    normalizedPriority === "highest" ||
    normalizedPriority === "critical" ||
    normalizedPriority === "high"
  ) {
    return "destructive";
  }

  if (normalizedPriority === "low" || normalizedPriority === "lowest") {
    return "secondary";
  }

  return "default"; // medium and unknown
}
