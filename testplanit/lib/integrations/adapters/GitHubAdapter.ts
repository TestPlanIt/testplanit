import { FIXED_TRACKER_STATUSES } from "../fixedTrackerStatuses";
import {
  GITHUB_NOT_PLANNED_STATUS,
  githubIssueStatus,
} from "../githubIssueStatus";
import { tiptapToMarkdown } from "~/lib/tiptap/tiptapToMarkdown";
import { BaseAdapter } from "./BaseAdapter";
import {
  AuthenticationData,
  CreateIssueData,
  CreateIssueMetadata,
  IssueAdapterCapabilities,
  IssueComment,
  IssueData,
  IssueSearchOptions,
  LinkedIssueRef,
  UpdateIssueData,
} from "./IssueAdapter";

/**
 * Detect a TipTap doc by structural shape. Mirrors the same check the
 * Jira and Azure DevOps adapters use, so the three adapters agree on
 * what "rich" input looks like (D-15).
 */
function isTiptapDoc(value: unknown): value is { type: "doc"; content: any[] } {
  return (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    (value as { type: unknown }).type === "doc"
  );
}

/**
 * Coerce a CreateIssueData/UpdateIssueData description into the markdown
 * string GitHub expects for the issue body. TipTap docs are rendered via
 * the hand-rolled GFM serializer (INT-05); strings pass through unchanged.
 */
function renderGitHubDescription(description: unknown): string {
  if (description === undefined || description === null) return "";
  if (isTiptapDoc(description)) return tiptapToMarkdown(description);
  if (typeof description === "string") return description;
  // Defensive: stringify any other shape so the issue body is never
  // `[object Object]` in the tracker.
  return String(description);
}

/** GitHub caps an issue at ten assignees; the API rejects more. */
const MAX_ASSIGNEES = 10;

/** Every page of a repository listing is read in full-size pages. */
const PAGE_SIZE = 100;

/** Repository listings are read up to this many pages (3,000 entries). */
const MAX_PAGES = 30;

function resolveAssignees(data: {
  assigneeIds?: string[];
  assigneeId?: string;
}): string[] {
  const logins =
    data.assigneeIds && data.assigneeIds.length > 0
      ? data.assigneeIds
      : data.assigneeId
        ? [data.assigneeId]
        : [];
  return Array.from(new Set(logins.filter(Boolean))).slice(0, MAX_ASSIGNEES);
}

/** GitHub addresses milestones by number; anything else is dropped. */
/** Hex colour per label name, or undefined when no label carries one. */
function labelColorsOf(labels: unknown): Record<string, string> | undefined {
  if (!Array.isArray(labels)) return undefined;
  const entries = labels
    .filter(
      (label: any) =>
        label && typeof label === "object" && label.name && label.color
    )
    .map((label: any) => [String(label.name), String(label.color)]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function parseMilestoneNumber(milestone: string | undefined): number | null {
  if (milestone === undefined || milestone === null || milestone === "") {
    return null;
  }
  const num = Number(milestone);
  return Number.isInteger(num) && num > 0 ? num : null;
}

/**
 * GitHub integration adapter using Personal Access Token authentication
 */
export class GitHubAdapter extends BaseAdapter {
  public supportsOAuth = true;

  private owner?: string;
  private repo?: string;
  // Public GitHub by default; GitHub Enterprise Server installations override
  // this with the full API root (e.g. "https://ghes.example.com/api/v3") via
  // the integration's settings.baseUrl. Trailing slash is normalized off so
  // url-template concatenation stays well-formed.
  private baseUrl = "https://api.github.com";

  // OAuth client credentials, plumbed per-integration by IntegrationManager.
  private clientId?: string;
  // Short repository names resolved to owner/repo by resolveRepository().
  private resolvedRepos = new Map<string, { owner: string; repo: string }>();
  private clientSecret?: string;
  private redirectUri?: string;

  constructor(config: any) {
    super(config);

    // GitHub repository can be specified in settings
    if (config.repository) {
      const [owner, repo] = config.repository.split("/");
      this.owner = owner;
      this.repo = repo;
    }

    if (config.baseUrl) {
      this.baseUrl = config.baseUrl.replace(/\/$/, "");
    }

    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.redirectUri = config.redirectUri;
  }

  /**
   * OAuth authorize/token endpoints live on the web host, not the API host.
   * github.com → https://github.com; GitHub Enterprise Server exposes them at
   * the instance root (API root with the trailing "/api/v3" removed).
   */
  private getOAuthBaseUrl(): string {
    if (this.baseUrl === "https://api.github.com") return "https://github.com";
    return this.baseUrl.replace(/\/api\/v3$/, "");
  }

  getCapabilities(): IssueAdapterCapabilities {
    return {
      createIssue: true,
      updateIssue: true,
      linkIssue: true,
      syncIssue: true,
      searchIssues: true,
      webhooks: true,
      customFields: false, // GitHub doesn't have custom fields like Jira
      attachments: false, // GitHub doesn't support direct attachments on issues
      linkedIssues: true,
      comments: true,
      milestones: false,
    };
  }

  protected async performAuthentication(
    authData: AuthenticationData
  ): Promise<void> {
    // authData carries the per-instance baseUrl plumbed by IntegrationManager
    // (settings.baseUrl). Re-apply it here so token validation hits the right
    // server even if the adapter was constructed without it.
    if (authData.baseUrl) {
      this.baseUrl = authData.baseUrl.replace(/\/$/, "");
    }

    if (authData.type === "oauth") {
      if (!authData.accessToken) {
        throw new Error("GitHub OAuth authentication requires an access token");
      }
      // Validate the token. makeRequest sends `Authorization: Bearer <token>`
      // for the oauth auth type, which GitHub accepts for user tokens.
      try {
        await this.makeRequest(`${this.baseUrl}/user`);
      } catch {
        throw new Error("Invalid GitHub OAuth access token");
      }
      return;
    }

    if (authData.type !== "api_key") {
      throw new Error(
        "GitHub adapter only supports OAuth and Personal Access Token authentication"
      );
    }

    if (!authData.apiKey) {
      throw new Error(
        "Personal Access Token is required for GitHub authentication"
      );
    }

    // Validate the token by making a test request
    try {
      await this.makeRequest(`${this.baseUrl}/user`);
    } catch {
      throw new Error("Invalid GitHub Personal Access Token");
    }
  }

  /**
   * Build the OAuth authorization URL the user is redirected to for consent.
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId || "",
      redirect_uri: this.redirectUri || "",
      scope: "repo read:user",
      state,
    });
    return `${this.getOAuthBaseUrl()}/login/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange the authorization code for an access token. An OAuth app with
   * "Expire user access tokens" enabled (GitHub's default for new apps) also
   * returns a refresh token and an 8-hour `expires_in`; an app without it
   * returns a token that never expires and no refresh token.
   */
  async exchangeCodeForTokens(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    return this.requestToken(
      { code, redirect_uri: this.redirectUri },
      "exchange code for tokens"
    );
  }

  /**
   * Renew an expiring user access token with its refresh token. GitHub
   * rotates both on every refresh; the manager persists the pair. A dead
   * refresh token (revoked, already rotated, or past its 6-month life) is
   * reported with `invalid_grant` so the manager flags the row for
   * re-authorization instead of retrying.
   */
  async refreshTokens(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    return this.requestToken(
      { grant_type: "refresh_token", refresh_token: refreshToken },
      "refresh tokens"
    );
  }

  private async requestToken(
    body: Record<string, string | undefined>,
    what: string
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    const response = await fetch(
      `${this.getOAuthBaseUrl()}/login/oauth/access_token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          ...body,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to ${what}: ${error}`);
    }

    // GitHub answers 200 with an error object rather than a 4xx.
    const data = await response.json();
    if (data.error) {
      const detail = data.error_description || data.error;
      const dead = data.error === "bad_refresh_token";
      throw new Error(
        `Failed to ${what}: ${detail}${dead ? " (invalid_grant)" : ""}`
      );
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined,
    };
  }

  protected buildUrl(path: string): string {
    if (path.startsWith("/repos/") && this.owner && this.repo) {
      // Replace placeholder with actual owner/repo
      return `${this.baseUrl}${path.replace("{owner}/{repo}", `${this.owner}/${this.repo}`)}`;
    }
    return `${this.baseUrl}${path}`;
  }

  async createIssue(data: CreateIssueData): Promise<IssueData> {
    // Resolved per call: the adapter is cached per integration and shared by
    // every project linked to it, each of which may target its own repository.
    const { owner, repo } = await this.resolveRepository(
      data.externalProjectId?.includes("/")
        ? data.externalProjectId
        : data.projectId
    );

    // INT-05: description may arrive as a TipTap doc (e.g. failed-iteration
    // body builder). Render to GFM markdown before posting to GitHub.
    const assignees = resolveAssignees(data);
    const milestone = parseMilestoneNumber(data.milestone);
    const githubPayload = {
      title: data.title,
      body: renderGitHubDescription(data.description),
      labels: data.labels || [],
      assignees: assignees.length > 0 ? assignees : undefined,
      milestone: milestone ?? undefined,
      // Organization issue types are addressed by name; GitHub ignores
      // the field on repositories whose owner has none.
      type: data.issueType || undefined,
    };

    const response = await this.makeRequest<any>(
      `${this.baseUrl}/repos/${owner}/${repo}/issues`,
      {
        method: "POST",
        body: JSON.stringify(githubPayload),
      }
    );

    return this.mapGitHubIssue(response);
  }

  async updateIssue(
    issueId: string,
    data: UpdateIssueData
  ): Promise<IssueData> {
    const updatePayload: any = {};

    if (data.title !== undefined) {
      updatePayload.title = data.title;
    }

    if (data.description !== undefined) {
      updatePayload.body = renderGitHubDescription(data.description);
    }

    if (data.status !== undefined) {
      updatePayload.state = this.mapStatusToGitHub(data.status);
    }

    if (data.labels !== undefined) {
      updatePayload.labels = data.labels;
    }

    if (data.assigneeIds !== undefined || data.assigneeId !== undefined) {
      updatePayload.assignees = resolveAssignees(data);
    }

    if (data.milestone !== undefined) {
      updatePayload.milestone = parseMilestoneNumber(data.milestone);
    }

    const response = await this.makeRequest<any>(
      this.buildUrl(`/repos/{owner}/{repo}/issues/${issueId}`),
      {
        method: "PATCH",
        body: JSON.stringify(updatePayload),
      }
    );

    return this.mapGitHubIssue(response);
  }

  async getIssue(issueId: string): Promise<IssueData> {
    const { owner, repo, issueNumber } = this.parseIssueRef(issueId);

    const response = await this.makeRequest<any>(
      `${this.baseUrl}/repos/${owner}/${repo}/issues/${issueNumber}`
    );

    return this.mapGitHubIssue(response);
  }

  async getLinkedIssues(issueId: string): Promise<LinkedIssueRef[]> {
    let owner: string;
    let repo: string;
    let issueNumber: string;
    try {
      ({ owner, repo, issueNumber } = this.parseIssueRef(issueId));
    } catch (error) {
      console.warn(
        `[GitHubAdapter] getLinkedIssues failed for %s:`,
        issueId,
        error
      );
      return [];
    }

    const [subIssuesResult, timelineResult] = await Promise.allSettled([
      this.fetchSubIssues(owner, repo, issueNumber),
      this.fetchCrossReferences(owner, repo, issueNumber),
    ]);

    const refs: LinkedIssueRef[] = [];

    if (subIssuesResult.status === "fulfilled") {
      refs.push(...subIssuesResult.value);
    } else {
      const status = this.parseStatusFromError(subIssuesResult.reason);
      const level = status === null || status >= 500 ? "error" : "warn";
      console[level](
        `[GitHubAdapter] sub_issues failed for %s:`,
        issueId,
        subIssuesResult.reason
      );
    }

    if (timelineResult.status === "fulfilled") {
      refs.push(...timelineResult.value);
    } else {
      const status = this.parseStatusFromError(timelineResult.reason);
      const level = status === null || status >= 500 ? "error" : "warn";
      console[level](
        `[GitHubAdapter] timeline failed for %s:`,
        issueId,
        timelineResult.reason
      );
    }

    return refs;
  }

  async getIssueComments(issueId: string): Promise<IssueComment[]> {
    try {
      const { owner, repo, issueNumber } = this.parseIssueRef(issueId);
      const response = await this.makeRequest<any>(
        `${this.baseUrl}/repos/${owner}/${repo}/issues/${issueNumber}/comments`
      );
      return this.mapGitHubComments(response);
    } catch (error) {
      const status = this.parseStatusFromError(error);
      const level = status === null || status >= 500 ? "error" : "warn";
      console[level](
        `[GitHubAdapter] getIssueComments failed for %s:`,
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
  }> {
    // "#42" is an exact lookup. GitHub's search API has no `number:`
    // qualifier and indexes new issues late, so fetch the issue itself.
    const numMatch = options.query?.match(/^#(\d+)$/);
    if (numMatch) {
      return this.lookupIssueByNumber(numMatch[1], options);
    }

    const searchQuery: string[] = [];

    // Always add is:issue to filter out pull requests (required by GitHub API)
    searchQuery.push("is:issue");

    // Add repo filter
    if (this.owner && this.repo) {
      searchQuery.push(`repo:${this.owner}/${this.repo}`);
    } else if (options.projectId) {
      searchQuery.push(`repo:${options.projectId}`);
    }

    if (options.query) {
      searchQuery.push(options.query);
    }

    // Add status filter
    if (options.status && options.status.length > 0) {
      const states = options.status.map((s) => this.mapStatusToGitHub(s));
      searchQuery.push(`is:${states.join(" is:")}`);
    }

    // Add assignee filter
    if (options.assignee) {
      searchQuery.push(`assignee:${options.assignee}`);
    }

    // Add label filter
    if (options.labels && options.labels.length > 0) {
      searchQuery.push(options.labels.map((l) => `label:"${l}"`).join(" "));
    }

    // Bulk-import recency window — GitHub's search API takes an ISO date
    // (YYYY-MM-DD) with the `updated:>=` range qualifier.
    if (options.updatedWithinDays && options.updatedWithinDays > 0) {
      const cutoff = new Date(
        Date.now() - Math.floor(options.updatedWithinDays) * 86_400_000
      )
        .toISOString()
        .slice(0, 10);
      searchQuery.push(`updated:>=${cutoff}`);
    }

    const params = new URLSearchParams({
      q: searchQuery.join(" "),
      per_page: (options.limit || 30).toString(),
      page: Math.floor(
        (options.offset || 0) / (options.limit || 30) + 1
      ).toString(),
      sort: "created",
      order: "desc",
    });

    const response = await this.makeRequest<any>(
      `${this.baseUrl}/search/issues?${params.toString()}`
    );

    return {
      issues: response.items.map((issue: any) => this.mapGitHubIssue(issue)),
      total: response.total_count,
      hasMore:
        response.incomplete_results ||
        response.total_count > (options.offset || 0) + response.items.length,
    };
  }

  private async lookupIssueByNumber(
    issueNumber: string,
    options: IssueSearchOptions
  ): Promise<{ issues: IssueData[]; total: number; hasMore: boolean }> {
    const empty = { issues: [], total: 0, hasMore: false };
    const repoPath =
      this.owner && this.repo
        ? `${this.owner}/${this.repo}`
        : options.projectId;
    if (!repoPath) return empty;
    let raw: any;
    try {
      raw = await this.makeRequest<any>(
        `${this.baseUrl}/repos/${repoPath}/issues/${issueNumber}`
      );
    } catch (error: any) {
      if (error?.status === 404) return empty;
      throw error;
    }
    // The issues endpoint also answers for pull requests.
    if (!raw || raw.pull_request) return empty;
    const issue = this.mapGitHubIssue(raw);
    if (options.status?.length && !options.status.includes(issue.status)) {
      return empty;
    }
    return { issues: [issue], total: 1, hasMore: false };
  }

  protected async addComment(issueId: string, comment: string): Promise<void> {
    await this.makeRequest(
      this.buildUrl(`/repos/{owner}/{repo}/issues/${issueId}/comments`),
      {
        method: "POST",
        body: JSON.stringify({ body: comment }),
      }
    );
  }

  /**
   * Get available repositories for the authenticated user
   */
  async getProjects(): Promise<
    Array<{ id: string; key: string; name: string }>
  > {
    const repos = await this.makeRequest<any[]>(
      `${this.baseUrl}/user/repos?per_page=100&sort=updated`
    );

    return repos.map((repo) => ({
      id: repo.full_name,
      key: repo.name,
      name: repo.full_name,
    }));
  }

  /**
   * Resolves the {owner, repo} pair a repository-scoped read should hit.
   * Mapped tracker projects carry either the full name ("owner/repo" —
   * `getProjects` returns `repo.full_name` as the id) or the short repo
   * name (the same call's `key`); a short name borrows the owner from the
   * integration's configured repository. No argument falls back to the
   * configured repository whole.
   */
  private resolveRepoRef(projectKey?: string): {
    owner: string;
    repo: string;
  } {
    if (projectKey?.includes("/")) {
      const [owner, repo] = projectKey.split("/");
      if (owner && repo) {
        return { owner, repo };
      }
    }
    if (this.owner && projectKey) {
      return { owner: this.owner, repo: projectKey };
    }
    if (this.owner && this.repo) {
      return { owner: this.owner, repo: this.repo };
    }
    throw new Error("Repository not configured");
  }

  /**
   * Like `resolveRepoRef`, but a short repository name with no configured
   * owner is looked up among the repositories this connection can access —
   * the same list a project's linked repository was chosen from.
   */
  private async resolveRepository(
    projectKey?: string
  ): Promise<{ owner: string; repo: string }> {
    if (!projectKey || projectKey.includes("/") || this.owner) {
      return this.resolveRepoRef(projectKey);
    }

    const cached = this.resolvedRepos.get(projectKey.toLowerCase());
    if (cached) {
      return cached;
    }

    const matches: string[] = [];
    for (let page = 1; page <= 10; page++) {
      const repos = await this.makeRequest<any[]>(
        `${this.baseUrl}/user/repos?per_page=100&page=${page}`
      );
      for (const repo of repos) {
        if (repo.name?.toLowerCase() === projectKey.toLowerCase()) {
          matches.push(repo.full_name);
        }
      }
      if (repos.length < 100) {
        break;
      }
    }

    if (matches.length === 1) {
      const [owner, repo] = matches[0].split("/");
      const ref = { owner, repo };
      this.resolvedRepos.set(projectKey.toLowerCase(), ref);
      return ref;
    }
    if (matches.length > 1) {
      throw new Error(
        `More than one accessible GitHub repository is named "${projectKey}" (${matches.join(", ")}), so it cannot be identified by name alone.`
      );
    }
    throw new Error(
      `GitHub repository "${projectKey}" was not found among the repositories this connection can access.`
    );
  }

  /**
   * GitHub models no issue types — repository LABELS are the designation
   * vocabulary this adapter serves through the issue-type contract, the
   * way GitLab's own `getIssueTypes` returns a list its tracker never
   * enumerates. `id === name` deliberately: a label reaches issue
   * payloads (`mapGitHubIssue`'s `labels`) only as its name, so the name
   * is the only join key classification can use — see
   * `matchesRequirementDesignation`'s type-vs-label precedence contract.
   * Paged to three pages (300 labels), comfortably past the
   * requirement-config selection cap of 200.
   */
  async getIssueTypes(
    projectKey: string
  ): Promise<Array<{ id: string; name: string }>> {
    const { owner, repo } = await this.resolveRepository(projectKey);

    const labels: Array<{ id: string; name: string }> = [];
    for (let page = 1; page <= 3; page++) {
      const pageLabels = await this.makeRequest<any[]>(
        `${this.baseUrl}/repos/${owner}/${repo}/labels?per_page=100&page=${page}`
      );
      labels.push(
        ...pageLabels.map((label: any) => ({
          id: label.name,
          name: label.name,
        }))
      );
      if (pageLabels.length < 100) {
        break;
      }
    }
    return labels;
  }

  /**
   * Reads every page of a repository-scoped list endpoint. `url` must not
   * already carry a query string.
   */
  private async listAllPages<T = any>(
    url: string,
    query: Record<string, string> = {}
  ): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const params = new URLSearchParams({
        ...query,
        per_page: String(PAGE_SIZE),
        page: String(page),
      });
      const pageItems = await this.makeRequest<T[]>(`${url}?${params}`);
      items.push(...pageItems);
      if (pageItems.length < PAGE_SIZE) {
        break;
      }
    }
    return items;
  }

  /**
   * The repository's labels, by name — the key GitHub takes on create.
   */
  async getLabels(
    projectKey: string
  ): Promise<Array<{ id: string; name: string; color: string }>> {
    const { owner, repo } = await this.resolveRepository(projectKey);
    const labels = await this.listAllPages<any>(
      `${this.baseUrl}/repos/${owner}/${repo}/labels`
    );
    return labels.map((label) => ({
      id: label.name,
      name: label.name,
      color: label.color,
    }));
  }

  /**
   * The repository's milestones, by number — the key GitHub takes on
   * create. Open ones by default; `state: "all"` includes closed ones.
   */
  async getMilestones(
    projectKey: string,
    state: "open" | "closed" | "all" = "open"
  ): Promise<
    Array<{ id: string; title: string; state: string; dueOn: string | null }>
  > {
    const { owner, repo } = await this.resolveRepository(projectKey);
    const milestones = await this.listAllPages<any>(
      `${this.baseUrl}/repos/${owner}/${repo}/milestones`,
      { state, sort: "due_on", direction: "asc" }
    );
    return milestones.map((milestone) => ({
      id: String(milestone.number),
      title: milestone.title,
      state: milestone.state,
      dueOn: milestone.due_on ?? null,
    }));
  }

  /**
   * The users the repository lets an issue be assigned to.
   */
  async getAssignableUsers(
    projectKey: string
  ): Promise<Array<{ id: string; name: string; avatarUrl?: string }>> {
    const { owner, repo } = await this.resolveRepository(projectKey);
    const users = await this.listAllPages<any>(
      `${this.baseUrl}/repos/${owner}/${repo}/assignees`
    );
    return users.map((user) => ({
      id: user.login,
      name: user.login,
      avatarUrl: user.avatar_url,
    }));
  }

  /**
   * The issue types the repository owner's organization defines, by name
   * — the key GitHub takes on create. A repository owned by a user, or a
   * GitHub Enterprise Server without the feature, has none: the endpoint
   * answers 404 and this returns an empty list. Disabled types are left
   * out because GitHub refuses them on create.
   */
  async getOrgIssueTypes(projectKey: string): Promise<
    Array<{
      id: string;
      name: string;
      description: string | null;
      color: string | null;
    }>
  > {
    const { owner } = await this.resolveRepository(projectKey);
    let types: any[];
    try {
      types = await this.makeRequest<any[]>(
        `${this.baseUrl}/orgs/${encodeURIComponent(owner)}/issue-types`
      );
    } catch (error: any) {
      if (error?.status === 404) {
        return [];
      }
      throw error;
    }
    return (Array.isArray(types) ? types : [])
      .filter((type) => type.is_enabled !== false)
      .map((type) => ({
        id: type.name,
        name: type.name,
        description: type.description ?? null,
        color: type.color ?? null,
      }));
  }

  /**
   * Everything the create form can offer for one repository. The lists
   * are fetched together; one that fails is returned empty so the form
   * still opens with the rest.
   */
  async getCreateIssueMetadata(
    projectKey: string
  ): Promise<CreateIssueMetadata> {
    const [labels, milestones, assignees, issueTypes] = await Promise.all([
      this.getLabels(projectKey).catch((error) => {
        console.error("[GitHubAdapter] getLabels failed:", error);
        return [];
      }),
      this.getMilestones(projectKey).catch((error) => {
        console.error("[GitHubAdapter] getMilestones failed:", error);
        return [];
      }),
      this.getAssignableUsers(projectKey).catch((error) => {
        console.error("[GitHubAdapter] getAssignableUsers failed:", error);
        return [];
      }),
      this.getOrgIssueTypes(projectKey).catch((error) => {
        console.error("[GitHubAdapter] getOrgIssueTypes failed:", error);
        return [];
      }),
    ]);
    return { labels, milestones, assignees, issueTypes };
  }

  /**
   * Looks assignable users up by login. GitHub has no user search scoped
   * to a repository, so the assignee list is filtered here.
   */
  async searchUsers(
    query: string,
    projectKey?: string,
    startAt: number = 0,
    maxResults: number = 50
  ): Promise<{
    users: Array<{
      accountId: string;
      displayName: string;
      emailAddress?: string;
      avatarUrls?: any;
    }>;
    total: number;
  }> {
    const assignees = await this.getAssignableUsers(projectKey ?? "");
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? assignees.filter((user) => user.name.toLowerCase().includes(needle))
      : assignees;
    return {
      users: matches.slice(startAt, startAt + maxResults).map((user) => ({
        accountId: user.id,
        displayName: user.name,
        avatarUrls: user.avatarUrl ? { "48x48": user.avatarUrl } : undefined,
      })),
      total: matches.length,
    };
  }

  /** Its issues are only ever open or closed. */
  async getStatuses(): Promise<Array<{ id: string; name: string }>> {
    return [...FIXED_TRACKER_STATUSES.GITHUB];
  }

  private mapStatusToGitHub(status: string): string {
    const lowerStatus = status.toLowerCase();
    if (
      lowerStatus === "closed" ||
      lowerStatus === GITHUB_NOT_PLANNED_STATUS ||
      lowerStatus === "done" ||
      lowerStatus === "resolved"
    ) {
      return "closed";
    }
    return "open";
  }

  private parseIssueRef(issueId: string): {
    owner: string;
    repo: string;
    issueNumber: string;
  } {
    let owner = this.owner;
    let repo = this.repo;
    let issueNumber = issueId;

    // Check if issueId includes repo context (format: "owner/repo#123")
    const repoIssueMatch = issueId.match(/^([^/]+)\/([^/#]+)#(\d+)$/);
    if (repoIssueMatch) {
      owner = repoIssueMatch[1];
      repo = repoIssueMatch[2];
      issueNumber = repoIssueMatch[3];
    } else if (issueId.startsWith("#")) {
      // Just a number with # prefix
      issueNumber = issueId.substring(1);
      if (!issueNumber || !/^\d+$/.test(issueNumber)) {
        throw new Error(`Invalid GitHub issue reference: ${issueId}`);
      }
    }

    if (!owner || !repo) {
      throw new Error(
        "GitHub repository not configured. Cannot fetch issue without owner/repo context."
      );
    }
    return { owner, repo, issueNumber };
  }

  private async fetchSubIssues(
    owner: string,
    repo: string,
    issueNumber: string
  ): Promise<LinkedIssueRef[]> {
    const response = await this.makeRequest<any[]>(
      `${this.baseUrl}/repos/${owner}/${repo}/issues/${issueNumber}/sub_issues`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    if (!Array.isArray(response)) return [];
    const refs: LinkedIssueRef[] = [];
    for (const sub of response) {
      if (!sub || sub.id == null) continue;
      refs.push({
        id: String(sub.id),
        key: sub.number != null ? `#${sub.number}` : undefined,
        linkType: "sub_issue",
        direction: "outward",
      });
    }
    return refs;
  }

  private async fetchCrossReferences(
    owner: string,
    repo: string,
    issueNumber: string
  ): Promise<LinkedIssueRef[]> {
    const response = await this.makeRequest<any[]>(
      `${this.baseUrl}/repos/${owner}/${repo}/issues/${issueNumber}/timeline`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    if (!Array.isArray(response)) return [];
    const refs: LinkedIssueRef[] = [];
    for (const event of response) {
      if (event?.event !== "cross-referenced") continue;
      const ref = event?.source?.issue;
      if (!ref || ref.id == null) continue;
      refs.push({
        id: String(ref.id),
        key: ref.number != null ? `#${ref.number}` : undefined,
        linkType: "cross_referenced",
        direction: "inward",
      });
    }
    return refs;
  }

  private mapGitHubComments(response: any): IssueComment[] {
    if (!Array.isArray(response)) return [];
    const out: IssueComment[] = [];
    for (const c of response) {
      if (!c) continue;
      out.push({
        id: c.id != null ? String(c.id) : undefined,
        author: c.user?.login || "Unknown",
        body: c.body ?? "",
        created: c.created_at ?? "",
      });
    }
    return out;
  }

  private mapGitHubIssue(githubIssue: any): IssueData {
    // Extract owner/repo from repository_url (for search results) or html_url
    let owner = this.owner;
    let repo = this.repo;

    if (githubIssue.repository_url) {
      // Format: https://api.github.com/repos/owner/repo
      const match = githubIssue.repository_url.match(
        /\/repos\/([^/]+)\/([^/]+)$/
      );
      if (match) {
        owner = match[1];
        repo = match[2];
      }
    } else if (githubIssue.html_url) {
      // Format: https://github.com/owner/repo/issues/123
      const match = githubIssue.html_url.match(
        /github\.com\/([^/]+)\/([^/]+)\/issues/
      );
      if (match) {
        owner = match[1];
        repo = match[2];
      }
    }

    return {
      id: githubIssue.number.toString(),
      key: `#${githubIssue.number}`,
      title: githubIssue.title,
      description: githubIssue.body,
      status: githubIssueStatus(githubIssue) ?? githubIssue.state,
      priority: undefined, // GitHub doesn't have priority
      assignee: githubIssue.assignee
        ? {
            id: githubIssue.assignee.login,
            name: githubIssue.assignee.login,
            email: githubIssue.assignee.email,
            avatarUrl: githubIssue.assignee.avatar_url,
          }
        : undefined,
      assignees: Array.isArray(githubIssue.assignees)
        ? githubIssue.assignees.map((user: any) => ({
            id: user.login,
            name: user.login,
            email: user.email,
            avatarUrl: user.avatar_url,
          }))
        : undefined,
      milestone: githubIssue.milestone
        ? {
            id: String(githubIssue.milestone.number),
            name: githubIssue.milestone.title,
            state: githubIssue.milestone.state,
            dueDate: githubIssue.milestone.due_on ?? undefined,
          }
        : undefined,
      commentCount:
        typeof githubIssue.comments === "number"
          ? githubIssue.comments
          : undefined,
      reporter: githubIssue.user
        ? {
            id: githubIssue.user.login,
            name: githubIssue.user.login,
            email: githubIssue.user.email,
          }
        : undefined,
      // Label names feed requirement classification (the designation
      // vocabulary for a tracker with no issue types), so this mapping is
      // load-bearing, guarded against payloads without a labels array,
      // and tolerant of GitHub's occasional plain-string label form.
      labels: Array.isArray(githubIssue.labels)
        ? githubIssue.labels.map((label: any) =>
            typeof label === "string" ? label : label.name
          )
        : [],
      labelColors: labelColorsOf(githubIssue.labels),
      // Store repo context in customFields for sync support
      customFields: {
        _github_owner: owner,
        _github_repo: repo,
      },
      createdAt: new Date(githubIssue.created_at),
      updatedAt: new Date(githubIssue.updated_at),
      url: githubIssue.html_url,
    };
  }

  async linkToTestCase(
    issueId: string,
    testCaseId: string,
    metadata?: any
  ): Promise<void> {
    const comment = `Linked to test case: ${testCaseId}${
      metadata ? `\n\nMetadata: ${JSON.stringify(metadata, null, 2)}` : ""
    }`;
    await this.addComment(issueId, comment);
  }

  async syncIssue(issueId: string): Promise<IssueData> {
    return this.getIssue(issueId);
  }
}
