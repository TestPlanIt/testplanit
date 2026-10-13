import {
  AlertCircle,
  BookOpen,
  Bug,
  CheckCircle2,
  Lightbulb,
  ListTodo,
  Rocket,
  Target,
  Zap,
  type LucideIcon,
} from "lucide-react";
import React from "react";

/**
 * Maps Jira issue type names to Lucide React icons
 * Falls back to Bug icon if no match is found
 */
export function getIssueTypeIcon(
  issueTypeName?: string | null,
  iconUrl?: string | null,
  /** The glyph for "nothing better is known" — Bug suits the defect
   * surfaces this map grew up on; requirement surfaces pass
   * ClipboardCheck so a native requirement never reads as a bug. */
  fallbackIcon: LucideIcon = Bug
): {
  icon: LucideIcon;
  iconUrl?: string;
} {
  // If we have an icon URL from Jira, return it along with a default icon
  if (iconUrl) {
    return { icon: fallbackIcon, iconUrl };
  }

  // If no issue type name, return the fallback icon
  if (!issueTypeName) {
    return { icon: fallbackIcon };
  }

  // Normalize the issue type name for comparison
  const normalizedType = issueTypeName.toLowerCase().trim();

  // Map common Jira issue types to icons
  if (normalizedType.includes("bug") || normalizedType.includes("defect")) {
    return { icon: Bug };
  }

  if (normalizedType.includes("task")) {
    return { icon: ListTodo };
  }

  if (
    normalizedType.includes("story") ||
    normalizedType.includes("user story")
  ) {
    return { icon: BookOpen };
  }

  if (normalizedType.includes("epic")) {
    return { icon: Target };
  }

  if (
    normalizedType.includes("improvement") ||
    normalizedType.includes("enhancement")
  ) {
    return { icon: Lightbulb };
  }

  if (normalizedType.includes("spike") || normalizedType.includes("research")) {
    return { icon: Zap };
  }

  if (
    normalizedType.includes("incident") ||
    normalizedType.includes("problem")
  ) {
    return { icon: AlertCircle };
  }

  if (normalizedType.includes("feature")) {
    return { icon: Rocket };
  }

  if (normalizedType.includes("done") || normalizedType.includes("complete")) {
    return { icon: CheckCircle2 };
  }

  if (normalizedType.includes("request")) {
    return { icon: ListTodo };
  }

  if (normalizedType === "issue") {
    return { icon: ListTodo };
  }

  // Unrecognized type name — the caller's fallback
  return { icon: fallbackIcon };
}

/**
 * Component that renders either a Jira icon URL or a Lucide icon
 */
export function IssueTypeIcon({
  issueTypeName,
  iconUrl,
  className = "h-4 w-4",
  fallbackIcon,
}: {
  issueTypeName?: string | null;
  iconUrl?: string | null;
  className?: string;
  /** See getIssueTypeIcon — requirement surfaces pass ClipboardCheck. */
  fallbackIcon?: LucideIcon;
}) {
  const [imageError, setImageError] = React.useState(false);
  const { icon: Icon } = getIssueTypeIcon(issueTypeName, iconUrl, fallbackIcon);

  // Reset error state when iconUrl changes
  React.useEffect(() => {
    setImageError(false);
  }, [iconUrl]);

  // If we have a Jira icon URL and it hasn't failed to load, try to render it
  // NOTE: Jira icon URLs typically require authentication and will fail to load
  // due to CORS/authentication issues. We'll gracefully fall back to Lucide icons.
  if (iconUrl && !imageError) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={iconUrl}
        alt={`${issueTypeName || "Issue"} icon`}
        className={className}
        onError={() => {
          // If image fails to load (CORS, auth, 404, etc.), fall back to Lucide icon
          console.debug(
            `Failed to load Jira icon for ${issueTypeName}, using fallback icon`
          );
          setImageError(true);
        }}
      />
    );
  }

  // Otherwise render the Lucide icon (or fallback after image error)
  return (
    <Icon
      className={className}
      aria-label={`${issueTypeName || "Issue"} icon`}
    />
  );
}
