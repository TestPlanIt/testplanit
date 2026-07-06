import { BaseAdapter } from "./BaseAdapter";
import {
  AuthenticationData,
  CreateIssueData,
  IssueAdapterCapabilities,
  IssueComment,
  IssueData,
  IssueSearchOptions,
  LinkedIssueRef,
  UpdateIssueData,
} from "./IssueAdapter";
import {
  buildAuthHeader,
  detectJiraDeployment,
  JiraApiVersion,
  JiraAuthCredentials,
  JiraAuthScheme,
  JiraDeploymentType,
  pickUserId,
  resolveAuthScheme,
} from "./jiraDeployment";

/**
 * Jira integration adapter implementing OAuth authentication
 */
export class JiraAdapter extends BaseAdapter {
  public supportsOAuth = true;

  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private cloudId?: string;
  private apiEmail?: string;
  private apiToken?: string;
  private baseUrl?: string;
  private deployment: JiraDeploymentType = "cloud";
  private apiVersion: JiraApiVersion = "3";
  private authScheme: JiraAuthScheme = "basic";
  private authCreds: JiraAuthCredentials = {};
  private apiKeyAuthActive = false;
  private deploymentResolved = false;
  private authSchemeOverride?: string;

  /**
   * Translate the priority value passed by the create-issue dialog to the
   * shape Jira's REST API accepts.
   *
   * The dialog (create-issue-dialog.tsx) ships lowercase tokens:
   *   "low" | "medium" | "high" | "urgent"
   * Jira's REST API accepts either `{ id: "<numeric>" }` (the priority's
   * numeric ID in the priority scheme) OR `{ name: "<exact name>" }`
   * (looked up server-side against the project's priority scheme).
   *
   * Until INT-05 the adapter wrapped the dialog's lowercase token as
   * `{ id }`, which fails for every Jira project whose priority scheme
   * doesn't happen to have a priority named "medium" / "high" / etc.
   * (i.e. every standard scheme — Jira's defaults are "Highest", "High",
   * "Medium", "Low", "Lowest"). Surfaced during the cross-adapter UAT.
   *
   * Behavior:
   *  - dialog tokens → `{ name: <Capitalized> }`. "urgent" maps to
   *    "Highest" because that's the upper-tier name in Jira's stock
   *    scheme; projects that have renamed it will need to either rename
   *    back or pass a numeric ID directly.
   *  - numeric-looking strings (e.g. "3") are passed through as `{ id }`
   *    so callers that already speak the Jira-native protocol keep
   *    working.
   *  - any other non-empty string is passed through as `{ name }` so a
   *    caller can use a custom priority name without further changes
   *    here.
   *  - empty / null / undefined → undefined (field omitted; Jira uses
   *    the project default).
   */
  private static mapPriorityField(
    value: string | null | undefined
  ): { id: string } | { name: string } | undefined {
    if (!value) return undefined;
    const tokenToName: Record<string, string> = {
      low: "Low",
      medium: "Medium",
      high: "High",
      urgent: "Highest",
    };
    const lowered = value.toLowerCase();
    if (lowered in tokenToName) return { name: tokenToName[lowered]! };
    if (/^\d+$/.test(value)) return { id: value };
    return { name: value };
  }

  constructor(config: any) {
    super(config);

    // OAuth configuration. Prefer the per-integration values that
    // IntegrationManager.buildAdapterConfig decrypts from the integration's
    // stored credentials (clientId/clientSecret) and derives for the redirect
    // URI (the canonical /api/integrations/oauth/jira/callback route) — this is
    // what lets each instance register its own Atlassian OAuth app from the
    // admin UI. Fall back to the legacy JIRA_* env vars for single-app
    // deployments that configured OAuth before per-integration creds existed.
    this.clientId = config.clientId || process.env.JIRA_CLIENT_ID || "";
    this.clientSecret =
      config.clientSecret || process.env.JIRA_CLIENT_SECRET || "";
    this.redirectUri =
      config.redirectUri || process.env.JIRA_REDIRECT_URI || "";

    // Base URL from config if provided
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }

    // Optional explicit deployment / auth-scheme overrides (e.g. from
    // integration settings). When set, auto-detection is skipped so admins
    // can force Cloud vs Server/Data Center behavior.
    if (config.deploymentType === "cloud" || config.deploymentType === "server") {
      this.deployment = config.deploymentType;
      this.apiVersion = config.deploymentType === "server" ? "2" : "3";
      this.deploymentResolved = true;
    }
    if (config.authScheme === "basic" || config.authScheme === "bearer") {
      this.authSchemeOverride = config.authScheme;
    }
  }

  getCapabilities(): IssueAdapterCapabilities {
    return {
      createIssue: true,
      updateIssue: true,
      linkIssue: true,
      syncIssue: true,
      searchIssues: true,
      webhooks: true,
      customFields: true,
      attachments: true,
      linkedIssues: true,
      comments: true,
    };
  }

  protected async performAuthentication(
    authData: AuthenticationData
  ): Promise<void> {
    if (authData.type === "api_key") {
      // API-key authentication covers three credential shapes:
      //   - Cloud:             email + apiToken    (Basic email:apiToken, v3)
      //   - Data Center PAT:   apiToken only       (Bearer <token>, v2)
      //   - Data Center Basic: username + password (Basic username:password, v2)
      const baseUrl = authData.baseUrl || this.baseUrl;
      const hasSecret = !!authData.apiToken || !!authData.password;
      if (!baseUrl || !hasSecret) {
        throw new Error(
          "API key authentication requires email, apiToken, and baseUrl"
        );
      }

      this.authCreds = {
        email: authData.email,
        username: authData.username,
        apiToken: authData.apiToken,
        password: authData.password,
      };
      // Initial best-guess scheme (deployment unknown). Re-resolved below
      // once the deployment is known, so an email + PAT combo on Data
      // Center switches from Basic to Bearer (a DC PAT is always Bearer,
      // even when an email was supplied).
      this.authScheme = resolveAuthScheme(this.authCreds, this.authSchemeOverride);
      this.baseUrl = baseUrl;
      // Keep legacy fields populated for any code that still reads them.
      this.apiEmail = authData.email;
      this.apiToken = authData.apiToken;

      let authHeader = buildAuthHeader(this.authCreds, this.authScheme);
      let headers = {
        Authorization: authHeader,
        Accept: "application/json",
      };
      // Re-resolve the auth scheme now that the deployment is known, then
      // rebuild the header. On Data Center a PAT is Bearer regardless of an
      // email; on Cloud an API token + email is Basic.
      const reapplyScheme = () => {
        this.authScheme = resolveAuthScheme(
          this.authCreds,
          this.authSchemeOverride,
          this.deployment
        );
        authHeader = buildAuthHeader(this.authCreds, this.authScheme);
        headers = { Authorization: authHeader, Accept: "application/json" };
      };

      // Explicit deployment override short-circuits auto-detection.
      if (this.deploymentResolved) {
        reapplyScheme();
        const response = await fetch(
          `${this.baseUrl}/rest/api/${this.apiVersion}/myself`,
          { headers }
        );
        if (!response.ok) {
          throw new Error(
            `Jira API authentication failed: ${response.statusText}`
          );
        }
        this.apiKeyAuthActive = true;
      } else {
        // Cloud attempt (v3). A 404 indicates a Data Center instance that
        // only ships /rest/api/2; detect via serverInfo and retry on v2.
        // Detect via v3 /myself with redirect: "manual" so a Data Center
        // instance that redirects unknown v3 paths to the login page (302→200)
        // is NOT misread as a successful Cloud probe. Any non-OK v3 result
        // (404, 401, or the opaque redirect) triggers serverInfo detection.
        const v3Response = await fetch(
          `${this.baseUrl}/rest/api/3/myself`,
          { headers, redirect: "manual" }
        );
        if (v3Response.ok) {
          this.deployment = "cloud";
          this.apiVersion = "3";
          this.deploymentResolved = true;
          this.apiKeyAuthActive = true;
        } else if (!v3Response.ok) {
          const detected = await detectJiraDeployment(this.baseUrl!, {
            Authorization: authHeader,
          });
          this.deployment = detected.type;
          this.apiVersion = detected.apiVersion;
          this.deploymentResolved = true;
          if (detected.type === "server") {
            // A PAT on DC is Bearer even when an email was supplied —
            // re-resolve and rebuild the header before the v2 probe.
            reapplyScheme();
            const v2Response = await fetch(
              `${this.baseUrl}/rest/api/2/myself`,
              { headers }
            );
            if (!v2Response.ok) {
              throw new Error(
                `Jira API authentication failed: ${v2Response.statusText}`
              );
            }
            this.apiKeyAuthActive = true;
          } else {
            // serverInfo reports Cloud but v3 /myself 404'd — surface the
            // original failure rather than silently switching versions.
            throw new Error(
              `Jira API authentication failed: ${v3Response.statusText}`
            );
          }
        } else {
          throw new Error(
            `Jira API authentication failed: ${v3Response.statusText}`
          );
        }
      }
    } else if (authData.type === "oauth") {
      // OAuth authentication
      if (!this.clientId || !this.clientSecret || !this.redirectUri) {
        throw new Error(
          "Jira OAuth configuration is incomplete. Please check environment variables."
        );
      }

      // Get accessible resources to determine the cloud ID
      if (!this.cloudId) {
        const resources = await this.getAccessibleResources(
          authData.accessToken!
        );
        if (resources.length === 0) {
          throw new Error("No accessible Jira resources found");
        }
        this.cloudId = resources[0].id;
      }
    } else {
      throw new Error(
        "Jira adapter only supports OAuth and API key authentication"
      );
    }
  }

  /**
   * Get available projects
   */
  async getProjects(): Promise<
    Array<{ id: string; key: string; name: string }>
  > {
    if (this.apiKeyAuthActive && this.baseUrl) {
      // API key authentication (Cloud or Data Center)
      const data = await this.makeRequest<any>(
        this.buildUrl(`/rest/api/${this.apiVersion}/project/search`)
      );
      return (data.values || []).map((project: any) => ({
        id: project.id,
        key: project.key,
        name: project.name,
      }));
    } else if (this.authData?.accessToken && this.cloudId) {
      // OAuth authentication (Cloud-only gateway)
      const response = await this.makeRequest<any>(
        `https://api.atlassian.com/ex/jira/${this.cloudId}/rest/api/${this.apiVersion}/project/search`
      );

      return (response.values || []).map((project: any) => ({
        id: project.id,
        key: project.key,
        name: project.name,
      }));
    } else {
      throw new Error("Not authenticated");
    }
  }

  /**
   * Get OAuth authorization URL
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      audience: "api.atlassian.com",
      client_id: this.clientId,
      scope: "read:jira-work write:jira-work read:jira-user offline_access",
      redirect_uri: this.redirectUri,
      state: state,
      response_type: "code",
      prompt: "consent",
    });

    return `https://auth.atlassian.com/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    const response = await fetch("https://auth.atlassian.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: code,
        redirect_uri: this.redirectUri,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exchange code for tokens: ${error}`);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined,
    };
  }

  /**
   * Refresh OAuth tokens
   */
  async refreshTokens(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    const response = await fetch("https://auth.atlassian.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to refresh tokens: ${error}`);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined,
    };
  }

  /**
   * Get accessible Jira resources
   */
  private async getAccessibleResources(accessToken: string): Promise<
    Array<{
      id: string;
      url: string;
      name: string;
      scopes: string[];
    }>
  > {
    const response = await fetch(
      "https://api.atlassian.com/oauth/token/accessible-resources",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error("Failed to get accessible resources");
    }

    return response.json();
  }

  protected buildUrl(path: string): string {
    // For API key auth, use the base URL directly
    if (this.apiKeyAuthActive && this.baseUrl) {
      return `${this.baseUrl}${path}`;
    }

    // For OAuth, use cloud ID
    if (!this.cloudId) {
      throw new Error("Cloud ID not set. Please authenticate first.");
    }
    return `https://api.atlassian.com/ex/jira/${this.cloudId}${path}`;
  }

  /**
   * Override makeRequest to handle Jira's API key authentication
   */
  protected async makeRequest<T = any>(
    url: string,
    options: RequestInit = {}
  ): Promise<T> {
    // If using API key auth, bypass the base class and handle it directly
    if (this.apiKeyAuthActive) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...((options.headers as any) || {}),
      };

      // Cloud: Basic email:apiToken. Data Center PAT: Bearer <token>.
      // Data Center Basic: Basic username:password.
      headers["Authorization"] = buildAuthHeader(this.authCreds, this.authScheme);

      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      return response.json();
    }

    // Otherwise use the base class implementation for OAuth
    return super.makeRequest<T>(url, options);
  }

  async createIssue(data: CreateIssueData): Promise<IssueData> {
    // Determine if projectId is a key (e.g., "TPI") or an ID (numeric)
    const projectField = isNaN(Number(data.projectId))
      ? { key: data.projectId } // It's a project key
      : { id: data.projectId }; // It's a project ID

    // Convert description to ADF format
    let descriptionField;
    if (data.description) {
      // console.log('[JiraAdapter] Raw description:', data.description);

      // Check if description is TipTap JSON
      if (
        typeof data.description === "object" &&
        data.description &&
        "type" in data.description &&
        data.description.type === "doc"
      ) {
        // Direct TipTap JSON to ADF conversion
        descriptionField = this.tiptapToAdf(data.description);
        // console.log('[JiraAdapter] Converted ADF from TipTap:', JSON.stringify(descriptionField, null, 2));
      } else if (
        typeof data.description === "string" &&
        data.description.includes("<") &&
        data.description.includes(">")
      ) {
        // HTML string - use HTML to ADF converter
        descriptionField = this.htmlToAdf(data.description);
        // console.log('[JiraAdapter] Converted ADF from HTML:', JSON.stringify(descriptionField, null, 2));
      } else if (typeof data.description === "string") {
        // Plain text
        descriptionField = {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: data.description,
                },
              ],
            },
          ],
        };
      }
    } else {
      descriptionField = null;
    }

    // Extract reporter from customFields if present
    const { reporter, ...otherCustomFields } = data.customFields || {};

    // console.log("[JiraAdapter] Incoming data.customFields:", JSON.stringify(data.customFields, null, 2));
    // console.log("[JiraAdapter] Extracted reporter:", JSON.stringify(reporter, null, 2));
    // console.log("[JiraAdapter] Other custom fields:", JSON.stringify(otherCustomFields, null, 2));

    const jiraPayload = {
      fields: {
        project: projectField,
        summary: data.title,
        description: descriptionField,
        issuetype: { id: data.issueType || "10001" }, // Default to Task
        priority: JiraAdapter.mapPriorityField(data.priority),
        assignee: data.assigneeId
          ? this.deployment === "server"
            ? { name: data.assigneeId }
            : { id: data.assigneeId }
          : undefined,
        reporter: reporter
          ? this.deployment === "server"
            ? { name: (reporter as any).accountId ?? (reporter as any).name }
            : reporter // Reporter is a system field, not custom
          : undefined,
        labels: data.labels || [],
        ...otherCustomFields,
      },
    };

    // console.log("[JiraAdapter] Creating issue with payload:", JSON.stringify(jiraPayload, null, 2));
    // console.log("[JiraAdapter] Reporter field in payload:", jiraPayload.fields.reporter);

    try {
      const response = await this.makeRequest<any>(
        this.buildUrl(`/rest/api/${this.apiVersion}/issue`),
        {
          method: "POST",
          body: JSON.stringify(jiraPayload),
        }
      );

      // console.log("[JiraAdapter] Create issue response:", JSON.stringify(response, null, 2));

      // The create response only contains id, key, and self
      // We need to fetch the full issue details
      if (response.key) {
        const fullIssue = await this.getIssue(response.key);
        // console.log("[JiraAdapter] Created issue reporter:", fullIssue.reporter);
        return fullIssue;
      }

      throw new Error("Failed to create issue - no key returned");
    } catch (error) {
      console.error("[JiraAdapter] Failed to create issue:", error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Failed to create issue in Jira");
    }
  }

  async updateIssue(
    issueId: string,
    data: UpdateIssueData
  ): Promise<IssueData> {
    const updatePayload: any = { fields: {} };

    if (data.title !== undefined) {
      updatePayload.fields.summary = data.title;
    }

    if (data.description !== undefined) {
      // Check if description is TipTap JSON
      if (
        typeof data.description === "object" &&
        data.description &&
        "type" in data.description &&
        data.description.type === "doc"
      ) {
        // Direct TipTap JSON to ADF conversion
        updatePayload.fields.description = this.tiptapToAdf(data.description);
      } else if (
        typeof data.description === "string" &&
        data.description.includes("<") &&
        data.description.includes(">")
      ) {
        // HTML string - use HTML to ADF converter
        updatePayload.fields.description = this.htmlToAdf(data.description);
      } else if (typeof data.description === "string") {
        // Plain text
        updatePayload.fields.description = {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: data.description,
                },
              ],
            },
          ],
        };
      }
    }

    if (data.priority !== undefined) {
      const mapped = JiraAdapter.mapPriorityField(data.priority);
      if (mapped) updatePayload.fields.priority = mapped;
    }

    if (data.assigneeId !== undefined) {
      updatePayload.fields.assignee =
        this.deployment === "server"
          ? { name: data.assigneeId }
          : { id: data.assigneeId };
    }

    if (data.labels !== undefined) {
      updatePayload.fields.labels = data.labels;
    }

    if (data.customFields) {
      Object.assign(updatePayload.fields, data.customFields);
    }

    await this.makeRequest<any>(this.buildUrl(`/rest/api/${this.apiVersion}/issue/${issueId}`), {
      method: "PUT",
      body: JSON.stringify(updatePayload),
    });

    // Handle status transition separately if provided
    if (data.status !== undefined) {
      await this.transitionIssue(issueId, data.status);
    }

    return this.getIssue(issueId);
  }

  async getIssue(issueId: string): Promise<IssueData> {
    // Explicitly request all fields we need, including issuetype with iconUrl
    const params = new URLSearchParams({
      fields:
        "summary,description,status,priority,issuetype,assignee,reporter,labels,created,updated",
      expand: "names,schema",
    });

    const response = await this.makeRequest<any>(
      this.buildUrl(`/rest/api/${this.apiVersion}/issue/${issueId}?${params.toString()}`)
    );

    return this.mapJiraIssue(response);
  }

  async getLinkedIssues(issueId: string): Promise<LinkedIssueRef[]> {
    try {
      const params = new URLSearchParams({
        fields: "issuelinks,parent,subtasks,customfield_10014",
      });
      const encodedId = encodeURIComponent(issueId);
      const response = await this.makeRequest<any>(
        this.buildUrl(`/rest/api/${this.apiVersion}/issue/${encodedId}?${params.toString()}`)
      );
      return this.mapLinkedIssues(response);
    } catch (error) {
      const status = this.parseStatusFromError(error);
      const level = status === null || status >= 500 ? "error" : "warn";
      console[level](
        `[JiraAdapter] getLinkedIssues failed for %s:`,
        issueId,
        error
      );
      return [];
    }
  }

  async getIssueComments(issueId: string): Promise<IssueComment[]> {
    try {
      const encodedId = encodeURIComponent(issueId);
      const response = await this.makeRequest<any>(
        this.buildUrl(`/rest/api/${this.apiVersion}/issue/${encodedId}/comment`)
      );
      return this.mapJiraComments(response);
    } catch (error) {
      const status = this.parseStatusFromError(error);
      const level = status === null || status >= 500 ? "error" : "warn";
      console[level](
        `[JiraAdapter] getIssueComments failed for %s:`,
        issueId,
        error
      );
      return [];
    }
  }

  async searchIssues(options: IssueSearchOptions): Promise<{
    issues: IssueData[];
    total: number;
    hasMore: boolean;
    nextPageToken?: string;
  }> {
    const jql: string[] = [];

    if (options.projectId) {
      jql.push(`project = ${options.projectId}`);
    }

    if (options.query) {
      const query = options.query.trim();
      const jqlConditions: string[] = [];

      // Check if the query looks like a complete issue key (contains hyphen and follows pattern)
      if (/^[A-Za-z]+-\d+$/.test(query)) {
        // Complete issue key - use exact match
        jqlConditions.push(`key = "${query.toUpperCase()}"`);
      }

      // Always include text search in summary and description
      jqlConditions.push(`summary ~ "${query}*"`);
      jqlConditions.push(`description ~ "${query}*"`);

      jql.push(`(${jqlConditions.join(" OR ")})`);
    }

    if (options.status && options.status.length > 0) {
      jql.push(`status IN (${options.status.map((s) => `"${s}"`).join(", ")})`);
    }

    if (options.assignee) {
      jql.push(`assignee = ${options.assignee}`);
    }

    if (options.labels && options.labels.length > 0) {
      jql.push(`labels IN (${options.labels.map((l) => `"${l}"`).join(", ")})`);
    }

    // Bulk-import recency window — restrict to issues touched within the last
    // N days. Jira's relative-date syntax (`-Nd`) keeps the query bounded.
    if (options.updatedWithinDays && options.updatedWithinDays > 0) {
      jql.push(`updated >= -${Math.floor(options.updatedWithinDays)}d`);
    }

    // Ensure the query is always bounded - Jira rejects unbounded queries
    let jqlString: string;
    if (jql.length > 0) {
      jqlString = jql.join(" AND ") + " ORDER BY created DESC";
    } else if (options.fullSync) {
      // Manual full sync without project filter - sync last year of issues
      // Jira requires bounded queries, so we use a generous 1-year window
      jqlString = "created >= -365d ORDER BY created DESC";
    } else {
      // Automatic/incremental sync - limit to last 30 days
      jqlString = "created >= -30d ORDER BY created DESC";
    }
    // Jira Cloud's enhanced search (`/rest/api/3/search/jql`) paginates by an
    // opaque `nextPageToken`, NOT `startAt`, and no longer returns a `total`.
    // (See Atlassian CHANGE-2046.) Passing `startAt` is silently ignored and
    // reading `response.total`/`response.startAt` yields `undefined` — which is
    // exactly why the pre-migration parsing reported 0 results / hasMore=false.
    const params = new URLSearchParams({
      jql: jqlString,
      maxResults: (options.limit || 50).toString(),
      fields:
        "summary,description,status,priority,issuetype,assignee,reporter,labels,created,updated",
    });
    if (options.pageToken) {
      params.set("nextPageToken", options.pageToken);
    }

    // Cloud exposes the enhanced JQL endpoint /search/jql; Server/Data
    // Center only ships the classic /search endpoint (same response shape).
    const searchPath =
      this.deployment === "server"
        ? `/rest/api/2/search?${params.toString()}`
        : `/rest/api/3/search/jql?${params.toString()}`;
    const searchUrl = this.buildUrl(searchPath);

    const response = await this.makeRequest<any>(searchUrl);

    const issues = (response.issues || []).map((issue: any) =>
      this.mapJiraIssue(issue)
    );
    const nextPageToken: string | undefined = response.nextPageToken;
    // Prefer the cursor / isLast flag the new endpoint provides; fall back to
    // the legacy total+startAt math only if the response still carries them
    // (older Server/DC instances), then to "a full page implies more".
    const hasMore =
      typeof response.isLast === "boolean"
        ? !response.isLast
        : nextPageToken
          ? true
          : typeof response.total === "number"
            ? (response.startAt || 0) + issues.length < response.total
            : issues.length >= (options.limit || 50);

    return {
      issues,
      // The new endpoint omits `total`; report the page count so callers that
      // read `total` get an honest number instead of NaN/undefined. Callers
      // needing an exact match count paginate via `nextPageToken`.
      total:
        typeof response.total === "number" ? response.total : issues.length,
      hasMore,
      nextPageToken,
    };
  }

  protected async addComment(issueId: string, comment: string): Promise<void> {
    await this.makeRequest(
      this.buildUrl(`/rest/api/${this.apiVersion}/issue/${issueId}/comment`),
      {
        method: "POST",
        body: JSON.stringify({
          body: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: comment,
                  },
                ],
              },
            ],
          },
        }),
      }
    );
  }

  private async transitionIssue(
    issueId: string,
    targetStatus: string
  ): Promise<void> {
    // Get available transitions
    const transitions = await this.makeRequest<any>(
      this.buildUrl(`/rest/api/${this.apiVersion}/issue/${issueId}/transitions`)
    );

    // Find the transition that leads to the target status
    const transition = transitions.transitions.find(
      (t: any) => t.to.name.toLowerCase() === targetStatus.toLowerCase()
    );

    if (!transition) {
      throw new Error(`No transition available to status: ${targetStatus}`);
    }

    // Execute the transition
    await this.makeRequest(
      this.buildUrl(`/rest/api/${this.apiVersion}/issue/${issueId}/transitions`),
      {
        method: "POST",
        body: JSON.stringify({
          transition: { id: transition.id },
        }),
      }
    );
  }

  private mapJiraIssue(jiraIssue: any): IssueData {
    // Validate that we have the required data structure
    if (!jiraIssue) {
      throw new Error("Invalid Jira issue: issue object is null or undefined");
    }
    if (!jiraIssue.fields) {
      throw new Error(
        `Invalid Jira issue ${jiraIssue.key || jiraIssue.id}: missing fields object`
      );
    }

    const fields = jiraIssue.fields;

    // Validate required fields
    if (!fields.summary) {
      throw new Error(
        `Invalid Jira issue ${jiraIssue.key || jiraIssue.id}: missing summary field`
      );
    }
    if (!fields.status) {
      throw new Error(
        `Invalid Jira issue ${jiraIssue.key || jiraIssue.id}: missing status field`
      );
    }

    return {
      id: jiraIssue.id,
      key: jiraIssue.key,
      title: fields.summary,
      description: this.extractDescription(fields.description),
      status: fields.status.name,
      priority: fields.priority?.name,
      issueType: fields.issuetype
        ? {
            id: fields.issuetype.id,
            name: fields.issuetype.name,
            iconUrl: fields.issuetype.iconUrl,
          }
        : undefined,
      assignee: fields.assignee
        ? {
            id: pickUserId(fields.assignee, this.deployment) ?? "",
            name: fields.assignee.displayName,
            email: fields.assignee.emailAddress,
          }
        : undefined,
      reporter: fields.reporter
        ? {
            id: pickUserId(fields.reporter, this.deployment) ?? "",
            name: fields.reporter.displayName,
            email: fields.reporter.emailAddress,
          }
        : undefined,
      labels: fields.labels || [],
      // Jira components: [{ self, id, name, description? }, ...]. Map to a
      // flat list of display names — that's what's useful as auto-tag
      // prompt context. Empty array when the issue has none.
      components: Array.isArray(fields.components)
        ? fields.components
            .map((c: any) => (typeof c?.name === "string" ? c.name : null))
            .filter((n: string | null): n is string => n !== null)
        : [],
      customFields: this.extractCustomFields(fields),
      createdAt: new Date(fields.created),
      updatedAt: new Date(fields.updated),
      url: `${jiraIssue.self.split("/rest/")[0]}/browse/${jiraIssue.key}`,
    };
  }

  private mapLinkedIssues(jiraIssue: any): LinkedIssueRef[] {
    const refs: LinkedIssueRef[] = [];
    const fields = jiraIssue?.fields ?? {};

    const issuelinks = Array.isArray(fields.issuelinks)
      ? fields.issuelinks
      : [];
    for (const link of issuelinks) {
      const linkType = link?.type?.name;
      if (typeof linkType !== "string") continue;
      if (link.outwardIssue && link.outwardIssue.id != null) {
        refs.push({
          id: String(link.outwardIssue.id),
          key: link.outwardIssue.key,
          linkType,
          direction: "outward",
        });
      } else if (link.inwardIssue && link.inwardIssue.id != null) {
        refs.push({
          id: String(link.inwardIssue.id),
          key: link.inwardIssue.key,
          linkType,
          direction: "inward",
        });
      }
    }

    if (fields.parent && fields.parent.id) {
      refs.push({
        id: String(fields.parent.id),
        key: fields.parent.key,
        linkType: "parent",
        direction: "inward",
      });
    }

    const subtasks = Array.isArray(fields.subtasks) ? fields.subtasks : [];
    for (const sub of subtasks) {
      if (!sub || !sub.id) continue;
      refs.push({
        id: String(sub.id),
        key: sub.key,
        linkType: "subtask",
        direction: "outward",
      });
    }

    const epicLink = fields.customfield_10014;
    if (typeof epicLink === "string" && epicLink.length > 0) {
      refs.push({
        id: epicLink,
        key: epicLink,
        linkType: "Epic-Link",
        direction: "inward",
      });
    }

    return refs;
  }

  private mapJiraComments(response: any): IssueComment[] {
    const comments = Array.isArray(response?.comments) ? response.comments : [];
    const out: IssueComment[] = [];
    for (const c of comments) {
      if (!c) continue;
      out.push({
        id: c.id != null ? String(c.id) : undefined,
        author:
          c.author?.displayName ??
          c.author?.emailAddress ??
          c.author?.accountId ??
          "Unknown",
        body: this.extractDescription(c.body) ?? "",
        created: c.created ?? "",
      });
    }
    return out;
  }

  private extractDescription(description: any): string | undefined {
    if (!description) return undefined;

    // Handle ADF (Atlassian Document Format)
    if (description.type === "doc" && description.content) {
      return this.adfToHtml(description.content);
    }

    // Handle plain text
    return description.toString();
  }

  private adfToHtml(content: any[]): string {
    let html = "";

    for (const node of content) {
      html += this.convertAdfNodeToHtml(node);
    }

    return html.trim();
  }

  private convertAdfNodeToHtml(node: any): string {
    if (!node) return "";

    switch (node.type) {
      case "paragraph":
        let paragraphContent = "";
        if (node.content) {
          paragraphContent = node.content
            .map((child: any) => this.convertAdfNodeToHtml(child))
            .join("");
        }
        return `<p>${paragraphContent}</p>`;

      case "heading":
        let headingContent = "";
        if (node.content) {
          headingContent = node.content
            .map((child: any) => this.convertAdfNodeToHtml(child))
            .join("");
        }
        const level = Math.min(node.attrs?.level || 1, 6);
        return `<h${level}>${headingContent}</h${level}>`;

      case "bulletList":
        let bulletListContent = "";
        if (node.content) {
          bulletListContent = node.content
            .map((child: any) => this.convertAdfNodeToHtml(child))
            .join("");
        }
        return `<ul>${bulletListContent}</ul>`;

      case "orderedList":
        let orderedListContent = "";
        if (node.content) {
          orderedListContent = node.content
            .map((child: any) => this.convertAdfNodeToHtml(child))
            .join("");
        }
        return `<ol>${orderedListContent}</ol>`;

      case "listItem":
        let itemContent = "";
        if (node.content) {
          // For list items, we need to handle nested content properly
          itemContent = node.content
            .map((child: any) => {
              // If it's a paragraph inside a list item, don't wrap it in <p> tags
              if (child.type === "paragraph") {
                return child.content
                  ? child.content
                      .map((grandChild: any) =>
                        this.convertAdfNodeToHtml(grandChild)
                      )
                      .join("")
                  : "";
              }
              return this.convertAdfNodeToHtml(child);
            })
            .join("");
        }
        return `<li>${itemContent}</li>`;

      case "blockquote":
        let quoteContent = "";
        if (node.content) {
          quoteContent = node.content
            .map((child: any) => this.convertAdfNodeToHtml(child))
            .join("");
        }
        return `<blockquote>${quoteContent}</blockquote>`;

      case "codeBlock":
        let codeContent = "";
        if (node.content) {
          codeContent = node.content
            .map((child: any) => {
              if (child.type === "text") {
                return child.text || "";
              }
              return this.convertAdfNodeToHtml(child);
            })
            .join("");
        }
        const language = node.attrs?.language || "";
        return `<pre><code${language ? ` class="language-${language}"` : ""}>${this.escapeHtml(codeContent)}</code></pre>`;

      case "text":
        let textContent = node.text || "";

        // Escape HTML entities first
        textContent = this.escapeHtml(textContent);

        // Apply marks (formatting)
        if (node.marks && Array.isArray(node.marks)) {
          for (const mark of node.marks) {
            switch (mark.type) {
              case "strong":
                textContent = `<strong>${textContent}</strong>`;
                break;
              case "em":
                textContent = `<em>${textContent}</em>`;
                break;
              case "underline":
                textContent = `<u>${textContent}</u>`;
                break;
              case "strike":
                textContent = `<s>${textContent}</s>`;
                break;
              case "code":
                textContent = `<code>${textContent}</code>`;
                break;
              case "link":
                const href = this.escapeHtml(mark.attrs?.href || "");
                textContent = `<a href="${href}" target="_blank" rel="noopener noreferrer">${textContent}</a>`;
                break;
            }
          }
        }

        return textContent;

      case "hardBreak":
        return "<br>";

      case "rule":
        return "<hr>";

      case "mention":
        // Handle user mentions
        const mentionText =
          node.attrs?.text || node.attrs?.displayName || "@user";
        return `<span class="mention">${this.escapeHtml(mentionText)}</span>`;

      case "emoji":
        // Handle emojis
        const emojiText = node.attrs?.shortName || node.attrs?.text || "";
        return this.escapeHtml(emojiText);

      case "table":
        let tableContent = "";
        if (node.content) {
          tableContent = node.content
            .map((child: any) => this.convertAdfNodeToHtml(child))
            .join("");
        }
        return `<table>${tableContent}</table>`;

      case "tableRow":
        let rowContent = "";
        if (node.content) {
          rowContent = node.content
            .map((child: any) => this.convertAdfNodeToHtml(child))
            .join("");
        }
        return `<tr>${rowContent}</tr>`;

      case "tableCell":
      case "tableHeader":
        let cellContent = "";
        if (node.content) {
          cellContent = node.content
            .map((child: any) => this.convertAdfNodeToHtml(child))
            .join("");
        }
        const tag = node.type === "tableHeader" ? "th" : "td";
        return `<${tag}>${cellContent}</${tag}>`;

      default:
        // For unknown types, try to extract content from children
        if (node.content) {
          return node.content
            .map((child: any) => this.convertAdfNodeToHtml(child))
            .join("");
        }
        // If it has text directly, return it escaped
        if (node.text) {
          return this.escapeHtml(node.text);
        }
        return "";
    }
  }

  private escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  async getIssueTypes(
    projectKey: string
  ): Promise<Array<{ id: string; name: string }>> {
    try {
      // First, get the project details to get available issue types
      const projectUrl = this.buildUrl(`/rest/api/${this.apiVersion}/project/${projectKey}`);
      const project = await this.makeRequest<any>(projectUrl);

      // Extract issue types from the project
      const issueTypes = project.issueTypes || [];

      return issueTypes.map((type: any) => ({
        id: type.id,
        name: type.name,
      }));
    } catch (error) {
      console.error("Failed to fetch issue types:", error);
      // If that fails, try to get all issue types and filter by project
      try {
        const allTypesUrl = this.buildUrl(`/rest/api/${this.apiVersion}/issuetype`);
        const allTypes = await this.makeRequest<any[]>(allTypesUrl);

        // For now, return all non-subtask issue types as a fallback
        return allTypes
          .filter((type: any) => !type.subtask)
          .map((type: any) => ({
            id: type.id,
            name: type.name,
          }));
      } catch (fallbackError) {
        console.error("Failed to fetch issue types (fallback):", fallbackError);
        throw new Error("Failed to fetch issue types from Jira");
      }
    }
  }

  async getIssueTypeFields(
    projectKey: string,
    issueTypeId: string
  ): Promise<any[]> {
    try {
      // Get create issue metadata for the specific issue type
      const url = this.buildUrl(
        `/rest/api/${this.apiVersion}/issue/createmeta?projectKeys=${projectKey}&issuetypeIds=${issueTypeId}&expand=projects.issuetypes.fields`
      );

      const metadata = await this.makeRequest<any>(url);

      // Extract fields from the response
      const project = metadata.projects?.[0];
      const issueType = project?.issuetypes?.[0];

      if (!issueType?.fields) {
        return [];
      }

      // Convert fields object to array and filter out system fields we handle separately
      const fields = Object.entries(issueType.fields)
        .filter(([key]) => {
          // Exclude fields we already handle in the UI
          const excludedFields = [
            "summary",
            "description",
            "issuetype",
            "project",
            "reporter",
          ];
          return !excludedFields.includes(key);
        })
        .map(([key, field]: [string, any]) => ({
          key,
          name: field.name,
          required: field.required || false,
          schema: field.schema,
          allowedValues: field.allowedValues,
          hasDefaultValue: field.hasDefaultValue || false,
          defaultValue: field.defaultValue,
          autoCompleteUrl: field.autoCompleteUrl,
        }));

      return fields;
    } catch (error) {
      console.error("Failed to fetch issue type fields:", error);
      return [];
    }
  }

  private extractCustomFields(fields: any): Record<string, any> {
    const customFields: Record<string, any> = {};

    // Extract fields that start with "customfield_"
    for (const [key, value] of Object.entries(fields)) {
      if (key.startsWith("customfield_") && value !== null) {
        customFields[key] = value;
      }
    }

    return customFields;
  }

  private tiptapToAdf(tiptapJson: any): any {
    // Convert TipTap JSON directly to Atlassian Document Format (ADF)
    const doc: any = {
      type: "doc",
      version: 1,
      content: [],
    };

    if (!tiptapJson || !tiptapJson.content) {
      return doc;
    }

    // Process each node in the TipTap content
    tiptapJson.content.forEach((node: any) => {
      const adfNode = this.convertTiptapNodeToAdf(node);
      if (adfNode) {
        doc.content.push(adfNode);
      }
    });

    // If no content was added, add empty paragraph
    if (doc.content.length === 0) {
      doc.content.push({
        type: "paragraph",
        content: [],
      });
    }

    return doc;
  }

  private convertTiptapNodeToAdf(node: any): any {
    if (!node) return null;

    switch (node.type) {
      case "paragraph":
        return {
          type: "paragraph",
          content: this.convertTiptapMarks(node.content || []),
        };

      case "heading":
        return {
          type: "heading",
          attrs: {
            level: node.attrs?.level || 1,
          },
          content: this.convertTiptapMarks(node.content || []),
        };

      case "bulletList":
        return {
          type: "bulletList",
          content: (node.content || [])
            .map((item: any) => this.convertTiptapNodeToAdf(item))
            .filter(Boolean),
        };

      case "orderedList":
        return {
          type: "orderedList",
          content: (node.content || [])
            .map((item: any) => this.convertTiptapNodeToAdf(item))
            .filter(Boolean),
        };

      case "listItem":
        return {
          type: "listItem",
          content: (node.content || [])
            .map((item: any) => this.convertTiptapNodeToAdf(item))
            .filter(Boolean),
        };

      case "blockquote":
        return {
          type: "blockquote",
          content: (node.content || [])
            .map((item: any) => this.convertTiptapNodeToAdf(item))
            .filter(Boolean),
        };

      case "codeBlock":
        return {
          type: "codeBlock",
          attrs: {
            language: node.attrs?.language || null,
          },
          content: [
            {
              type: "text",
              text: node.content?.map((c: any) => c.text || "").join("") || "",
            },
          ],
        };

      case "horizontalRule":
        return {
          type: "rule",
        };

      case "hardBreak":
        return {
          type: "hardBreak",
        };

      case "table":
        // ADF tables require the `attrs` block + tableRow children. Our
        // TipTap source (e.g. iterationIssueBodyBuilder) already shapes
        // cells as `tableCell{ content: [paragraph{ text }] }` which is
        // valid ADF — we just need to pass the structure through with
        // the right attrs envelope. Without this case, the default
        // fall-through wraps the table as a paragraph and Atlassian
        // rejects the doc with HTTP 400 "INVALID_INPUT".
        return {
          type: "table",
          attrs: {
            isNumberColumnEnabled: false,
            layout: "default",
          },
          content: (node.content || [])
            .map((item: any) => this.convertTiptapNodeToAdf(item))
            .filter(Boolean),
        };

      case "tableRow":
        return {
          type: "tableRow",
          content: (node.content || [])
            .map((item: any) => this.convertTiptapNodeToAdf(item))
            .filter(Boolean),
        };

      case "tableHeader":
      case "tableCell":
        return {
          type: node.type,
          // attrs intentionally omitted — Atlassian defaults colspan/
          // rowspan/colwidth/background to sensible values for new docs.
          // Cells in our source always contain a paragraph (see
          // iterationIssueBodyBuilder.tableCell/.tableHeader helpers),
          // so the conversion is a straight recursion.
          content: (node.content || [])
            .map((item: any) => this.convertTiptapNodeToAdf(item))
            .filter(Boolean),
        };

      case "text":
        // Text nodes are handled by convertTiptapMarks
        return null;

      default:
        // For unknown types, try to extract text content
        if (node.content) {
          return {
            type: "paragraph",
            content: this.convertTiptapMarks(node.content),
          };
        }
        return null;
    }
  }

  private convertTiptapMarks(content: any[]): any[] {
    if (!content || !Array.isArray(content)) return [];

    const result: any[] = [];

    content.forEach((node: any) => {
      if (node.type === "text") {
        const textNode: any = {
          type: "text",
          text: node.text || "",
        };

        // Convert TipTap marks to ADF marks
        if (node.marks && Array.isArray(node.marks)) {
          const adfMarks: any[] = [];

          node.marks.forEach((mark: any) => {
            switch (mark.type) {
              case "bold":
              case "strong":
                adfMarks.push({ type: "strong" });
                break;
              case "italic":
              case "em":
                adfMarks.push({ type: "em" });
                break;
              case "underline":
                adfMarks.push({ type: "underline" });
                break;
              case "strike":
                adfMarks.push({ type: "strike" });
                break;
              case "code":
                adfMarks.push({ type: "code" });
                break;
              case "link":
                adfMarks.push({
                  type: "link",
                  attrs: {
                    href: mark.attrs?.href || "",
                  },
                });
                break;
            }
          });

          if (adfMarks.length > 0) {
            textNode.marks = adfMarks;
          }
        }

        result.push(textNode);
      } else {
        // Handle nested nodes
        const converted = this.convertTiptapNodeToAdf(node);
        if (converted) {
          result.push(converted);
        }
      }
    });

    return result;
  }

  private htmlToAdf(html: string): any {
    // Enhanced HTML to ADF conversion for TipTap output
    const doc: any = {
      type: "doc",
      version: 1,
      content: [],
    };

    // Parse HTML more carefully to preserve formatting
    // Split by paragraphs first
    const paragraphs = html.split(/<\/p>|<\/h[1-6]>|<\/li>|<\/blockquote>/);

    paragraphs.forEach((paragraph) => {
      if (!paragraph.trim()) return;

      // Handle headings
      const headingMatch = paragraph.match(/<h([1-6])>/);
      if (headingMatch) {
        const level = parseInt(headingMatch[1]);
        const text = paragraph.replace(/<[^>]*>/g, "").trim();
        if (text) {
          doc.content.push({
            type: "heading",
            attrs: { level: Math.min(level, 6) },
            content: [
              {
                type: "text",
                text: text,
              },
            ],
          });
        }
        return;
      }

      // Handle lists
      if (paragraph.includes("<ul>") || paragraph.includes("<ol>")) {
        const listType = paragraph.includes("<ul>")
          ? "bulletList"
          : "orderedList";
        const listItems = paragraph.split(/<\/li>/);
        const listContent: any[] = [];

        listItems.forEach((item) => {
          const itemText = item.replace(/<[^>]*>/g, "").trim();
          if (itemText) {
            listContent.push({
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: itemText,
                    },
                  ],
                },
              ],
            });
          }
        });

        if (listContent.length > 0) {
          doc.content.push({
            type: listType,
            content: listContent,
          });
        }
        return;
      }

      // Handle blockquotes
      if (paragraph.includes("<blockquote>")) {
        const text = paragraph.replace(/<[^>]*>/g, "").trim();
        if (text) {
          doc.content.push({
            type: "blockquote",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: text,
                  },
                ],
              },
            ],
          });
        }
        return;
      }

      // Handle regular paragraphs with inline formatting
      const cleanedParagraph = paragraph.replace(/<p[^>]*>/, "");
      if (!cleanedParagraph.trim()) return;

      const paragraphContent: any[] = [];
      let remainingText = cleanedParagraph;

      // Process inline formatting
      while (remainingText.length > 0) {
        // Check for bold
        const boldMatch = remainingText.match(
          /<(strong|b)>(.*?)<\/(strong|b)>/
        );
        if (boldMatch) {
          const beforeText = remainingText
            .substring(0, boldMatch.index)
            .replace(/<[^>]*>/g, "");
          if (beforeText) {
            paragraphContent.push({ type: "text", text: beforeText });
          }
          paragraphContent.push({
            type: "text",
            text: boldMatch[2],
            marks: [{ type: "strong" }],
          });
          remainingText = remainingText.substring(
            boldMatch.index! + boldMatch[0].length
          );
          continue;
        }

        // Check for italic
        const italicMatch = remainingText.match(/<(em|i)>(.*?)<\/(em|i)>/);
        if (italicMatch) {
          const beforeText = remainingText
            .substring(0, italicMatch.index)
            .replace(/<[^>]*>/g, "");
          if (beforeText) {
            paragraphContent.push({ type: "text", text: beforeText });
          }
          paragraphContent.push({
            type: "text",
            text: italicMatch[2],
            marks: [{ type: "em" }],
          });
          remainingText = remainingText.substring(
            italicMatch.index! + italicMatch[0].length
          );
          continue;
        }

        // Check for underline
        const underlineMatch = remainingText.match(/<u>(.*?)<\/u>/);
        if (underlineMatch) {
          const beforeText = remainingText
            .substring(0, underlineMatch.index)
            .replace(/<[^>]*>/g, "");
          if (beforeText) {
            paragraphContent.push({ type: "text", text: beforeText });
          }
          paragraphContent.push({
            type: "text",
            text: underlineMatch[1],
            marks: [{ type: "underline" }],
          });
          remainingText = remainingText.substring(
            underlineMatch.index! + underlineMatch[0].length
          );
          continue;
        }

        // Check for code
        const codeMatch = remainingText.match(/<code>(.*?)<\/code>/);
        if (codeMatch) {
          const beforeText = remainingText
            .substring(0, codeMatch.index)
            .replace(/<[^>]*>/g, "");
          if (beforeText) {
            paragraphContent.push({ type: "text", text: beforeText });
          }
          paragraphContent.push({
            type: "text",
            text: codeMatch[1],
            marks: [{ type: "code" }],
          });
          remainingText = remainingText.substring(
            codeMatch.index! + codeMatch[0].length
          );
          continue;
        }

        // No more formatting, add the rest as plain text
        const plainText = remainingText.replace(/<[^>]*>/g, "").trim();
        if (plainText) {
          paragraphContent.push({ type: "text", text: plainText });
        }
        break;
      }

      if (paragraphContent.length > 0) {
        doc.content.push({
          type: "paragraph",
          content: paragraphContent,
        });
      }
    });

    // If no content was added, add empty paragraph
    if (doc.content.length === 0) {
      doc.content.push({
        type: "paragraph",
        content: [],
      });
    }

    return doc;
  }

  async searchUsers(
    query: string,
    projectKey?: string,
    startAt: number = 0,
    maxResults: number = 50
  ): Promise<
    | Array<{
        accountId: string;
        displayName: string;
        emailAddress?: string;
        avatarUrls?: any;
      }>
    | {
        users: Array<{
          accountId: string;
          displayName: string;
          emailAddress?: string;
          avatarUrls?: any;
        }>;
        total: number;
      }
  > {
    try {
      // console.log(`[JiraAdapter.searchUsers] Query: "${query}", ProjectKey: "${projectKey}", StartAt: ${startAt}, MaxResults: ${maxResults}`);

      // Check if query looks like an email address
      const isEmail = query.includes("@");
      // console.log(`[JiraAdapter.searchUsers] Is email search: ${isEmail}`);

      // Try multiple search approaches for better user matching
      const allUsers: any[] = [];

      // 1. First try email search if it's an email
      if (isEmail) {
        try {
          // Try the user/search endpoint with email
          const emailSearchUrl = this.buildUrl(
            `/rest/api/${this.apiVersion}/user/search?query=${encodeURIComponent(query)}&startAt=${startAt}&maxResults=${maxResults}`
          );
          // console.log(`[JiraAdapter.searchUsers] Trying email search: ${emailSearchUrl}`);
          const emailUsers = await this.makeRequest<any[]>(emailSearchUrl);
          allUsers.push(...emailUsers);

          // Also try searching by accountId with the email (sometimes works)
          const accountSearchUrl = this.buildUrl(
            `/rest/api/${this.apiVersion}/user/search?accountId=${encodeURIComponent(query)}`
          );
          // console.log(`[JiraAdapter.searchUsers] Trying account search with email: ${accountSearchUrl}`);
          try {
            const accountUsers =
              await this.makeRequest<any[]>(accountSearchUrl);
            allUsers.push(...accountUsers);
          } catch {
            // This might fail, that's ok
            // console.log(`[JiraAdapter.searchUsers] Account search failed (expected): ${e}`);
          }
        } catch {
          // console.log(`[JiraAdapter.searchUsers] Email search error: ${error}`);
        }
      }

      // 2. Try general search
      let endpoint: string;
      if (projectKey && !isEmail) {
        // Search assignable users for the project
        endpoint = `/rest/api/${this.apiVersion}/user/assignable/search?project=${projectKey}&query=${encodeURIComponent(query)}&startAt=${startAt}&maxResults=${maxResults}`;
      } else {
        // General user search
        endpoint = `/rest/api/${this.apiVersion}/user/search?query=${encodeURIComponent(query)}&startAt=${startAt}&maxResults=${maxResults}`;
      }

      // console.log(`[JiraAdapter.searchUsers] Using general endpoint: ${endpoint}`);
      const url = this.buildUrl(endpoint);
      const generalUsers = await this.makeRequest<any[]>(url);
      allUsers.push(...generalUsers);

      // Deduplicate users by their deployment-specific identifier
      // (accountId on Cloud, name/key on Server/Data Center).
      const uniqueUsers = new Map<string, any>();
      allUsers.forEach((user) => {
        const uid = pickUserId(user, this.deployment);
        if (uid && !uniqueUsers.has(uid)) {
          uniqueUsers.set(uid, user);
        }
      });

      const users = Array.from(uniqueUsers.values());
      // console.log(`[JiraAdapter.searchUsers] Total unique users found: ${users.length}`);

      const mappedUsers = users.map((user: any) => {
        const mapped = {
          accountId: pickUserId(user, this.deployment) ?? "",
          displayName: user.displayName,
          emailAddress: user.emailAddress,
          avatarUrls: user.avatarUrls,
        };
        // console.log(`[JiraAdapter.searchUsers] User: ${mapped.displayName} (${mapped.accountId}) - Email: ${mapped.emailAddress || 'NOT AVAILABLE'}`);
        return mapped;
      });

      // Return paginated result with total
      // Jira doesn't return total, so we estimate: if we got fewer than maxResults, we're at the end
      // Otherwise, assume there might be more pages
      const hasMore = mappedUsers.length >= maxResults;
      const estimatedTotal = hasMore
        ? startAt + mappedUsers.length + 1
        : startAt + mappedUsers.length;

      return {
        users: mappedUsers,
        total: estimatedTotal,
      };
    } catch (error) {
      console.error("[JiraAdapter.searchUsers] Failed to search users:", error);
      return { users: [], total: 0 };
    }
  }

  async getCurrentUser(): Promise<{
    accountId: string;
    displayName: string;
    emailAddress?: string;
  } | null> {
    try {
      // console.log(`[JiraAdapter.getCurrentUser] Getting current authenticated user`);
      const url = this.buildUrl(`/rest/api/${this.apiVersion}/myself`);
      const user = await this.makeRequest<any>(url);

      // console.log(`[JiraAdapter.getCurrentUser] Current user: ${user.displayName} (${user.accountId}) - Email: ${user.emailAddress || 'NOT AVAILABLE'}`);

      return {
        accountId: pickUserId(user, this.deployment) ?? "",
        displayName: user.displayName,
        emailAddress: user.emailAddress,
      };
    } catch (error) {
      console.error(
        "[JiraAdapter.getCurrentUser] Failed to get current user:",
        error
      );
      return null;
    }
  }
}
