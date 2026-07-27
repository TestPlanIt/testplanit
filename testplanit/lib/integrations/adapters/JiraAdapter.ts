import valkeyConnection from "~/lib/valkey";
import { BaseAdapter } from "./BaseAdapter";
import {
  AuthenticationData,
  CreateIssueData,
  ExternalMilestone,
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
  mapCustomFieldUserRefs,
  pickUserId,
  resolveAuthScheme,
  userRefField,
} from "./jiraDeployment";
import { adfToWikiMarkup } from "./jiraWikiMarkup";

/**
 * Board -> project ownership is near-static (boards rarely move between
 * projects), so a multi-hour TTL avoids a per-event upstream call during
 * sprint webhook bursts without risking long-lived staleness.
 */
const JIRA_BOARD_PROJECT_CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours

/**
 * Whether a board supports sprints is a property of its type (Scrum vs
 * Kanban) and effectively never changes for an existing board. Caching the
 * negative answer stops every sync pass from re-probing each Kanban board
 * (a guaranteed 400 + a warn log per board per pass).
 */
const JIRA_BOARD_NO_SPRINTS_CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * Upstream error bodies surface in UI alerts (search fan-out, import
 * picker warnings). Proxies/CDNs answer with full HTML error pages (e.g.
 * CloudFront 414 on an oversized JQL URL) — strip markup and truncate so
 * users see "HTTP 414: The request could not be satisfied…", not a page
 * of raw HTML.
 */
const UPSTREAM_ERROR_EXCERPT_MAX = 300;
function sanitizeUpstreamErrorBody(body: string): string {
  const text = /<[a-z!/][^>]*>/i.test(body)
    ? body
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : body.trim();
  return text.length > UPSTREAM_ERROR_EXCERPT_MAX
    ? `${text.slice(0, UPSTREAM_ERROR_EXCERPT_MAX)}…`
    : text;
}

/**
 * Jira integration adapter implementing OAuth authentication
 */
export class JiraAdapter extends BaseAdapter {
  public supportsOAuth = true;

  /**
   * BaseAdapter's default is 1000ms between every upstream request, which is
   * far more conservative than Jira's own limits and turns request COUNT into
   * the dominant cost of any fan-out. Milestone preview is the worst case: it
   * walks versions plus every board's sprints for every mapped Jira project,
   * so on a large site the throttle alone accounted for ~83s of a request that
   * a front-end proxy kills at 60s.
   *
   * 200ms (5 req/s) still paces us well under Atlassian's cost-based limits
   * for a single user's interactive request, while leaving real headroom.
   * Scoped to Jira deliberately — other providers keep the 1s default.
   */
  protected rateLimitDelay = 200;

  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private cloudId?: string;
  // Canonical site base (e.g. https://acme.atlassian.net) captured from the
  // OAuth accessible-resources response. OAuth requests go through the
  // api.atlassian.com/ex/jira/{cloudId} gateway, so a Jira issue's `self`
  // field echoes that gateway host — unusable for user-facing "open in Jira"
  // links. This holds the real site host for building browse/version URLs.
  private siteUrl?: string;
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
    if (
      config.deploymentType === "cloud" ||
      config.deploymentType === "server"
    ) {
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
      milestones: { kinds: ["RELEASE", "ITERATION"], webhooks: true },
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
      this.authScheme = resolveAuthScheme(
        this.authCreds,
        this.authSchemeOverride
      );
      this.baseUrl = baseUrl;

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
        // is NOT misread as a successful Cloud probe. With redirect: "manual",
        // server-side fetch (undici) returns the 3xx response itself, which
        // is non-OK; any non-OK v3 result (404, 401, or that 3xx) triggers
        // serverInfo detection.
        const v3Response = await fetch(`${this.baseUrl}/rest/api/3/myself`, {
          headers,
          redirect: "manual",
        });
        if (v3Response.ok) {
          this.deployment = "cloud";
          this.apiVersion = "3";
          this.deploymentResolved = true;
          this.apiKeyAuthActive = true;
        } else {
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
          } else if (!this.authCreds.email && !this.authCreds.username) {
            // serverInfo reports Cloud but v3 /myself failed. With no
            // email/username, the initial scheme guess was Bearer with a
            // bare token — Cloud's API-key auth only accepts Basic
            // email:apiToken, so that guess can never succeed here. Surface
            // this explicitly instead of an opaque 401/403.
            throw new Error(
              "Jira Cloud authentication requires an email address paired with the API token (Basic auth) — a bare API token alone cannot authenticate against Jira Cloud."
            );
          } else {
            // serverInfo reports Cloud but v3 /myself 404'd — surface the
            // original failure rather than silently switching versions.
            throw new Error(
              `Jira API authentication failed: ${v3Response.statusText}`
            );
          }
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
        // Keep the resource's canonical site URL so user-facing links point at
        // https://{site}.atlassian.net rather than the api.atlassian.com
        // gateway that all OAuth REST traffic is proxied through.
        this.siteUrl = resources[0].url;
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
      if (this.deployment === "server") {
        // DC: GET /project returns a bare array (no pagination wrapper)
        const data = await this.makeRequest<any>(
          this.buildUrl(`/rest/api/${this.apiVersion}/project`)
        );
        const projects = Array.isArray(data) ? data : [];
        return projects.map((project: any) => ({
          id: project.id,
          key: project.key,
          name: project.name,
        }));
      }
      // Cloud: GET /project/search returns { values: [...] }
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
   * Get OAuth authorization URL.
   *
   * Scopes span both of Atlassian's scope systems, because the two REST APIs
   * we call are governed separately:
   *
   *   - Jira platform (`/rest/api/{2,3}/...` — issues, JQL search, project
   *     versions, comments) is covered by the CLASSIC scopes, which Atlassian
   *     still recommends for the platform API.
   *   - Jira Software / Agile (`/rest/agile/1.0/board`, `.../board/{id}/sprint`
   *     — ITERATION milestone import and sprint webhook routing) does NOT
   *     support classic scopes at all ("Jira Software doesn't support classic
   *     scopes. Use granular scopes instead."). Without the granular trio
   *     below, every agile call fails with
   *     `401 {"code":401,"message":"Unauthorized; scope does not match"}`
   *     even though `read:jira-work` is present — the versions endpoint keeps
   *     working, so the failure looks selective. `read:project:jira` is
   *     required alongside the board scope for board discovery.
   *
   * These scopes must ALSO be enabled on the app in the Atlassian developer
   * console (Permissions → Jira Software API → Granular scopes); requesting a
   * scope the app doesn't hold fails at the authorize step. And because
   * Atlassian binds the granted scope set to the token at consent time and
   * carries it through every refresh, existing connections keep their old
   * scopes — admins must disconnect and re-authorize after this change.
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      audience: "api.atlassian.com",
      client_id: this.clientId,
      scope: [
        // Jira platform (classic)
        "read:jira-work",
        "write:jira-work",
        "read:jira-user",
        // Jira Software / Agile (granular — no classic equivalent exists)
        "read:board-scope:jira-software",
        "read:sprint:jira-software",
        "read:project:jira",
        // Refresh-token grant
        "offline_access",
      ].join(" "),
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
      headers["Authorization"] = buildAuthHeader(
        this.authCreds,
        this.authScheme
      );

      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `HTTP ${response.status}: ${sanitizeUpstreamErrorBody(errorText)}`
        );
      }

      // Jira returns 204 No Content for several write endpoints (issue
      // update, transition execution) — response.json() throws "Unexpected
      // end of JSON input" on the empty body. Short-circuit the common case
      // and fall back gracefully for any other empty-but-ok response.
      if (response.status === 204) {
        return undefined as T;
      }
      try {
        return await response.json();
      } catch (error) {
        if (error instanceof SyntaxError) {
          return undefined as T;
        }
        throw error;
      }
    }

    // Otherwise use the base class implementation for OAuth
    return super.makeRequest<T>(url, options);
  }

  async createIssue(data: CreateIssueData): Promise<IssueData> {
    // Determine if projectId is a key (e.g., "TPI") or an ID (numeric)
    const projectField = isNaN(Number(data.projectId))
      ? { key: data.projectId } // It's a project key
      : { id: data.projectId }; // It's a project ID

    // Convert the description to the format the deployment expects — Jira
    // Wiki Markup on Server/DC, ADF on Cloud (see toJiraContent).
    const descriptionField = this.toJiraContent(data.description);

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
          ? userRefField({ accountId: data.assigneeId }, this.deployment)
          : undefined,
        // Reporter is a system field, not a custom field — routed through
        // the same userRef mapper as assignee and user-picker custom fields
        // below so every user reference in the payload uses one rule.
        reporter: reporter
          ? userRefField(reporter as any, this.deployment)
          : undefined,
        labels: data.labels || [],
        ...mapCustomFieldUserRefs(otherCustomFields, this.deployment),
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
      // Jira Wiki Markup on Server/DC, ADF on Cloud (see toJiraContent).
      updatePayload.fields.description = this.toJiraContent(data.description);
    }

    if (data.priority !== undefined) {
      const mapped = JiraAdapter.mapPriorityField(data.priority);
      if (mapped) updatePayload.fields.priority = mapped;
    }

    if (data.assigneeId !== undefined) {
      updatePayload.fields.assignee = userRefField(
        { accountId: data.assigneeId },
        this.deployment
      );
    }

    if (data.labels !== undefined) {
      updatePayload.fields.labels = data.labels;
    }

    if (data.customFields) {
      Object.assign(
        updatePayload.fields,
        mapCustomFieldUserRefs(data.customFields, this.deployment)
      );
    }

    await this.makeRequest<any>(
      this.buildUrl(`/rest/api/${this.apiVersion}/issue/${issueId}`),
      {
        method: "PUT",
        body: JSON.stringify(updatePayload),
      }
    );

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
      // Server/Data Center stores descriptions as Jira Wiki Markup strings;
      // ask Jira to also return its own rendered HTML (renderedFields) so the
      // read side can surface formatting instead of raw markup. Cloud returns
      // ADF and is parsed by adfToHtml, so it doesn't need this.
      expand:
        this.deployment === "server"
          ? "names,schema,renderedFields"
          : "names,schema",
    });

    const response = await this.makeRequest<any>(
      this.buildUrl(
        `/rest/api/${this.apiVersion}/issue/${issueId}?${params.toString()}`
      )
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
        this.buildUrl(
          `/rest/api/${this.apiVersion}/issue/${encodedId}?${params.toString()}`
        )
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
      // On Server/Data Center, ask Jira to render each comment's wiki-markup
      // body to HTML (renderedBody) so formatting survives the read — same
      // reason as getIssue's renderedFields. Cloud bodies are ADF (parsed by
      // adfToHtml), so it doesn't need the expand.
      const commentPath =
        this.deployment === "server"
          ? `/rest/api/${this.apiVersion}/issue/${encodedId}/comment?expand=renderedBody`
          : `/rest/api/${this.apiVersion}/issue/${encodedId}/comment`;
      const response = await this.makeRequest<any>(this.buildUrl(commentPath));
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

  /**
   * Fetch RELEASE (project versions) and/or ITERATION (sprints, via board
   * auto-discovery) milestones for the given project. Routes through
   * `this.apiVersion` for the versions endpoint (v3 Cloud / v2 Server); the
   * Agile API (`/rest/agile/1.0/...`) is deployment-agnostic and never
   * versioned (Assumption A3).
   *
   * ITERATION discovers ALL boards for the project and fetches sprints from
   * each, deduping by sprint id (D5, locked design) — a Jira project can
   * have multiple boards (e.g. a Kanban + a Scrum board) whose sprint lists
   * overlap.
   *
   * Error semantics: a PARTIAL board failure degrades gracefully (sprints
   * from healthy boards are still returned), and a 404 from board discovery
   * is treated as "no agile support". But hard failures — versions endpoint
   * errors, board-discovery auth/server errors, or every board's sprint
   * fetch failing — PROPAGATE, so callers can distinguish a broken
   * connection from a genuinely empty result.
   */
  async getExternalMilestones(options: {
    projectKey: string;
    kind?: "RELEASE" | "ITERATION";
    includeClosed?: boolean;
    pageToken?: string;
  }): Promise<{
    items: ExternalMilestone[];
    hasMore: boolean;
    nextPageToken?: string;
  }> {
    const { projectKey, kind, includeClosed = false } = options;
    const items: ExternalMilestone[] = [];

    if (!kind || kind === "RELEASE") {
      items.push(...(await this.fetchJiraVersions(projectKey, includeClosed)));
    }

    if (!kind || kind === "ITERATION") {
      items.push(...(await this.fetchJiraSprints(projectKey, includeClosed)));
    }

    // Both fetches already ask Jira to exclude closed artifacts when
    // includeClosed is false, so this is a safety net rather than the primary
    // filter — it still catches anything an upstream filter classifies
    // differently than mapJiraVersion/mapJiraSprint do (and Server/DC
    // deployments that ignore the query parameters entirely).
    const filtered = includeClosed
      ? items
      : items.filter((item) => item.state !== "CLOSED");

    // Both upstream fetches page internally and return their full result
    // set (versions: numeric-scale per project; sprints: bounded by board
    // count), so there is nothing left to paginate at this level.
    return {
      items: filtered,
      hasMore: false,
    };
  }

  /**
   * RELEASE milestones: page through the project-versions endpoint
   * (offset-based startAt/maxResults/total per research Open Question 3)
   * and map each version to an ExternalMilestone.
   *
   * When closed artifacts aren't wanted, the filtering is pushed upstream via
   * `status=unreleased` rather than fetching everything and discarding it
   * locally. On a mature project that is the difference between a couple of
   * dozen pages and one: a real project here holds 1198 versions of which 10
   * are unreleased. Every page costs a full second of the BaseAdapter rate
   * limiter, so page count — not row count — is what decides whether the
   * preview beats the proxy's request timeout.
   *
   * `status` mirrors mapJiraVersion's CLOSED rule (archived or released), so
   * the two agree on which versions are omitted. Server/DC deployments that
   * don't honour the parameter simply return everything and fall back to the
   * caller's local filter.
   */
  private async fetchJiraVersions(
    projectKey: string,
    includeClosed: boolean
  ): Promise<ExternalMilestone[]> {
    const versions: ExternalMilestone[] = [];
    let startAt = 0;
    // Verified against Jira Cloud: the versions endpoint honours 100 per page,
    // halving the page count when the full history IS wanted.
    const maxResults = 100;

    try {
      while (true) {
        const params = new URLSearchParams({
          startAt: startAt.toString(),
          maxResults: maxResults.toString(),
          ...(includeClosed ? {} : { status: "unreleased" }),
        });
        const response = await this.makeRequest<any>(
          this.buildUrl(
            `/rest/api/${this.apiVersion}/project/${encodeURIComponent(
              projectKey
            )}/version?${params.toString()}`
          )
        );

        // Older Jira Server/DC deployments return a bare JSON array (the
        // non-paginated versions shape) instead of the `{ values, isLast }`
        // envelope — treat a bare array as a single, complete page.
        const isBareArray = Array.isArray(response);
        const pageValues: any[] = isBareArray
          ? response
          : Array.isArray(response?.values)
            ? response.values
            : [];
        for (const raw of pageValues) {
          const mapped = this.mapJiraVersion(raw, projectKey);
          if (mapped) versions.push(mapped);
        }

        const isLast = isBareArray
          ? true
          : typeof response?.isLast === "boolean"
            ? response.isLast
            : pageValues.length < maxResults;
        if (isLast || pageValues.length === 0) break;
        startAt += pageValues.length;
      }
    } catch (error) {
      const status = this.parseStatusFromError(error);
      const level = status === null || status >= 500 ? "error" : "warn";
      console[level](
        `[JiraAdapter] fetchJiraVersions failed for %s:`,
        projectKey,
        error
      );
      // Propagate instead of returning [] — an auth/permission/network
      // failure must be distinguishable from "project has no versions" so
      // callers can surface a real error instead of an empty picker.
      throw error;
    }

    return versions;
  }

  /**
   * Canonical site base for building user-facing links (browse pages, version
   * and sprint pages). Prefers the admin-entered baseUrl (API-key/Data Center);
   * falls back to the site URL captured from OAuth accessible-resources, which
   * is the only correct host for OAuth integrations since baseUrl is unset
   * there. Trailing slashes are stripped for clean concatenation.
   */
  private userFacingBaseUrl(): string {
    return (this.baseUrl ?? this.siteUrl ?? "").replace(/\/+$/, "");
  }

  private mapJiraVersion(
    raw: any,
    projectKey: string
  ): ExternalMilestone | null {
    if (!raw || raw.id == null) return null;

    const released = raw.released === true;
    const archived = raw.archived === true;
    let state: ExternalMilestone["state"];
    let rawState: string;
    if (archived) {
      state = "CLOSED";
      rawState = "archived";
    } else if (released) {
      state = "CLOSED";
      rawState = "released";
    } else {
      const startDate = raw.startDate ? new Date(raw.startDate) : undefined;
      const isFuture = !startDate || startDate.getTime() > Date.now();
      state = isFuture ? "FUTURE" : "ACTIVE";
      rawState = isFuture ? "future" : "active";
    }

    return {
      id: String(raw.id),
      kind: "RELEASE",
      name: raw.name ?? String(raw.id),
      description: raw.description,
      startDate: raw.startDate ? new Date(raw.startDate) : undefined,
      endDate: raw.releaseDate ? new Date(raw.releaseDate) : undefined,
      state,
      rawState,
      // raw.self is the REST resource (JSON) — link users to the project's
      // releases page for this version instead. Same path on Cloud and DC.
      url: `${this.userFacingBaseUrl()}/projects/${encodeURIComponent(projectKey)}/versions/${encodeURIComponent(String(raw.id))}`,
    };
  }

  /**
   * ITERATION milestones: discover every board for the project, fetch
   * sprints per board, and dedupe by sprint id (D5) since a Jira project
   * can have multiple boards whose sprint lists overlap.
   */
  private async fetchJiraSprints(
    projectKey: string,
    includeClosed: boolean
  ): Promise<ExternalMilestone[]> {
    const boardIds = await this.discoverJiraBoards(projectKey);
    const bySprintId = new Map<string, ExternalMilestone>();
    let failedBoards = 0;
    let firstBoardError: unknown = null;
    const integrationId = this.config?.integrationId;

    for (const boardId of boardIds) {
      // Skip boards already known to be sprint-less (Kanban) — fail-open on
      // any cache problem so a Valkey blip never hides sprints.
      const noSprintsKey =
        integrationId != null
          ? `jira-board-no-sprints:${integrationId}:${boardId}`
          : null;
      if (noSprintsKey && valkeyConnection) {
        try {
          if (await valkeyConnection.exists(noSprintsKey)) continue;
        } catch {
          // fall through to the live probe
        }
      }
      try {
        let startAt = 0;
        const maxResults = 50;
        while (true) {
          const params = new URLSearchParams({
            startAt: startAt.toString(),
            maxResults: maxResults.toString(),
            // Same upstream-filtering rationale as fetchJiraVersions, and it
            // matters more here because the cost is per BOARD: one board on a
            // long-running project carries 192 sprints (4 pages) of which 3
            // are active or future (1 page).
            ...(includeClosed ? {} : { state: "active,future" }),
          });
          const response = await this.makeRequest<any>(
            this.buildUrl(
              `/rest/agile/1.0/board/${boardId}/sprint?${params.toString()}`
            )
          );

          // Same bare-array tolerance as fetchJiraVersions — some Server/DC
          // responses omit the `{ values, isLast }` pagination envelope.
          const isBareArray = Array.isArray(response);
          const pageValues: any[] = isBareArray
            ? response
            : Array.isArray(response?.values)
              ? response.values
              : [];
          for (const raw of pageValues) {
            const mapped = this.mapJiraSprint(raw);
            if (mapped && !bySprintId.has(mapped.id)) {
              bySprintId.set(mapped.id, mapped);
            }
          }

          const isLast = isBareArray
            ? true
            : typeof response?.isLast === "boolean"
              ? response.isLast
              : pageValues.length < maxResults;
          if (isLast || pageValues.length === 0) break;
          startAt += pageValues.length;
        }
      } catch (error) {
        const status = this.parseStatusFromError(error);
        // A 400 from the sprint endpoint means the board type doesn't
        // support sprints (Kanban boards) — an expected per-board
        // condition, not a fetch failure. Skip it WITHOUT counting toward
        // failedBoards, so a project whose only board is Kanban still
        // previews its versions cleanly instead of erroring out.
        if (status === 400) {
          console.warn(
            `[JiraAdapter] board %s does not support sprints — skipped and cached (project %s)`,
            boardId,
            projectKey
          );
          if (noSprintsKey && valkeyConnection) {
            try {
              await valkeyConnection.set(
                noSprintsKey,
                "1",
                "EX",
                JIRA_BOARD_NO_SPRINTS_CACHE_TTL_SECONDS
              );
            } catch {
              // cache write failure just means we probe again next pass
            }
          }
          continue;
        }
        const level = status === null || status >= 500 ? "error" : "warn";
        console[level](
          `[JiraAdapter] fetchJiraSprints failed for board %s (project %s):`,
          boardId,
          projectKey,
          error
        );
        // Continue with remaining boards — a single board failure should
        // not drop sprints discovered on other boards.
        failedBoards += 1;
        if (firstBoardError === null) firstBoardError = error;
      }
    }

    // Partial board failures degrade gracefully, but when EVERY board fetch
    // failed the caller must see the failure — otherwise a credential or
    // permission problem is indistinguishable from "no sprints".
    if (boardIds.length > 0 && failedBoards === boardIds.length) {
      throw firstBoardError;
    }

    return Array.from(bySprintId.values());
  }

  /**
   * Board discovery for the project: `/rest/agile/1.0/board?projectKeyOrId=`,
   * paginated. Returns board ids only — sprint-fetching is done separately
   * per board so a single board's failure doesn't abort discovery of the
   * rest.
   */
  private async discoverJiraBoards(projectKey: string): Promise<string[]> {
    const boardIds: string[] = [];
    let startAt = 0;
    const maxResults = 50;

    try {
      while (true) {
        const params = new URLSearchParams({
          projectKeyOrId: projectKey,
          startAt: startAt.toString(),
          maxResults: maxResults.toString(),
        });
        const response = await this.makeRequest<any>(
          this.buildUrl(`/rest/agile/1.0/board?${params.toString()}`)
        );

        const pageValues: any[] = Array.isArray(response?.values)
          ? response.values
          : [];
        for (const board of pageValues) {
          if (board?.id != null) boardIds.push(String(board.id));
        }

        const isLast =
          typeof response?.isLast === "boolean"
            ? response.isLast
            : pageValues.length < maxResults;
        if (isLast || pageValues.length === 0) break;
        startAt += pageValues.length;
      }
    } catch (error) {
      const status = this.parseStatusFromError(error);
      if (status === 404) {
        // Agile API unavailable (no Jira Software on this instance) — treat
        // as "no boards" rather than a hard failure so RELEASE-only fetches
        // and kind-less previews still work.
        console.warn(
          `[JiraAdapter] discoverJiraBoards: agile API unavailable for %s:`,
          projectKey,
          error
        );
        return boardIds;
      }
      const level = status === null || status >= 500 ? "error" : "warn";
      console[level](
        `[JiraAdapter] discoverJiraBoards failed for %s:`,
        projectKey,
        error
      );
      // Propagate auth/permission/server failures so an empty sprint list
      // is never silently returned for a broken connection.
      throw error;
    }

    return boardIds;
  }

  /**
   * Resolve a single board's owning project — the INVERSE direction of
   * `discoverJiraBoards` (project -> boards). Sprint webhook payloads only
   * carry `originBoardId` (Pitfall 2), never a project reference, so
   * `applyInboundMilestoneEvent` needs this direct board -> project lookup
   * to resolve which TestPlanIt project a `sprint_*` event belongs to.
   *
   * `GET /rest/agile/1.0/board/{boardId}` returns `location.projectId` /
   * `location.projectKey` (RESEARCH.md A1 — MEDIUM confidence, verified via
   * multiple independent community payload examples, not a schema-verified
   * response contract). The parse is deliberately defensive: any absent or
   * differently-shaped `location` degrades to `null` (the D-03 unmatched/
   * ack-and-drop path) rather than a thrown error, since a malformed/legacy
   * response here must never surface as a 500 to the Jira webhook sender.
   *
   * Cached in Valkey (`jira-board-project:<integrationId>:<boardId>`, a
   * multi-hour TTL) since board->project ownership is near-static and a
   * cache hit avoids a per-event upstream call during sprint webhook bursts
   * (T-19-04-03). Fail-open without a Valkey connection — fetch directly,
   * skip caching, mirroring `MilestoneSyncService`'s lock-key idiom.
   */
  async resolveBoardProject(
    boardId: string
  ): Promise<{ projectId: string; projectKey: string } | null> {
    // Jira board ids are integers. `boardId` originates from webhook wire
    // input (sprint.originBoardId) and is interpolated into the REST path
    // and the cache key below — reject anything non-numeric here too
    // (defense in depth behind the extraction-time guard in
    // lib/webhooks/adapters/jira.ts) so this method can never be steered
    // into an authenticated request to an arbitrary path.
    if (!/^\d+$/.test(boardId)) {
      console.debug(
        `[JiraAdapter] resolveBoardProject: rejecting non-numeric board id %s`,
        boardId
      );
      return null;
    }

    const integrationId = this.config?.integrationId;
    const cacheKey =
      integrationId != null
        ? `jira-board-project:${integrationId}:${boardId}`
        : null;

    if (cacheKey) {
      try {
        const cached = await valkeyConnection?.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as {
            projectId: string;
            projectKey: string;
          };
        }
      } catch (error) {
        // Cache read failures (connection blip, bad JSON) fall through to a
        // direct upstream fetch — never let a cache problem block resolution.
        console.warn(
          `[JiraAdapter] resolveBoardProject: cache read failed for board %s:`,
          boardId,
          error
        );
      }
    }

    let response: any;
    try {
      response = await this.makeRequest<any>(
        this.buildUrl(`/rest/agile/1.0/board/${boardId}`)
      );
    } catch (error) {
      const status = this.parseStatusFromError(error);
      if (status === 404 || status === 403 || status === 401) {
        // Unmatched board / no permission — the D-03 ack-and-drop path.
        // Never throw for this; the caller acks the webhook and drops it.
        console.debug(
          `[JiraAdapter] resolveBoardProject: board %s not found/unauthorized (status %s)`,
          boardId,
          status
        );
        return null;
      }
      const level = status === null || status >= 500 ? "error" : "warn";
      console[level](
        `[JiraAdapter] resolveBoardProject failed for board %s:`,
        boardId,
        error
      );
      return null;
    }

    const projectId = response?.location?.projectId;
    const projectKey = response?.location?.projectKey;
    if (typeof projectId !== "string" && typeof projectId !== "number") {
      console.debug(
        `[JiraAdapter] resolveBoardProject: board %s response missing location.projectId — treating as unmatched`,
        boardId
      );
      return null;
    }

    const result = {
      projectId: String(projectId),
      projectKey: typeof projectKey === "string" ? projectKey : "",
    };

    if (cacheKey && valkeyConnection) {
      try {
        await valkeyConnection.set(
          cacheKey,
          JSON.stringify(result),
          "EX",
          JIRA_BOARD_PROJECT_CACHE_TTL_SECONDS
        );
      } catch (error) {
        console.warn(
          `[JiraAdapter] resolveBoardProject: cache write failed for board %s:`,
          boardId,
          error
        );
      }
    }

    return result;
  }

  private mapJiraSprint(raw: any): ExternalMilestone | null {
    if (!raw || raw.id == null) return null;

    const rawState =
      typeof raw.state === "string" ? raw.state.toLowerCase() : undefined;
    let state: ExternalMilestone["state"];
    switch (rawState) {
      case "closed":
        state = "CLOSED";
        break;
      case "active":
        state = "ACTIVE";
        break;
      case "future":
      default:
        state = "FUTURE";
        break;
    }

    return {
      id: String(raw.id),
      kind: "ITERATION",
      name: raw.name ?? String(raw.id),
      description: raw.goal,
      startDate: raw.startDate ? new Date(raw.startDate) : undefined,
      endDate: raw.endDate ? new Date(raw.endDate) : undefined,
      state,
      rawState,
      // Sprints have no user-facing permalink in their payload; the origin
      // board is the closest stable target. RapidBoard.jspa is a
      // deployment-agnostic redirect (Cloud forwards to the modern board
      // UI; Server/DC serves it directly).
      ...(raw.originBoardId != null
        ? {
            url: `${this.userFacingBaseUrl()}/secure/RapidBoard.jspa?rapidView=${encodeURIComponent(String(raw.originBoardId))}&sprint=${encodeURIComponent(String(raw.id))}`,
          }
        : {}),
    };
  }

  /**
   * Shared executor for a bounded JQL search. The Cloud/Server dialect split
   * lives here so every JQL-backed read (searchIssues, getMilestoneIssues)
   * paginates identically and can never drift:
   *
   *   - Cloud ships the enhanced `/rest/api/3/search/jql` endpoint — an opaque
   *     `nextPageToken` cursor and `isLast`, and no `total` (Atlassian
   *     CHANGE-2046). Passing `startAt` is silently ignored.
   *   - Server/Data Center only ships the classic `/rest/api/2/search`
   *     endpoint — it pages by `startAt`, returns `total`/`startAt`, and has no
   *     cursor of its own, so a startAt-based `nextPageToken` is synthesized
   *     (the deployment accepts an incoming pageToken back as `startAt`).
   *
   * The caller supplies a complete JQL string (including any ORDER BY); this
   * only layers on pagination and the shared field set.
   */
  private async runJqlSearch(
    jqlString: string,
    options?: { pageToken?: string; limit?: number }
  ): Promise<{
    issues: IssueData[];
    total: number;
    hasMore: boolean;
    nextPageToken?: string;
  }> {
    const params = new URLSearchParams({
      jql: jqlString,
      maxResults: (options?.limit || 50).toString(),
      // `parent` included (D-14) so every synced-issue path captures hierarchy
      // the same way for buildSyncedIssueData.
      fields:
        "summary,description,status,priority,issuetype,assignee,reporter,labels,created,updated,parent",
    });
    if (options?.pageToken) {
      if (this.deployment === "server") {
        // DC pages by startAt (see the synthesized nextPageToken below).
        params.set("startAt", options.pageToken);
      } else {
        params.set("nextPageToken", options.pageToken);
      }
    }

    const searchPath =
      this.deployment === "server"
        ? `/rest/api/2/search?${params.toString()}`
        : `/rest/api/3/search/jql?${params.toString()}`;
    const response = await this.makeRequest<any>(this.buildUrl(searchPath));

    const issues = (response.issues || []).map((issue: any) =>
      this.mapJiraIssue(issue)
    );
    // Prefer the cursor / isLast flag the enhanced endpoint provides; fall back
    // to the legacy total+startAt math (Server/DC), then to "a full page
    // implies more".
    const cloudNextPageToken: string | undefined = response.nextPageToken;
    const hasMore =
      typeof response.isLast === "boolean"
        ? !response.isLast
        : cloudNextPageToken
          ? true
          : typeof response.total === "number"
            ? (response.startAt || 0) + issues.length < response.total
            : issues.length >= (options?.limit || 50);
    // Server/DC's classic /search has no cursor of its own — synthesize a
    // startAt one so callers that only advance via pageToken don't re-read
    // page 1 forever.
    const nextPageToken =
      cloudNextPageToken ??
      (this.deployment === "server" && hasMore
        ? String((response.startAt ?? 0) + issues.length)
        : undefined);

    return {
      issues,
      // The enhanced endpoint omits `total`; report the page count so callers
      // reading `total` get an honest number instead of NaN/undefined. Exact
      // match counts come from paginating via `nextPageToken`.
      total:
        typeof response.total === "number" ? response.total : issues.length,
      hasMore,
      nextPageToken,
    };
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
    return this.runJqlSearch(jqlString, {
      pageToken: options.pageToken,
      limit: options.limit,
    });
  }

  /**
   * Membership fetch for a milestone (Jira Fix Version / Sprint). Builds the
   * fixVersion=/sprint= JQL clause and delegates to the shared runJqlSearch
   * executor, so it inherits the same Cloud/Server pagination dialect as
   * searchIssues. It stays a distinct method rather than a searchIssues option
   * because that clause has no equivalent hook in searchIssues' filter set
   * (D-14 / interfaces lock, IssueAdapter.ts:271-279).
   */
  async getMilestoneIssues(
    ref: { id: string; kind: "RELEASE" | "ITERATION" },
    options?: { pageToken?: string; limit?: number }
  ): Promise<{
    issues: IssueData[];
    total?: number;
    hasMore: boolean;
    nextPageToken?: string;
  }> {
    // fixVersion / sprint membership resolves identically on Cloud and
    // Server/Data Center — same JQL fields, only the search endpoint and
    // pagination dialect differ, both handled by runJqlSearch. `sprint` JQL
    // requires the Jira Software (Agile) plugin, which is present on any
    // instance that surfaces sprints at all (same assumption as the versions/
    // sprints discovery path). The ORDER BY keeps DC's startAt paging
    // deterministic across pages.
    const jqlClause =
      ref.kind === "RELEASE"
        ? `fixVersion = ${ref.id} ORDER BY created DESC`
        : `sprint = ${ref.id} ORDER BY created DESC`;

    return this.runJqlSearch(jqlClause, options);
  }

  protected async addComment(issueId: string, comment: string): Promise<void> {
    // Comment bodies are the same rich-text grammar as descriptions — wiki
    // markup on Server/DC, ADF on Cloud — so they run through the same
    // conversion. Today's only caller (linkToTestCase) passes plain text,
    // which converts to itself on DC and a single ADF paragraph on Cloud;
    // routing it through toJiraContent keeps comments from being the one
    // rich-text field locked to plain text if a caller ever sends more.
    const body = { body: this.toJiraContent(comment) };

    await this.makeRequest(
      this.buildUrl(`/rest/api/${this.apiVersion}/issue/${issueId}/comment`),
      {
        method: "POST",
        body: JSON.stringify(body),
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
      this.buildUrl(
        `/rest/api/${this.apiVersion}/issue/${issueId}/transitions`
      ),
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
      description: this.extractDescription(
        fields.description,
        jiraIssue.renderedFields?.description
      ),
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
      // Parent ref (D-14): mirrors the mapLinkedIssues guard below — only
      // set when the source issue actually has a parent (sub-task / epic
      // child). Requires the request's `fields` param to include `parent`.
      parent:
        fields.parent && fields.parent.id
          ? { id: String(fields.parent.id), key: fields.parent.key }
          : undefined,
      createdAt: new Date(fields.created),
      updatedAt: new Date(fields.updated),
      // Prefer the canonical site base. Under OAuth, jiraIssue.self points at
      // the api.atlassian.com/ex/jira/{cloudId} gateway, so splitting it would
      // yield a broken "open in Jira" link; userFacingBaseUrl() resolves to the
      // real site host. Fall back to the self-derived host only when no base is
      // known (defensive — should not happen for authenticated adapters).
      url: this.userFacingBaseUrl()
        ? `${this.userFacingBaseUrl()}/browse/${jiraIssue.key}`
        : `${jiraIssue.self.split("/rest/")[0]}/browse/${jiraIssue.key}`,
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
        body: this.extractDescription(c.body, c.renderedBody) ?? "",
        created: c.created ?? "",
      });
    }
    return out;
  }

  private extractDescription(
    description: any,
    renderedHtml?: string
  ): string | undefined {
    // Server/Data Center returns rich text as Jira Wiki Markup; when the read
    // asked Jira to render it (renderedFields / renderedBody), prefer that
    // HTML so formatting survives instead of surfacing raw markup like
    // "*bold*". Cloud never passes this, so its ADF path below is untouched.
    if (typeof renderedHtml === "string") {
      return renderedHtml.trim() || undefined;
    }

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
      const projectUrl = this.buildUrl(
        `/rest/api/${this.apiVersion}/project/${projectKey}`
      );
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
        const allTypesUrl = this.buildUrl(
          `/rest/api/${this.apiVersion}/issuetype`
        );
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
      let url: string;
      let fieldsObj: Record<string, any> | undefined;

      if (this.deployment === "server") {
        // DC: GET /issue/createmeta/{key}/issuetypes/{id} returns a paginated
        // { values: [{ fieldId, name, required, schema, ... }] } array.
        // Convert to the same { fieldId: fieldData } shape Cloud uses.
        url = this.buildUrl(
          `/rest/api/${this.apiVersion}/issue/createmeta/${projectKey}/issuetypes/${issueTypeId}`
        );
        const metadata = await this.makeRequest<any>(url);
        const vals = Array.isArray(metadata?.values) ? metadata.values : [];
        fieldsObj = {};
        for (const v of vals) {
          if (v.fieldId) {
            fieldsObj[v.fieldId] = v;
          }
        }
      } else {
        // Cloud: GET /issue/createmeta?projectKeys=...&issuetypeIds=...&expand=...
        url = this.buildUrl(
          `/rest/api/${this.apiVersion}/issue/createmeta?projectKeys=${projectKey}&issuetypeIds=${issueTypeId}&expand=projects.issuetypes.fields`
        );
        const metadata = await this.makeRequest<any>(url);
        const project = metadata.projects?.[0];
        const issueType = project?.issuetypes?.[0];
        fieldsObj = issueType?.fields;
      }

      if (!fieldsObj) {
        return [];
      }

      // Convert fields object to array and filter out system fields we handle separately
      const fields = Object.entries(fieldsObj)
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

  /**
   * Convert rich-text content into the shape the deployment stores in a
   * rich-text field. Used for BOTH issue descriptions and comment bodies —
   * they share one grammar per deployment, so the conversion lives in one
   * place rather than being duplicated (or, worse, applied to descriptions
   * only). Input may be the rich-text editor's TipTap/ADF doc, an HTML
   * string, or a bare string.
   *
   * - Server/Data Center → Jira Wiki Markup (a plain string). TipTap/HTML
   *   normalize through the same converters Cloud uses, then serialize to
   *   wiki markup; a bare string is already valid wiki markup and passes
   *   through unchanged. Empty input yields "" — DC rejects a null value
   *   ("Operation value must be a string").
   * - Cloud → an ADF document, or null for empty input (Cloud reads null as
   *   "no value").
   */
  private toJiraContent(input: unknown): any {
    const isDoc =
      typeof input === "object" &&
      input !== null &&
      (input as { type?: string }).type === "doc";
    const isHtml =
      typeof input === "string" && input.includes("<") && input.includes(">");

    if (this.deployment === "server") {
      if (!input) return "";
      if (isDoc) return adfToWikiMarkup(this.tiptapToAdf(input));
      if (typeof input === "string") {
        return isHtml ? adfToWikiMarkup(this.htmlToAdf(input)) : input;
      }
      return String(input);
    }

    // Cloud (ADF)
    if (!input) return null;
    if (isDoc) return this.tiptapToAdf(input);
    if (isHtml) return this.htmlToAdf(input as string);
    if (typeof input === "string") {
      return {
        type: "doc",
        version: 1,
        content: [
          { type: "paragraph", content: [{ type: "text", text: input }] },
        ],
      };
    }
    return null;
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
            `/rest/api/${this.apiVersion}/user/search?${this.deployment === "server" ? "username" : "query"}=${encodeURIComponent(query)}&startAt=${startAt}&maxResults=${maxResults}`
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
        // Search assignable users for the project. Server/DC filters this
        // endpoint by `username` and silently ignores the Cloud-only
        // `query` param (verified on DC 10.3.13: query= returns the full
        // unfiltered assignable list).
        const userParam = this.deployment === "server" ? "username" : "query";
        endpoint = `/rest/api/${this.apiVersion}/user/assignable/search?project=${projectKey}&${userParam}=${encodeURIComponent(query)}&startAt=${startAt}&maxResults=${maxResults}`;
      } else {
        // General user search
        endpoint = `/rest/api/${this.apiVersion}/user/search?${this.deployment === "server" ? "username" : "query"}=${encodeURIComponent(query)}&startAt=${startAt}&maxResults=${maxResults}`;
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
