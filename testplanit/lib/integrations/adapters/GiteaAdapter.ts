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

export class GiteaAdapter extends BaseAdapter {
  public supportsOAuth = true;

  private owner?: string;
  private repo?: string;
  private baseUrl: string = "";

  // OAuth client credentials, plumbed per-integration by IntegrationManager.
  private clientId?: string;
  private clientSecret?: string;
  private redirectUri?: string;

  constructor(config: any) {
    super(config);
    if (config.owner) this.owner = config.owner;
    if (config.repo) this.repo = config.repo;
    // The config form stores the instance URL as `instanceUrl`; accept either
    // key so OAuth endpoints and API calls hit the right self-hosted instance.
    const instance = config.baseUrl || config.instanceUrl;
    if (instance) this.baseUrl = instance.replace(/\/$/, "");

    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.redirectUri = config.redirectUri;
  }

  getCapabilities(): IssueAdapterCapabilities {
    return {
      createIssue: true,
      updateIssue: true,
      linkIssue: true,
      syncIssue: true,
      searchIssues: true,
      webhooks: true,
      customFields: false,
      attachments: false,
      linkedIssues: false,
      comments: true,
      milestones: false,
    };
  }

  protected async performAuthentication(
    authData: AuthenticationData
  ): Promise<void> {
    if (authData.baseUrl) {
      this.baseUrl = authData.baseUrl.replace(/\/$/, "");
    }
    if (!this.baseUrl) {
      throw new Error(
        "Gitea instance URL is required (e.g. https://gitea.example.com)"
      );
    }

    if (authData.type === "oauth") {
      if (!authData.accessToken) {
        throw new Error("Gitea OAuth authentication requires an access token");
      }
      // makeRequest sends `Authorization: Bearer <token>` for the oauth auth
      // type, which Gitea/Forgejo accept for OAuth access tokens.
      try {
        await this.makeRequest(`${this.baseUrl}/api/v1/user`);
      } catch {
        throw new Error("Invalid Gitea OAuth access token or instance URL");
      }
      return;
    }

    if (authData.type !== "api_key") {
      throw new Error(
        "Gitea adapter only supports OAuth and Personal Access Token authentication"
      );
    }
    if (!authData.apiKey) {
      throw new Error(
        "Personal Access Token is required for Gitea authentication"
      );
    }
    try {
      await this.makeRequest(`${this.baseUrl}/api/v1/user`);
    } catch {
      throw new Error("Invalid Gitea Personal Access Token or instance URL");
    }
  }

  /**
   * Build the OAuth authorization URL the user is redirected to for consent.
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId || "",
      redirect_uri: this.redirectUri || "",
      response_type: "code",
      state,
    });
    return `${this.baseUrl}/login/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange the authorization code for access and refresh tokens.
   */
  async exchangeCodeForTokens(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    return this.requestToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri || "",
    });
  }

  /**
   * Refresh an expired access token using the stored refresh token.
   */
  async refreshTokens(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    return this.requestToken({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  }

  private async requestToken(extra: Record<string, string>): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    const response = await fetch(`${this.baseUrl}/login/oauth/access_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        ...extra,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to obtain Gitea tokens: ${error}`);
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

  async createIssue(data: CreateIssueData): Promise<IssueData> {
    const { owner, repo } = this.resolveRepo(data.projectId);
    const payload: Record<string, any> = {
      title: data.title,
      body: typeof data.description === "string" ? data.description : "",
    };
    if (data.labels && data.labels.length > 0) {
      payload.labels = data.labels;
    }
    if (data.assigneeId) payload.assignees = [data.assigneeId];
    const response = await this.makeRequest<any>(
      `${this.baseUrl}/api/v1/repos/${owner}/${repo}/issues`,
      { method: "POST", body: JSON.stringify(payload) }
    );
    return this.mapGiteaIssue(response, owner, repo);
  }

  async updateIssue(
    issueId: string,
    data: UpdateIssueData
  ): Promise<IssueData> {
    const { owner, repo, number } = this.parseIssueRef(issueId);
    const payload: Record<string, any> = {};
    if (data.title !== undefined) payload.title = data.title;
    if (data.description !== undefined) {
      payload.body =
        typeof data.description === "string" ? data.description : "";
    }
    if (data.status !== undefined) {
      payload.state = this.mapStatusToGitea(data.status);
    }
    if (data.assigneeId !== undefined) {
      payload.assignees = [data.assigneeId];
    }
    const response = await this.makeRequest<any>(
      `${this.baseUrl}/api/v1/repos/${owner}/${repo}/issues/${number}`,
      { method: "PATCH", body: JSON.stringify(payload) }
    );
    return this.mapGiteaIssue(response, owner, repo);
  }

  async getIssue(issueId: string): Promise<IssueData> {
    const { owner, repo, number } = this.parseIssueRef(issueId);
    const response = await this.makeRequest<any>(
      `${this.baseUrl}/api/v1/repos/${owner}/${repo}/issues/${number}`
    );
    return this.mapGiteaIssue(response, owner, repo);
  }

  async searchIssues(options: IssueSearchOptions): Promise<{
    issues: IssueData[];
    total: number;
    hasMore: boolean;
  }> {
    const { owner, repo } = this.resolveRepo(options.projectId);
    const params = new URLSearchParams({
      type: "issues",
      limit: (options.limit || 30).toString(),
      page: Math.floor(
        (options.offset || 0) / (options.limit || 30) + 1
      ).toString(),
    });
    if (options.query) {
      // Key format: "owner/repo#number" — fetch the specific issue directly
      const keyMatch = options.query.match(/^.+#(\d+)$/);
      if (keyMatch) {
        try {
          const issue = await this.makeRequest<any>(
            `${this.baseUrl}/api/v1/repos/${owner}/${repo}/issues/${keyMatch[1]}`
          );
          const mapped = this.mapGiteaIssue(issue, owner, repo);
          return { issues: [mapped], total: 1, hasMore: false };
        } catch {
          return { issues: [], total: 0, hasMore: false };
        }
      }
      params.set("q", options.query);
    }
    if (options.assignee) params.set("assigned_by", options.assignee);
    if (options.status && options.status.length > 0) {
      const state = options.status[0].toLowerCase();
      params.set(
        "state",
        state === "closed" || state === "done" || state === "resolved"
          ? "closed"
          : "open"
      );
    }
    const response = await this.makeRequest<any[]>(
      `${this.baseUrl}/api/v1/repos/${owner}/${repo}/issues?${params.toString()}`
    );
    const issues = Array.isArray(response) ? response : [];
    const limit = options.limit || 30;
    return {
      issues: issues.map((issue) => this.mapGiteaIssue(issue, owner, repo)),
      total: issues.length,
      hasMore: issues.length === limit,
    };
  }

  async getIssueComments(issueId: string): Promise<IssueComment[]> {
    try {
      const { owner, repo, number } = this.parseIssueRef(issueId);
      const response = await this.makeRequest<any[]>(
        `${this.baseUrl}/api/v1/repos/${owner}/${repo}/issues/${number}/comments?limit=50`
      );
      if (!Array.isArray(response)) return [];
      return response.map((c) => ({
        id: c.id != null ? String(c.id) : undefined,
        author: c.user?.login || "Unknown",
        body: c.body ?? "",
        created: c.created ?? "",
      }));
    } catch (error) {
      const status = this.parseStatusFromError(error);
      const level = status === null || status >= 500 ? "error" : "warn";
      console[level](
        `[GiteaAdapter] getIssueComments failed for %s:`,
        issueId,
        error
      );
      return [];
    }
  }

  async getLinkedIssues(_issueId: string): Promise<LinkedIssueRef[]> {
    return [];
  }

  async getProjects(): Promise<
    Array<{ id: string; key: string; name: string }>
  > {
    const params = new URLSearchParams({ limit: "50", token: "" });
    const response = await this.makeRequest<{ data?: any[] }>(
      `${this.baseUrl}/api/v1/repos/search?${params.toString()}`
    );
    const repos = Array.isArray(response) ? response : (response?.data ?? []);
    return repos.map((r) => ({
      id: r.full_name,
      key: r.name,
      name: r.full_name,
    }));
  }

  /**
   * Gitea models no issue types — repository LABELS are the designation
   * vocabulary this adapter serves through the issue-type contract, same
   * as GitHub's. `id === name` deliberately: a label reaches issue
   * payloads (`mapGiteaIssue`'s `labels`) only as its name, so the name
   * is the only join key classification can use. Paged to three pages
   * (300 labels), past the requirement-config selection cap of 200; Gitea
   * list endpoints page with `limit`/`page` (`per_page` is ignored and
   * would truncate at the 30-row default). Org-owned repos can also carry
   * ORGANIZATION labels, which appear on issues but are not served by the
   * repo labels endpoint — union them in; the org endpoint 404s for
   * user-owned repos, so its failure is silently tolerated.
   */
  async getIssueTypes(
    projectKey: string
  ): Promise<Array<{ id: string; name: string }>> {
    const { owner, repo } = this.resolveRepo(projectKey);

    const names = new Set<string>();
    const collect = (pageLabels: any[]) => {
      for (const label of pageLabels) {
        if (typeof label?.name === "string" && label.name !== "") {
          names.add(label.name);
        }
      }
    };

    for (let page = 1; page <= 3; page++) {
      const pageLabels = await this.makeRequest<any[]>(
        `${this.baseUrl}/api/v1/repos/${owner}/${repo}/labels?limit=100&page=${page}`
      );
      collect(Array.isArray(pageLabels) ? pageLabels : []);
      if (!Array.isArray(pageLabels) || pageLabels.length < 100) {
        break;
      }
    }

    try {
      for (let page = 1; page <= 3; page++) {
        const pageLabels = await this.makeRequest<any[]>(
          `${this.baseUrl}/api/v1/orgs/${owner}/labels?limit=100&page=${page}`
        );
        collect(Array.isArray(pageLabels) ? pageLabels : []);
        if (!Array.isArray(pageLabels) || pageLabels.length < 100) {
          break;
        }
      }
    } catch {
      // User-owned repo (or org labels unreadable) — repo labels suffice.
    }

    return Array.from(names, (name) => ({ id: name, name }));
  }

  async searchUsers(query: string): Promise<
    Array<{
      accountId: string;
      displayName: string;
      emailAddress?: string;
    }>
  > {
    const params = new URLSearchParams({ q: query, limit: "20" });
    const response = await this.makeRequest<any[]>(
      `${this.baseUrl}/api/v1/users/search?${params.toString()}`
    );
    const users = Array.isArray(response)
      ? response
      : ((response as any)?.data ?? []);
    return users.map((u: any) => ({
      accountId: u.login,
      displayName: u.full_name || u.login,
      emailAddress: u.email,
    }));
  }

  async linkToTestCase(
    issueId: string,
    testCaseId: string,
    metadata?: any
  ): Promise<void> {
    try {
      const { owner, repo, number } = this.parseIssueRef(issueId);
      const body = `Linked to test case: ${testCaseId}${
        metadata ? `\n\nMetadata: ${JSON.stringify(metadata, null, 2)}` : ""
      }`;
      await this.makeRequest(
        `${this.baseUrl}/api/v1/repos/${owner}/${repo}/issues/${number}/comments`,
        { method: "POST", body: JSON.stringify({ body }) }
      );
    } catch (error) {
      console.warn("[GiteaAdapter] linkToTestCase failed:", error);
    }
  }

  async syncIssue(issueId: string): Promise<IssueData> {
    return this.getIssue(issueId);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private resolveRepo(projectId?: string): { owner: string; repo: string } {
    if (projectId && projectId.includes("/")) {
      const [owner, repo] = projectId.split("/");
      return { owner, repo };
    }
    // A short repo name (getProjects' `key`) borrows the configured owner;
    // without this tier it would silently fall through to the configured
    // repository and read the wrong repo's data.
    if (this.owner && projectId) {
      return { owner: this.owner, repo: projectId };
    }
    if (this.owner && this.repo) {
      return { owner: this.owner, repo: this.repo };
    }
    throw new Error(
      "Gitea repository not configured. Expected format: owner/repo"
    );
  }

  private parseIssueRef(issueId: string): {
    owner: string;
    repo: string;
    number: string;
  } {
    // Format: "owner/repo#number"
    const match = issueId.match(/^([^/]+)\/([^/#]+)#(\d+)$/);
    if (match) {
      return { owner: match[1], repo: match[2], number: match[3] };
    }
    // Plain number — requires owner/repo context
    if (this.owner && this.repo) {
      return { owner: this.owner, repo: this.repo, number: issueId };
    }
    throw new Error(
      `Cannot resolve Gitea issue reference without repo context: ${issueId}`
    );
  }

  private mapStatusToGitea(status: string): string {
    const lower = status.toLowerCase();
    if (lower === "closed" || lower === "done" || lower === "resolved") {
      return "closed";
    }
    return "open";
  }

  private mapGiteaIssue(issue: any, owner: string, repo: string): IssueData {
    const number = issue.number;
    const key = `${owner}/${repo}#${number}`;
    return {
      id: String(number),
      key,
      title: issue.title ?? "",
      description: issue.body ?? undefined,
      status: issue.state ?? "open",
      priority: undefined,
      assignee:
        issue.assignee || (Array.isArray(issue.assignees) && issue.assignees[0])
          ? (() => {
              const a = issue.assignee || issue.assignees[0];
              return { id: a.login, name: a.full_name || a.login };
            })()
          : undefined,
      reporter: issue.user
        ? {
            id: issue.user.login,
            name: issue.user.full_name || issue.user.login,
          }
        : undefined,
      labels: Array.isArray(issue.labels)
        ? issue.labels.map((l: any) => l.name ?? l)
        : [],
      customFields: {
        _gitea_owner: owner,
        _gitea_repo: repo,
      },
      // Gitea's API sends `created_at`/`updated_at`; the bare names are kept
      // as a fallback for older payload shapes already stored in fixtures.
      createdAt: new Date(issue.created_at ?? issue.created),
      updatedAt: new Date(issue.updated_at ?? issue.updated),
      url: issue.html_url,
    };
  }
}
