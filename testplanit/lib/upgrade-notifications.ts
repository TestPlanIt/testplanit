/**
 * Upgrade notifications configuration
 *
 * Add entries here when you want to notify users about new features
 * after they upgrade to a specific version.
 *
 * The key is the version number (must match package.json version format)
 * The value contains the notification title and message (TipTap JSON format supported)
 *
 * Example:
 * "0.3.43": {
 *   title: "New Feature: Dark Mode",
 *   message: "You can now switch to dark mode in your user preferences..."
 * }
 */

export interface UpgradeNotification {
  title: string;
  /** Message content - can include HTML tags for rich text formatting */
  message: string;
}

export const upgradeNotifications: Record<string, UpgradeNotification> = {
  // Add upgrade notifications here as new versions are released
  // Example:
  // "0.3.43": {
  //   title: "New Feature: Enhanced Search",
  //   message: "Search now supports custom field filtering and advanced operators."
  // },
};

/**
 * Get all notifications for versions between lastSeenVersion and currentVersion
 * Returns notifications in version order (oldest first)
 */
export function getUpgradeNotificationsBetweenVersions(
  lastSeenVersion: string | null,
  currentVersion: string
): { version: string; notification: UpgradeNotification }[] {
  const versions = Object.keys(upgradeNotifications);

  return versions
    .filter((version) => {
      // Include if version is greater than lastSeenVersion (or all if no lastSeenVersion)
      // and less than or equal to currentVersion
      const isAfterLastSeen =
        !lastSeenVersion || compareVersions(version, lastSeenVersion) > 0;
      const isUpToCurrent = compareVersions(version, currentVersion) <= 0;
      return isAfterLastSeen && isUpToCurrent;
    })
    .sort(compareVersions)
    .map((version) => ({
      version,
      notification: upgradeNotifications[version],
    }));
}

/**
 * Compare two semantic version strings
 * Returns: negative if a < b, positive if a > b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
  const aParts = a.split(".").map(Number);
  const bParts = b.split(".").map(Number);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] || 0;
    const bPart = bParts[i] || 0;
    if (aPart !== bPart) {
      return aPart - bPart;
    }
  }
  return 0;
}
