/**
 * Custom hook for fetching and mapping colors for issue badges
 * Colors are pulled dynamically from the database Color table
 */

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useMemo, type CSSProperties } from "react";
import {
  contrastRatio,
  contrastingTextColor,
  statusSurfaceVars,
} from "~/utils/contrastingTextColor";

interface ColorFamily {
  id: number;
  name: string;
  colors: Array<{
    id: number;
    value: string;
    order: number;
  }>;
}

export interface IssueBadgeStyle extends CSSProperties {
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
  const { data: colors, isLoading } = useClientQueries(
    schema
  ).color.useFindMany({
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
   * Badge style for a shade pair. A family's darkest shade is the intended
   * ink, but it does not always reach the 4.5:1 that the badge's 12px
   * semibold text needs: the seeded Red is 3.92:1 (#8D2007 on #F88F77) on its
   * own lightest tint and worse on every darker one, and a family that is
   * missing or renamed collapses fill and ink onto the same #B1B2B3 fallback,
   * which is 1:1. Shades are admin-owned, so the pair is measured rather than
   * assumed and a failing one falls back to the black/white pick, never below
   * 4.58:1. A value the parser cannot read is left alone rather than
   * overridden on a guess.
   *
   * data-status-surface on the badge plus this --status-surface-fg is the
   * contract StatusDisplay uses: the accessible themes take the strict pick,
   * the brand themes keep the ink chosen here (styles/globals.css).
   */
  const badgeStyle = (
    backgroundColor: string,
    familyInk: string,
    borderColor: string
  ): IssueBadgeStyle => {
    const ratio = contrastRatio(familyInk, backgroundColor);
    return {
      ...statusSurfaceVars(backgroundColor),
      backgroundColor,
      color:
        ratio === null || ratio >= 4.5
          ? familyInk
          : contrastingTextColor(backgroundColor),
      borderColor,
    };
  };

  /**
   * Get badge styles for issue priority
   */
  const getPriorityStyle = (
    priority: string | null | undefined
  ): IssueBadgeStyle => {
    if (!colorsByFamily) {
      // Loading: the seeded Black 5/0/4 chip, so the placeholder matches the
      // neutral badge that replaces it. Black[1] was 3.13:1 on Black[5].
      return badgeStyle("#C8C9CA", "#333435", "#B1B2B3");
    }

    if (!priority) {
      return badgeStyle(
        getColor("Black", 5), // Lightest gray
        getColor("Black", 0), // Darkest gray — 7.52:1; Black[1] is 3.13:1
        getColor("Black", 4) // Medium gray
      );
    }

    const normalizedPriority = priority.toLowerCase().trim();

    switch (normalizedPriority) {
      case "urgent":
      case "highest":
      case "critical":
      case "sanity":
        // Red against High's orange, the severity ramp the branch below and
        // the dot colours already describe. 5 is the lightest shade there is:
        // db/seed.ts seeds six per family, orders 0-5.
        return badgeStyle(
          getColor("Red", 5), // Lightest red
          getColor("Red", 0), // Darkest red — 3.92:1, so badgeStyle inks black
          getColor("Red", 2) // Medium red
        );

      case "high":
        return badgeStyle(
          getColor("Orange", 5), // Lightest orange
          getColor("Orange", 0), // Darkest orange — 5.09:1
          getColor("Orange", 2) // Medium orange
        );

      case "medium":
        return badgeStyle(
          getColor("Green", 5), // Lightest green
          getColor("Green", 0), // Darkest green — 6.09:1; Green[1] is 3.97:1
          getColor("Green", 2) // Medium green
        );

      case "low":
      case "lowest":
        return badgeStyle(
          getColor("Blue", 5), // Lightest blue
          getColor("Blue", 0), // Darkest blue — 5.55:1
          getColor("Blue", 2) // Medium blue
        );

      default:
        // Unknown priority - use neutral gray
        return badgeStyle(
          getColor("Black", 5),
          getColor("Black", 0),
          getColor("Black", 4)
        );
    }
  };

  /**
   * Get badge styles for issue status
   */
  const getStatusStyle = (
    status: string | null | undefined
  ): IssueBadgeStyle => {
    if (!colorsByFamily) {
      // Loading: the seeded Black 5/0/4 chip, so the placeholder matches the
      // neutral badge that replaces it. Black[1] was 3.13:1 on Black[5].
      return badgeStyle("#C8C9CA", "#333435", "#B1B2B3");
    }

    if (!status) {
      return badgeStyle(
        getColor("Black", 5),
        getColor("Black", 0),
        getColor("Black", 4)
      );
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
        return badgeStyle(
          getColor("Indigo", 5), // Lightest indigo
          getColor("Indigo", 0), // Darkest indigo — 5.18:1
          getColor("Indigo", 2) // Medium indigo
        );

      case "in progress":
      case "in development":
      case "doing":
      case "working":
      case "active":
        return badgeStyle(
          getColor("Green", 5), // Lightest green
          getColor("Green", 0), // Darkest green — 6.09:1
          getColor("Green", 2) // Medium green
        );

      case "done":
      case "closed":
      case "resolved":
      case "completed":
      case "fixed":
        // 5 is the lightest shade there is: db/seed.ts seeds six per family,
        // orders 0-5. The border is a step darker than the unrecognised chip
        // below, so a closed issue is not identical to it.
        return badgeStyle(
          getColor("Black", 5), // Lightest gray
          getColor("Black", 0), // Darkest gray — 7.52:1; Black[1] is 3.13:1
          getColor("Black", 3) // Mid gray
        );

      case "blocked":
      case "on hold":
      case "paused":
        return badgeStyle(
          getColor("Red", 5), // Lightest red
          getColor("Red", 0), // Darkest red — 3.92:1, so badgeStyle inks black
          getColor("Red", 2) // Medium red
        );

      case "review":
      case "in review":
      case "testing":
      case "qa":
        return badgeStyle(
          getColor("Yellow", 5), // Lightest yellow
          getColor("Yellow", 0), // Darkest yellow — 5.89:1
          getColor("Yellow", 2) // Medium yellow
        );

      default:
        // Unknown status - use neutral gray
        return badgeStyle(
          getColor("Black", 5),
          getColor("Black", 0),
          getColor("Black", 4)
        );
    }
  };

  /**
   * Get just the color value for priority (useful for dots/indicators and charts)
   * Colors match getPriorityStyle for visual consistency
   */
  const getPriorityDotColor = (priority: string | null | undefined): string => {
    if (!colorsByFamily) return "#B1B2B3";
    if (!priority) return getColor("Black", 4);

    const normalizedPriority = priority.toLowerCase().trim();

    switch (normalizedPriority) {
      case "urgent":
      case "highest":
      case "critical":
      case "sanity":
        // Red - matches getPriorityStyle
        return getColor("Red", 2);
      case "high":
        // Orange - matches getPriorityStyle
        return getColor("Orange", 2);
      case "medium":
        // Green - matches getPriorityStyle
        return getColor("Green", 2);
      case "low":
      case "lowest":
        // Blue - matches getPriorityStyle
        return getColor("Blue", 2);
      default:
        return getColor("Black", 4);
    }
  };

  /**
   * Get just the color value for status (useful for dots/indicators and charts)
   * Colors match getStatusStyle for visual consistency
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
        // Indigo - matches getStatusStyle
        return getColor("Indigo", 2);
      case "in progress":
      case "in development":
      case "doing":
      case "working":
      case "active":
        // Green - matches getStatusStyle
        return getColor("Green", 2);
      case "done":
      case "closed":
      case "resolved":
      case "completed":
      case "fixed":
        // Gray - matches getStatusStyle
        return getColor("Black", 4);
      case "blocked":
      case "on hold":
      case "paused":
        // Red - matches getStatusStyle
        return getColor("Red", 2);
      case "review":
      case "in review":
      case "testing":
      case "qa":
        // Yellow - matches getStatusStyle
        return getColor("Yellow", 2);
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
