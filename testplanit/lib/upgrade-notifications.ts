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
  "0.3.0": {
    title: "New Feature: Magic Select",
    message: `
      <p>Use AI to automatically select relevant test cases when creating a test run.</p>
      <ul>
        <li>Click the <strong>Magic Select</strong> button when creating a test run</li>
        <li>AI analyzes your test run name, description, documentation, tags, and linked issues to find the best matches</li>
        <li>Review and adjust the suggested test cases before accepting</li>
      </ul>
      <p>Requires an LLM integration configured in your project settings.</p>
    `,
  },
  "0.5.0": {
    title: "New Feature: Audit Logs",
    message: `
      <p>TestPlanIt now includes comprehensive <strong>audit logging</strong> for enhanced security and compliance.</p>
      <ul>
        <li>Track all user actions including logins, data changes, and permission modifications</li>
        <li>View detailed change history with before/after values</li>
        <li>Filter logs by user, action type, entity, or date range</li>
        <li>Export audit logs for compliance reporting</li>
      </ul>
      <p>Administrators can access audit logs from <strong>Admin → Audit Logs</strong>.</p>
    `,
  },
  "0.6.0": {
    title: "New Feature: Two-Factor Authentication",
    message: `
      <p>TestPlanIt now supports <strong>Two-Factor Authentication (2FA)</strong> for enhanced account security.</p>
      <ul>
        <li>Enable TOTP-based 2FA from your <strong>User Profile</strong></li>
        <li>Works with any authenticator app (Google Authenticator, Authy, etc.)</li>
        <li>Backup codes provided for account recovery</li>
        <li>Regenerate backup codes at any time from your profile</li>
      </ul>
      <p><strong>For Administrators:</strong></p>
      <ul>
        <li>Enforce 2FA for password-based logins via <strong>Admin → SSO → Registration Settings</strong></li>
        <li>Optionally require 2FA for all logins, including SSO users</li>
      </ul>
    `,
  },
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
