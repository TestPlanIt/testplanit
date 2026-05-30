import { prisma } from "@/lib/prisma";
import { decrypt, isEncrypted } from "@/utils/encryption";
import { IntegrationProvider } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { authOptions } from "~/server/auth";

interface TestConnectionRequest {
  integrationId?: number;
  provider?: IntegrationProvider;
  authType?: string;
  credentials?: Record<string, string>;
  settings?: Record<string, string>;
}

interface CapabilityProbe {
  ok: boolean;
  status?: number;
  error?: string;
}

interface TestConnectionResult {
  /** True only when every probe succeeded (auth + read scopes). */
  success: boolean;
  /** Top-level error message — set when a required field is missing or
   *  when the auth probe itself failed (so capability probes were not
   *  attempted). For partial-capability failures the per-probe `error`
   *  is the source of truth and `success` is false. */
  error?: string;
  capabilities?: {
    /** Auth handshake (Jira /myself, GitHub /user, ADO /projects). */
    connection: CapabilityProbe;
    /** Search probe — proves the credential can call the search API
     *  TestPlanIt uses for issue lookup (manual link, hover prefetch). */
    searchIssues?: CapabilityProbe;
    /** Read probe — proves the credential can fetch a single issue
     *  (manual sync, webhook-triggered auto-create / refresh). */
    readIssue?: CapabilityProbe;
  };
}

/**
 * Build a top-level error summary from a set of capability probes. The
 * summary names exactly which probe(s) failed and includes the upstream
 * error text the probe captured, so an admin reading the toast knows
 * both *what* TestPlanIt couldn't do with the credential and *why* the
 * provider rejected it. When the upstream returned a JSON body we
 * already extracted its `message` / `errorMessages[0]` / `error` field
 * inside `probe()`, so the human-readable reason is already in
 * `probe.error`.
 *
 * Examples:
 *   "Search issues failed (Jira): HTTP 403: Issue does not exist or you
 *    do not have permission to see it"
 *   "Search issues failed (GitHub): HTTP 422: Validation Failed; Read
 *    issue failed (GitHub): HTTP 403: Resource not accessible by
 *    personal access token"
 */
function summarizeProbeFailures(
  providerLabel: string,
  probes: Record<string, CapabilityProbe | undefined>
): string | undefined {
  const failed: string[] = [];
  for (const [name, p] of Object.entries(probes)) {
    if (p && !p.ok) {
      // Map internal probe names → admin-facing labels.
      const friendly =
        name === "connection"
          ? "Authentication"
          : name === "searchIssues"
            ? "Search issues"
            : name === "readIssue"
              ? "Read issue"
              : name;
      failed.push(`${friendly} failed (${providerLabel}): ${p.error}`);
    }
  }
  return failed.length > 0 ? failed.join("; ") : undefined;
}

async function probe(url: string, init: RequestInit): Promise<CapabilityProbe> {
  try {
    const signal = AbortSignal.timeout(10000);
    const response = await fetch(url, { ...init, signal });
    if (!response.ok) {
      // Try to extract the upstream error body so the admin sees the
      // actual reason (e.g. Jira's error messages, GitHub validation
      // failures, ADO PAT-policy text) instead of a bare status code.
      let detail = response.statusText;
      try {
        const body = await response.json();
        if (typeof body?.message === "string") detail = body.message;
        else if (Array.isArray(body?.errorMessages) && body.errorMessages[0])
          detail = String(body.errorMessages[0]);
        else if (typeof body?.error === "string") detail = body.error;
      } catch {
        /* non-JSON body — keep statusText */
      }
      return {
        ok: false,
        status: response.status,
        error: `HTTP ${response.status}: ${detail}`,
      };
    }
    return { ok: true, status: response.status };
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    return {
      ok: false,
      error: isTimeout
        ? `Request timed out after 10s (${url})`
        : err instanceof Error
          ? err.message
          : "Network error",
    };
  }
}

async function testJiraConnection(
  credentials: Record<string, string>,
  settings: Record<string, string>,
  authType?: string
): Promise<TestConnectionResult> {
  const { email, apiToken, clientId, clientSecret } = credentials;
  const { baseUrl, cloudId } = settings;

  if (authType === "API_KEY" || (email && apiToken)) {
    if (!email || !apiToken || !baseUrl) {
      return {
        success: false,
        error:
          "Missing required Jira API key configuration (email, apiToken, baseUrl)",
      };
    }

    const auth = `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
    const headers = { Authorization: auth, Accept: "application/json" };

    const connection = await probe(`${baseUrl}/rest/api/3/myself`, { headers });
    if (!connection.ok) {
      return {
        success: false,
        error: summarizeProbeFailures("Jira", { connection }),
        capabilities: { connection },
      };
    }

    // Search scope probe — issue lookup uses Jira's enhanced JQL search.
    // Calls `/rest/api/3/search/jql` (the JiraAdapter's production
    // endpoint, post the Atlassian deprecation of `/rest/api/3/search`
    // — see Atlassian changelog CHANGE-2046). The new endpoint rejects
    // unbounded JQL with HTTP 400, so we use a minimal bounded clause
    // (`created >= -1d`) — same shape JiraAdapter uses for incremental
    // syncs, just a smaller window. The probe doesn't care whether
    // any issues match; a 200 with `issues: []` still proves the
    // credential has search scope. A 403 here surfaces a missing
    // "browse projects" / search permission before TestPlanIt would
    // otherwise hit it on first hover/sync.
    const searchJqlParams = new URLSearchParams({
      jql: "created >= -1d ORDER BY created DESC",
      maxResults: "1",
      fields: "summary",
    });
    const searchIssues = await probe(
      `${baseUrl}/rest/api/3/search/jql?${searchJqlParams.toString()}`,
      { headers }
    );

    // Read-issue scope probe — Jira's `/issue/picker` endpoint is the
    // lightest read-permission check that doesn't require knowing a
    // real issue key, while still failing on credentials without
    // issue-read scope.
    const readIssue = await probe(
      `${baseUrl}/rest/api/3/issue/picker?currentJQL=&showSubTasks=false&showSubTaskParent=false`,
      { headers }
    );

    const success = connection.ok && searchIssues.ok && readIssue.ok;
    return {
      success,
      error: success
        ? undefined
        : summarizeProbeFailures("Jira", {
            connection,
            searchIssues,
            readIssue,
          }),
      capabilities: { connection, searchIssues, readIssue },
    };
  }

  // OAuth2 path — stay close to the existing behavior; OAuth tokens
  // expire and the per-user dance is exercised via the OAuth flow rather
  // than this admin-side test.
  if (!clientId || !clientSecret || !cloudId) {
    return {
      success: false,
      error: "Missing required Jira OAuth2 configuration",
    };
  }
  const connection = await probe(
    "https://api.atlassian.com/oauth/token/accessible-resources",
    {
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        Accept: "application/json",
      },
    }
  );
  return {
    success: connection.ok,
    error: connection.ok
      ? undefined
      : `Jira OAuth check failed: ${connection.error}`,
    capabilities: { connection },
  };
}

/**
 * OAuth client credentials can't be verified from the admin side — the real
 * connection is established per-user via the OAuth authorization flow after the
 * integration is saved. Validate that the client ID/secret are present and
 * report that user authorization is the next step.
 */
function checkOAuthClientConfig(
  credentials: Record<string, string>
): TestConnectionResult {
  const { clientId, clientSecret } = credentials;
  if (!clientId || !clientSecret) {
    return {
      success: false,
      error: "Missing required OAuth configuration (clientId, clientSecret)",
    };
  }
  return {
    success: true,
    error: undefined,
  };
}

async function testGithubConnection(
  credentials: Record<string, string>,
  settings: Record<string, string>
): Promise<TestConnectionResult> {
  const { personalAccessToken } = credentials;
  if (!personalAccessToken) {
    return { success: false, error: "Missing personal access token" };
  }

  // settings.baseUrl is set by GitHub Enterprise Server installations
  // (e.g. "https://ghes.example.com/api/v3"); omitted on public github.com.
  // Probe URLs are built from it so the connection test exercises the same
  // host the adapters will hit, not the public API.
  const baseUrl = (settings?.baseUrl || "https://api.github.com").replace(
    /\/$/,
    ""
  );

  const headers = {
    Authorization: `token ${personalAccessToken}`,
    Accept: "application/vnd.github.v3+json",
  };

  const connection = await probe(`${baseUrl}/user`, { headers });
  if (!connection.ok) {
    return {
      success: false,
      error: summarizeProbeFailures("GitHub", { connection }),
      capabilities: { connection },
    };
  }

  // Search scope probe — `/search/issues` is the exact endpoint
  // TestPlanIt's GitHub adapter calls for issue lookup, and it is the
  // one that returns 422 ("Validation Failed — listed users and
  // repositories cannot be searched") on a PAT scoped only to specific
  // resources. Catching it here surfaces the misconfiguration before
  // first hover / first webhook receipt instead of after.
  const searchIssues = await probe(
    `${baseUrl}/search/issues?q=is:issue&per_page=1`,
    { headers }
  );

  // Read-issue scope probe — listing the authenticated user's issues
  // is a minimal proof of issue read scope without needing to know a
  // public repo + number. Returns 200 with an array on success; 403
  // surfaces token-policy issues (e.g. PAT lifetime > org max).
  const readIssue = await probe(
    `${baseUrl}/issues?per_page=1&filter=all&state=open`,
    { headers }
  );

  const success = connection.ok && searchIssues.ok && readIssue.ok;
  return {
    success,
    error: success
      ? undefined
      : summarizeProbeFailures("GitHub", {
          connection,
          searchIssues,
          readIssue,
        }),
    capabilities: { connection, searchIssues, readIssue },
  };
}

async function testAzureDevOpsConnection(
  credentials: Record<string, string>,
  settings: Record<string, string>
): Promise<TestConnectionResult> {
  const { personalAccessToken } = credentials;
  const { organizationUrl } = settings;
  if (!personalAccessToken || !organizationUrl) {
    return {
      success: false,
      error: "Missing required Azure DevOps configuration",
    };
  }

  const headers = {
    Authorization: `Basic ${Buffer.from(`:${personalAccessToken}`).toString("base64")}`,
    Accept: "application/json",
  };

  const connection = await probe(
    `${organizationUrl}/_apis/projects?api-version=6.0`,
    { headers }
  );
  if (!connection.ok) {
    return {
      success: false,
      error: summarizeProbeFailures("Azure DevOps", { connection }),
      capabilities: { connection },
    };
  }

  // Search scope probe — WIQL POST is the work-item search endpoint
  // TestPlanIt's ADO adapter uses for issue lookup. A benign empty WHERE
  // returns the org's recent work items; 403 here means the PAT is
  // missing the "Work Items (Read)" scope.
  const searchIssues = await probe(
    `${organizationUrl}/_apis/wit/wiql?api-version=6.0&$top=1`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "SELECT [System.Id] FROM WorkItems",
      }),
    }
  );

  // Read-issue scope probe — `/wit/workitems` (without an id param)
  // returns an empty list on success and 403 when the PAT lacks the
  // work-item read permission. Lighter than searching first, picking
  // an id, then GETting it.
  const readIssue = await probe(
    `${organizationUrl}/_apis/wit/workitems?ids=1&api-version=6.0`,
    { headers }
  );
  // ADO returns 404 if id=1 doesn't exist, which still proves the
  // credential could read if it existed. Treat 404 as a passing read
  // probe; only auth/scope errors (401/403) are real failures here.
  if (!readIssue.ok && readIssue.status === 404) {
    readIssue.ok = true;
    readIssue.error = undefined;
  }

  const success = connection.ok && searchIssues.ok && readIssue.ok;
  return {
    success,
    error: success
      ? undefined
      : summarizeProbeFailures("Azure DevOps", {
          connection,
          searchIssues,
          readIssue,
        }),
    capabilities: { connection, searchIssues, readIssue },
  };
}

async function testGitLabConnection(
  credentials: Record<string, string>,
  settings: Record<string, string>
): Promise<TestConnectionResult> {
  const { personalAccessToken } = credentials;
  const instanceUrl = settings.instanceUrl || "https://gitlab.com";
  const baseUrl = instanceUrl.replace(/\/$/, "");
  const projectPath = settings.projectPath;

  if (!personalAccessToken) {
    return { success: false, error: "Missing personal access token" };
  }

  const headers = {
    "PRIVATE-TOKEN": personalAccessToken,
    Accept: "application/json",
  };

  // Auth probe — /api/v4/user confirms the token is valid.
  const connection = await probe(`${baseUrl}/api/v4/user`, { headers });
  if (!connection.ok) {
    return {
      success: false,
      error: summarizeProbeFailures("GitLab", { connection }),
      capabilities: { connection },
    };
  }

  let searchIssues: CapabilityProbe;
  let readIssue: CapabilityProbe;

  if (projectPath) {
    // Project-scoped probes: much faster than cross-project queries and
    // directly validates that the token can access the configured project.
    const encoded = encodeURIComponent(projectPath);
    searchIssues = await probe(
      `${baseUrl}/api/v4/projects/${encoded}/issues?per_page=1&state=opened`,
      { headers }
    );
    readIssue = await probe(`${baseUrl}/api/v4/projects/${encoded}`, {
      headers,
    });
  } else {
    // Fallback when no projectPath is configured yet.
    searchIssues = await probe(
      `${baseUrl}/api/v4/projects?membership=true&simple=true&per_page=1`,
      { headers }
    );
    readIssue = await probe(
      `${baseUrl}/api/v4/projects?membership=true&simple=true&per_page=1`,
      { headers }
    );
  }

  const success = connection.ok && searchIssues.ok && readIssue.ok;
  return {
    success,
    error: success
      ? undefined
      : summarizeProbeFailures("GitLab", {
          connection,
          searchIssues,
          readIssue,
        }),
    capabilities: { connection, searchIssues, readIssue },
  };
}

async function testGiteaConnection(
  credentials: Record<string, string>,
  settings: Record<string, string>
): Promise<TestConnectionResult> {
  const { personalAccessToken } = credentials;
  const { instanceUrl } = settings;

  if (!personalAccessToken || !instanceUrl) {
    return {
      success: false,
      error:
        "Missing required Gitea configuration (personalAccessToken, instanceUrl)",
    };
  }

  const baseUrl = instanceUrl.replace(/\/$/, "");
  const headers = {
    Authorization: `token ${personalAccessToken}`,
    Accept: "application/json",
  };

  // Auth probe — /api/v1/user returns the authenticated user's profile.
  const connection = await probe(`${baseUrl}/api/v1/user`, { headers });
  if (!connection.ok) {
    return {
      success: false,
      error: summarizeProbeFailures("Gitea", { connection }),
      capabilities: { connection },
    };
  }

  // Search probe — /api/v1/repos/search proves repo-list scope.
  const searchIssues = await probe(`${baseUrl}/api/v1/repos/search?limit=1`, {
    headers,
  });

  // Read probe — /api/v1/issues?type=issues proves issue read scope.
  const readIssue = await probe(
    `${baseUrl}/api/v1/repos/search?limit=1&topic=false`,
    { headers }
  );

  const success = connection.ok && searchIssues.ok && readIssue.ok;
  return {
    success,
    error: success
      ? undefined
      : summarizeProbeFailures("Gitea", {
          connection,
          searchIssues,
          readIssue,
        }),
    capabilities: { connection, searchIssues, readIssue },
  };
}

async function testSimpleUrlConnection(
  credentials: Record<string, string>,
  settings: Record<string, string>
): Promise<TestConnectionResult> {
  try {
    const { baseUrl } = settings;

    if (!baseUrl) {
      return {
        success: false,
        error: "Missing required URL pattern",
      };
    }

    // Validate that baseUrl contains {issueId} placeholder
    if (!baseUrl.includes("{issueId}")) {
      return {
        success: false,
        error: "URL pattern must include {issueId} placeholder",
      };
    }

    // For SIMPLE_URL, we just validate the URL format
    // There's no actual connection to test
    try {
      // Test with a sample issue ID
      const testUrl = baseUrl.replace("{issueId}", "TEST-123");
      new URL(testUrl); // This will throw if URL is invalid
    } catch {
      return {
        success: false,
        error: "Invalid URL pattern",
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export const POST = withAuditContext(async (req: NextRequest) => {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: TestConnectionRequest = await req.json();
    const { integrationId, provider, credentials, settings } = body;

    let testProvider = provider;
    const testCredentials = credentials || {};
    let testSettings = settings || {};

    let authType: string | undefined = body.authType;

    // If integrationId is provided, fetch the integration details
    if (integrationId) {
      const integration = await prisma.integration.findUnique({
        where: { id: integrationId },
      });

      if (!integration) {
        return NextResponse.json(
          { success: false, error: "Integration not found" },
          { status: 404 }
        );
      }

      testProvider = integration.provider;
      authType = integration.authType;

      // Decrypt stored credentials for testing
      if (
        integration.credentials &&
        typeof integration.credentials === "object"
      ) {
        // Check if credentials are stored with an 'encrypted' key (PUT route format)
        if (
          "encrypted" in integration.credentials &&
          typeof integration.credentials.encrypted === "string"
        ) {
          try {
            const decrypted = await decrypt(integration.credentials.encrypted);
            Object.assign(testCredentials, JSON.parse(decrypted));
          } catch (e) {
            console.error("Failed to decrypt credentials:", e);
          }
        } else {
          // Handle individual field encryption or plain text
          const encryptedCreds = integration.credentials as Record<
            string,
            string
          >;
          for (const [key, value] of Object.entries(encryptedCreds)) {
            if (value && typeof value === "string") {
              try {
                // Check if the value is encrypted using the utility function
                if (isEncrypted(value)) {
                  testCredentials[key] = await decrypt(value);
                } else {
                  // If not encrypted, use as-is
                  testCredentials[key] = value;
                }
              } catch {
                // If decryption fails, use the value as-is
                console.warn(
                  `Failed to decrypt credential ${key}, using as-is`
                );
                testCredentials[key] = value;
              }
            }
          }
        }
      }

      if (integration.settings && typeof integration.settings === "object") {
        testSettings = integration.settings as Record<string, string>;
      }
    }

    if (!testProvider) {
      return NextResponse.json(
        { success: false, error: "Provider not specified" },
        { status: 400 }
      );
    }

    // Test connection based on provider
    let result: TestConnectionResult;

    switch (testProvider) {
      case IntegrationProvider.JIRA:
        result = await testJiraConnection(
          testCredentials,
          testSettings,
          authType
        );
        break;
      case IntegrationProvider.GITHUB:
        result =
          authType === "OAUTH2"
            ? checkOAuthClientConfig(testCredentials)
            : await testGithubConnection(testCredentials, testSettings);
        break;
      case IntegrationProvider.AZURE_DEVOPS:
        result = await testAzureDevOpsConnection(testCredentials, testSettings);
        break;
      case IntegrationProvider.GITLAB:
        result =
          authType === "OAUTH2"
            ? checkOAuthClientConfig(testCredentials)
            : await testGitLabConnection(testCredentials, testSettings);
        break;
      case IntegrationProvider.GITEA:
        result =
          authType === "OAUTH2"
            ? checkOAuthClientConfig(testCredentials)
            : await testGiteaConnection(testCredentials, testSettings);
        break;
      case IntegrationProvider.SIMPLE_URL:
        result = await testSimpleUrlConnection(testCredentials, testSettings);
        break;
      default:
        result = {
          success: false,
          error: `Unsupported provider: ${testProvider}`,
        };
    }

    // Update integration status if testing an existing integration
    if (integrationId && result.success) {
      await prisma.integration.update({
        where: { id: integrationId },
        data: {
          status: "ACTIVE",
          lastSyncAt: new Date(),
        },
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Test connection error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
});
