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
  "0.7.0": {
    title: "New Feature: Import Automated Test Results from more frameworks",
    message: `
      <p>Import automated test results from <strong>7 popular testing frameworks</strong> directly into TestPlanIt.</p>
      <ul>
        <li><strong>JUnit XML</strong> - Java, Python (pytest), and many CI systems</li>
        <li><strong>TestNG XML</strong> - Java projects using TestNG</li>
        <li><strong>NUnit XML</strong> - .NET projects using NUnit v2/v3</li>
        <li><strong>xUnit XML</strong> - .NET projects using xUnit.net</li>
        <li><strong>MSTest TRX</strong> - Visual Studio Test Results</li>
        <li><strong>Mocha JSON</strong> - JavaScript/Node.js projects</li>
        <li><strong>Cucumber JSON</strong> - BDD frameworks (Cucumber, SpecFlow)</li>
      </ul>
      <p>Navigate to <strong>Test Runs → Import Results</strong> to get started. Auto-detection identifies your file format automatically.</p>
    `,
  },
  "0.8.0": {
    title: "New Feature: CLI Tool & API Tokens",
    message: `
      <p>TestPlanIt now includes a <strong>CLI tool</strong> and <strong>API token authentication</strong> for seamless CI/CD integration.</p>
      <h4>CLI Tool</h4>
      <ul>
        <li>Import test results directly from your terminal or CI/CD pipelines</li>
        <li>Standalone binaries for Linux, macOS, and Windows - no Node.js required</li>
        <li>Reference projects, milestones, and configurations by name or ID</li>
        <li>Environment variable support for secure CI/CD configuration</li>
      </ul>
      <h4>API Tokens</h4>
      <ul>
        <li>Create tokens from your <strong>User Profile → API Tokens</strong></li>
        <li>Use tokens for programmatic API access in scripts and integrations</li>
        <li>Administrators can manage all tokens from <strong>Admin → API Tokens</strong></li>
        <li>Set expiration dates and track token usage</li>
      </ul>
      <p>See the <a href="https://docs.testplanit.com/docs/cli" target="_blank">CLI documentation</a> and <a href="https://docs.testplanit.com/docs/api-tokens" target="_blank">API Tokens documentation</a> for details.</p>
    `,
  },
  "0.9.14": {
    title: "New Features: Enhanced Repository Navigation & Editor Improvements",
    message: `
      <p>This release focuses on improving your daily workflow with editor enhancements and streamlined folder navigation.</p>
      <h4>Rich Text Editor Drag Handles</h4>
      <ul>
        <li>Drag and reorder content blocks in test case documentation</li>
        <li>Hover over any content block to reveal the drag handle</li>
      </ul>
      <h4>"Last Test Result" Column</h4>
      <ul>
        <li>New column in the repository shows the most recent test result status for each test case</li>
        <li>Hover to see when it was tested and which test run it was part of</li>
      </ul>
      <h4>Folder Tree Improvements</h4>
      <ul>
        <li>Press <strong>Shift+N</strong> to quickly open the Add Folder dialog</li>
        <li>Click anywhere on a folder row to expand/collapse</li>
        <li>Alt+click on a root folder to expand/collapse ALL root folders at once</li>
        <li>New drop zone at bottom of tree for moving folders to root level</li>
        <li>Newly created folders are automatically selected</li>
        <li>Override parent folder when creating to place new folders at root level</li>
      </ul>
    `,
  },
  "0.11.0": {
    title: "New Feature: Share Links",
    message: `
      <p>Share reports securely with team members, clients, and stakeholders through customizable URLs without requiring a TestPlanIt account.</p>
      <h4>Three Access Modes</h4>
      <ul>
        <li><strong>Authenticated</strong> - Requires login with project access for full interactive experience</li>
        <li><strong>Public</strong> - No authentication required, read-only view with filtered data</li>
        <li><strong>Password-Protected</strong> - Requires password with rate limiting and auth bypass for team members</li>
      </ul>
      <h4>Key Features</h4>
      <ul>
        <li>Customizable titles, descriptions, and expiration dates</li>
        <li>Access analytics with view tracking and detailed logs</li>
        <li>Notifications when links are accessed</li>
      </ul>
      <p>Click the <strong>Share</strong> button in Report Builder to create your first share link. See the <a href="https://docs.testplanit.io/user-guide/share-links" target="_blank">documentation</a> for details.</p>
    `,
  },
  "0.12.0": {
    title: "New Feature: Microsoft SSO & Demo Project",
    message: `
      <p>This release adds <strong>Microsoft (Azure AD) Single Sign-On</strong> and a pre-populated <strong>Demo Project</strong> for new installations.</p>
      <h4>Microsoft SSO</h4>
      <ul>
        <li>Sign in with Microsoft / Azure Active Directory accounts</li>
        <li>Supports single-tenant and multi-tenant configurations</li>
        <li>Configure via the Admin UI at <strong>Admin → SSO</strong> or environment variables</li>
      </ul>
      <p>See the <a href="https://docs.testplanit.io/user-guide/sso" target="_blank">SSO documentation</a> for Microsoft setup instructions.</p>
      <h4>Demo Project</h4>
      <ul>
        <li>A pre-populated Demo Project showcasing all major features</li>
        <li>Includes sample test cases, test runs, sessions, milestones, tags, and issues</li>
        <li>Use <strong>Help → Start Demo Project Tour</strong> for a guided walkthrough</li>
      </ul>
    `,
  },
  "0.14.0": {
    title: "New Feature: Configurable AI Prompts",
    message: `
      <p>TestPlanIt now gives you <strong>full control over every AI prompt</strong> — view, edit, and customize them per project directly in the admin UI.</p>
      <h4>Configurable AI Features</h4>
      <ul>
        <li><strong>Test Case Generation</strong> — Control the system prompt, user prompt template, temperature, and token limits</li>
        <li><strong>Markdown Test Case Parsing</strong> — Customize how markdown documents are converted into structured test cases</li>
        <li><strong>Smart Test Case Selection</strong> — Tune how AI selects relevant test cases for test runs</li>
        <li><strong>Editor Writing Assistant</strong> — Adjust the in-editor AI for descriptions, steps, and expected results</li>
      </ul>
      <h4>Per-Project Customization</h4>
      <ul>
        <li>Create prompt configurations tailored to specific teams or domains</li>
        <li>Project Administrators assign configurations per project in <strong>Settings → AI Models</strong></li>
        <li>Three-level resolution: project-specific → system default → built-in fallback</li>
      </ul>
      <p>System Administrators get started at <strong>Admin → Prompt Configs</strong> (Tools & Integrations section). See the <a href="https://docs.testplanit.com/user-guide/llm-integrations#prompt-configurations" target="_blank">documentation</a> for details.</p>
    `,
  },
  "0.15.0": {
    title: "New Feature: QuickScript",
    message: `
      <p>Convert your manual test cases into automation scripts right from the Repository.</p>
      <ul>
        <li>Select test cases and click <strong>QuickScript</strong> to export as real, reviewable code</li>
        <li>40 built-in templates covering popular frameworks and languages</li>
        <li>Export as a single file or individual files bundled in a ZIP</li>
        <li>Toggle <strong>Generate with AI</strong> for complete, framework-idiomatic test files</li>
        <li>Connect a code repository for AI output that uses your actual page objects, fixtures, and helpers</li>
      </ul>
      <p>Manage templates at <strong>Admin → QuickScript Templates</strong>. See the <a href="https://docs.testplanit.com/user-guide/projects/quickscript" target="_blank">documentation</a> or watch the <a href="https://www.youtube.com/watch?v=ZUByrgED-ao" target="_blank">demo video</a>.</p>
    `,
  },
  "0.16.0": {
    title: "New Feature: Auto Tag",
    message: `
      <p>Automatically suggest and apply tags to your test cases, test runs, and sessions using AI — keeping your repository organized without the manual effort.</p>
      <ul>
        <li>Access Auto Tag from the <strong>Tags</strong> page (top menu), <strong>Project → Tags</strong>, or by selecting cases in the <strong>Repository</strong></li>
        <li>AI analyzes test case steps and custom fields, run notes and docs, and session mission and notes</li>
        <li>Review suggestions before applying — accept all or pick individual tags</li>
        <li>Reuses your existing tags when they fit, and creates new ones when needed</li>
      </ul>
      <p>Requires an LLM integration configured in your project settings.</p>
    `,
  },
  "0.17.0": {
    title: "New Feature: Copy/Move Test Cases",
    message: `
      <p>Copy/Move test cases and entire folder trees directly between projects. No more export/import cycles.</p>
      <ul>
        <li>Select cases or use the folder menu to choose <strong>Copy/Move</strong></li>
        <li>Template and workflow compatibility handled automatically</li>
        <li>Steps, custom fields, tags, issue links, and attachments all carry over</li>
      </ul>
    `,
  },
  "0.18.0": {
    title: "New Feature: Duplicate Detection",
    message: `
      <p>Find and resolve <strong>duplicate test cases</strong> and <strong>repeated step sequences</strong> across your repository.</p>
      <h4>Duplicate Test Cases</h4>
      <ul>
        <li>Click <strong>Find Duplicates</strong> in the Repository toolbar to scan your project</li>
        <li>Review candidate pairs side-by-side with confidence scores (High / Medium / Low)</li>
        <li>Resolve each pair by <strong>merging</strong>, <strong>linking as related</strong>, or <strong>dismissing</strong></li>
        <li>Get a soft warning when saving a new test case that resembles an existing one</li>
      </ul>
      <h4>Duplicate Steps</h4>
      <ul>
        <li>Navigate to <strong>Shared Steps</strong> and click <strong>Find Duplicates</strong> to scan for repeated step sequences</li>
        <li>Preview and edit steps before converting, then create a Shared Step Group in one click</li>
        <li>Dismiss false positives individually or in bulk</li>
      </ul>
      <p>Projects with an LLM integration can enable <strong>semantic analysis</strong> for test case detection. See the <a href="https://docs.testplanit.com/blog/duplicate-detection" target="_blank">blog post</a> for details.</p>
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
