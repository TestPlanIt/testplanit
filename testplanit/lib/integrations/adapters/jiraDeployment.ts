/**
 * Deployment-specific behavior for the Jira integration.
 *
 * Jira ships as two materially different products behind one brand:
 *
 * - **Cloud** (`*.atlassian.net`): REST API v3, users addressed by
 *   `accountId`, API-key auth is `Basic email:apiToken`, rich text is
 *   Atlassian Document Format (ADF), OAuth 2.0 (3LO) routes through the
 *   `api.atlassian.com/ex/jira/{cloudId}` gateway, search pagination uses
 *   an opaque `nextPageToken`.
 * - **Server / Data Center** (self-hosted): REST API v2 only (v3 does not
 *   exist), users addressed by `name`/`key`, auth is either a Personal
 *   Access Token sent as `Bearer` or `Basic username:password`, rich text
 *   is wiki markup strings, no OAuth 3LO, search pagination uses
 *   `startAt`/`total`.
 *
 * The deployment type is an explicit integration setting
 * (`settings.deploymentType`), chosen by the admin and validated by the
 * test-connection route against `/rest/api/2/serverInfo`. It is NOT
 * auto-detected per request: every pre-existing integration is Cloud
 * (Server never worked before this setting existed), so the absence of the
 * setting means Cloud, and adapters never spend round-trips probing.
 */

export type JiraDeploymentType = "cloud" | "server";
export type JiraApiVersion = "3" | "2";

export interface JiraCredentials {
  /** Cloud: Atlassian account email (Basic auth user half). */
  email?: string;
  /** Cloud: API token (Basic auth secret half). Server: Personal Access
   *  Token, sent as `Bearer`. */
  apiToken?: string;
  /** Server only: username for Basic auth. */
  username?: string;
  /** Server only: password for Basic auth. */
  password?: string;
}

/**
 * Normalize a raw `settings.deploymentType` value. Anything other than an
 * explicit "server" is Cloud — the safe default for every integration that
 * predates the setting.
 */
export function resolveJiraDeployment(value: unknown): JiraDeploymentType {
  return value === "server" ? "server" : "cloud";
}

export function jiraApiVersion(deployment: JiraDeploymentType): JiraApiVersion {
  return deployment === "server" ? "2" : "3";
}

/**
 * Build the `Authorization` header for a Jira credential set. The scheme is
 * fully determined by the deployment and which fields are present — there is
 * no heuristic that can misfire:
 *
 * - Server + username & password → `Basic username:password`
 * - Server + apiToken            → `Bearer <PAT>` (a Data Center PAT is
 *   never valid as the password half of Basic auth, so Bearer is the only
 *   correct scheme even if an email/username happens to be present)
 * - Cloud + email & apiToken     → `Basic email:apiToken`
 *
 * Throws when the required fields for the deployment are missing so callers
 * fail at authentication time with an actionable message instead of sending
 * a malformed header.
 */
export function buildJiraAuthHeader(
  deployment: JiraDeploymentType,
  creds: JiraCredentials
): string {
  if (deployment === "server") {
    if (creds.username && creds.password) {
      return `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString("base64")}`;
    }
    if (creds.apiToken) {
      return `Bearer ${creds.apiToken}`;
    }
    throw new Error(
      "Jira Server / Data Center authentication requires a Personal Access Token or a username and password"
    );
  }
  if (creds.email && creds.apiToken) {
    return `Basic ${Buffer.from(`${creds.email}:${creds.apiToken}`).toString("base64")}`;
  }
  throw new Error(
    "Jira Cloud authentication requires an email and an API token"
  );
}

/**
 * Pick the identifier Jira uses to address a user object it returned.
 * Cloud users carry `accountId`; Server / Data Center users carry `name`
 * (and `key` on older instances).
 */
export function jiraUserId(
  user: { accountId?: string; name?: string; key?: string } | null | undefined,
  deployment: JiraDeploymentType
): string | undefined {
  if (!user) return undefined;
  if (deployment === "server") return user.name ?? user.key ?? user.accountId;
  return user.accountId ?? user.name ?? user.key;
}

/**
 * Build the user-reference payload for assignee/reporter fields.
 * Cloud accepts `{ accountId }` (or `{ id }`); Server accepts `{ name }`.
 */
export function jiraUserRef(
  id: string,
  deployment: JiraDeploymentType
): { id: string } | { name: string } {
  return deployment === "server" ? { name: id } : { id };
}

export interface JiraServerInfo {
  deploymentType: JiraDeploymentType;
  version?: string;
}

/**
 * Probe `/rest/api/2/serverInfo` — available on Cloud and Server alike, and
 * anonymously readable on most instances — to learn what the base URL really
 * is. Used by the test-connection route to catch a deployment-type
 * misconfiguration before it surfaces as a cryptic 404 at first use; NOT
 * used on the adapter request path.
 *
 * Returns null when the probe is unreachable or the response is not
 * recognizable, so callers treat detection as advisory.
 */
export async function detectJiraDeployment(
  baseUrl: string,
  headers: Record<string, string> = {}
): Promise<JiraServerInfo | null> {
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/rest/api/2/serverInfo`,
      {
        headers: { Accept: "application/json", ...headers },
        signal: AbortSignal.timeout(10000),
        // A Server instance that requires auth redirects API paths to its
        // login page; following it would misreport a 200. Surface the
        // redirect as-is instead.
        redirect: "manual",
      }
    );
    if (!response.ok) return null;
    const body = await response.json();
    const type = String(body?.deploymentType ?? "").toLowerCase();
    if (type === "cloud") {
      return { deploymentType: "cloud", version: body?.version };
    }
    // Self-hosted instances report "Server" regardless of Server vs Data
    // Center licensing.
    if (type === "server" || type === "data center" || type === "datacenter") {
      return { deploymentType: "server", version: body?.version };
    }
    return null;
  } catch {
    return null;
  }
}
