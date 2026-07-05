import { Buffer } from "node:buffer";

/**
 * Jira deployment flavors supported by the adapter.
 *
 * - `cloud` — Atlassian Cloud. REST API v3 (`/rest/api/3`), users addressed
 *   by `accountId`, API-key auth is `Basic email:apiToken`, OAuth routes
 *   through the `api.atlassian.com/ex/jira/{cloudId}` gateway.
 * - `server` — Jira Server / Data Center. REST API v2 (`/rest/api/2`), users
 *   addressed by `name`/`key`, Personal Access Tokens authenticate via
 *   `Bearer`, and Basic auth uses `username:password`.
 */
export type JiraDeploymentType = "cloud" | "server";
export type JiraApiVersion = "3" | "2";

export interface JiraDeploymentInfo {
  type: JiraDeploymentType;
  apiVersion: JiraApiVersion;
}

export interface JiraAuthCredentials {
  email?: string;
  username?: string;
  apiToken?: string;
  password?: string;
}

export type JiraAuthScheme = "basic" | "bearer";

const SERVER_INFO_TIMEOUT_MS = 10000;

/**
 * Detect the Jira deployment flavor by probing `/rest/api/2/serverInfo`,
 * which exists on both Cloud and Server/Data Center. The response's
 * `deploymentType` field is `"Cloud"` for Cloud and `"Server"` (or
 * `"Data Center"`) for self-hosted instances.
 *
 * When the probe fails (network error, auth rejected, non-JSON body), fall
 * back to a hostname heuristic: `*.atlassian.net` → Cloud, anything else →
 * Server. This keeps Cloud installations working when the probe is blocked
 * and lets a Data Center instance be identified even if `serverInfo` is
 * temporarily unreachable.
 */
export async function detectJiraDeployment(
  baseUrl: string,
  authHeaders: Record<string, string> = {}
): Promise<JiraDeploymentInfo> {
  const normalizedBase = (baseUrl || "").replace(/\/$/, "");

  try {
    const signal = AbortSignal.timeout(SERVER_INFO_TIMEOUT_MS);
    const response = await fetch(
      `${normalizedBase}/rest/api/2/serverInfo`,
      {
        headers: { Accept: "application/json", ...authHeaders },
        signal,
      }
    );
    if (response.ok) {
      const body = await response.json();
      const deploymentType = String(
        body?.deploymentType ?? ""
      ).toLowerCase();
      if (deploymentType === "cloud") {
        return { type: "cloud", apiVersion: "3" };
      }
      if (
        deploymentType === "server" ||
        deploymentType === "data center" ||
        deploymentType === "datacenter"
      ) {
        return { type: "server", apiVersion: "2" };
      }
    }
  } catch {
    // fall through to the hostname heuristic
  }

  try {
    const host = new URL(normalizedBase).hostname.toLowerCase();
    if (host.endsWith(".atlassian.net") || host.endsWith(".jiracloud.com")) {
      return { type: "cloud", apiVersion: "3" };
    }
  } catch {
    /* malformed baseUrl — default to server below */
  }

  return { type: "server", apiVersion: "2" };
}

/**
 * Resolve the authentication scheme for a Jira credential set.
 *
 * A Personal Access Token on Data Center is sent as `Bearer`. Cloud API
 * tokens and Data Center username/password pairs use `Basic`. An explicit
 * `override` (from `settings.authScheme`) wins over auto-detection so
 * admins can force a scheme when the heuristic is wrong.
 */
export function resolveAuthScheme(
  creds: JiraAuthCredentials,
  override?: string
): JiraAuthScheme {
  if (override === "bearer") return "bearer";
  if (override === "basic") return "basic";
  // A PAT is a bare token with no email/username pairing.
  if (creds.apiToken && !creds.email && !creds.username) return "bearer";
  return "basic";
}

/**
 * Build the `Authorization` header value for a Jira credential set.
 *
 * - `bearer` → `Bearer <apiToken>` (Data Center Personal Access Token).
 * - `basic`  → `Basic base64(email|username : apiToken|password)`. Cloud
 *   pairs an email with an API token; Data Center pairs a username with a
 *   password. We prefer `email` then `username` for the user half, and
 *   `apiToken` then `password` for the secret half.
 */
export function buildAuthHeader(
  creds: JiraAuthCredentials,
  scheme: JiraAuthScheme
): string {
  if (scheme === "bearer") {
    return `Bearer ${creds.apiToken ?? creds.password ?? ""}`;
  }
  const user = creds.email ?? creds.username ?? "";
  const pass = creds.apiToken ?? creds.password ?? "";
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

/**
 * Pick the user identifier Jira expects for the deployment. Cloud uses
 * `accountId`; Server/Data Center uses `name` (falling back to `key`).
 */
export function pickUserId(
  user:
    | { accountId?: string; name?: string; key?: string }
    | null
    | undefined,
  deployment: JiraDeploymentType
): string | undefined {
  if (!user) return undefined;
  if (deployment === "server") {
    return user.name ?? user.key ?? user.accountId;
  }
  return user.accountId ?? user.name ?? user.key;
}

/**
 * Build the user-reference object for reporter/assignee fields. Cloud
 * accepts `{ accountId }`; Server/Data Center accepts `{ name }`.
 */
export function userRefField(
  user:
    | { accountId?: string; name?: string; key?: string }
    | null
    | undefined,
  deployment: JiraDeploymentType
): { accountId: string } | { name: string } | undefined {
  const id = pickUserId(user, deployment);
  if (!id) return undefined;
  if (deployment === "server") return { name: id };
  return { accountId: id };
}
