import { tiptapToMarkdown } from "~/lib/tiptap/tiptapToMarkdown";
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

/**
 * GitHub integration adapter using Personal Access Token authentication
 */
export class GitHubAdapter extends BaseAdapter {
  private owner?: string;
  private repo?: string;
  // Public GitHub by default; GitHub Enterprise Server installations override
  // this with the full API root (e.g. "https://ghes.example.com/api/v3") via
  // the integration's settings.baseUrl. Trailing slash is normalized off so
  // url-template concatenation stays well-formed.
  private baseUrl = "https://api.github.com";

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
    };
  }

  protected async performAuthentication(
    authData: AuthenticationData
  ): Promise<void> {
    if (authData.type !== "api_key") {
      throw new Error(
        "GitHub adapter only supports Personal Access Token authentication"
      );
    }

    if (!authData.apiKey) {
      throw new Error(
        "Personal Access Token is required for GitHub authentication"
      );
    }

    // authData carries the per-instance baseUrl plumbed by IntegrationManager
    // (settings.baseUrl). Re-apply it here so token validation hits the right
    // server even if the adapter was constructed without it.
    if (authData.baseUrl) {
      this.baseUrl = authData.baseUrl.replace(/\/$/, "");
    }

    // Validate the token by making a test request
    try {
      await this.makeRequest(`${this.baseUrl}/user`);
    } catch {
      throw new Error("Invalid GitHub Personal Access Token");
    }
  }

  protected buildUrl(path: string): string {
    if (path.startsWith("/repos/") && this.owner && this.repo) {
      // Replace placeholder with actual owner/repo
      return `${this.baseUrl}${path.replace("{owner}/{repo}", `${this.owner}/${this.repo}`)}`;
    }
    return `${this.baseUrl}${path}`;
  }

  async createIssue(data: CreateIssueData): Promise<IssueData> {
    // Ensure we have owner/repo from either config or projectId
    if (!this.owner || !this.repo) {
      if (data.projectId.includes("/")) {
        const [owner, repo] = data.projectId.split("/");
        this.owner = owner;
        this.repo = repo;
      } else {
        throw new Error(
          "GitHub repository not configured. Expected format: owner/repo"
        );
      }
    }

    // INT-05: description may arrive as a TipTap doc (e.g. failed-iteration
    // body builder). Render to GFM markdown before posting to GitHub.
    const githubPayload = {
      title: data.title,
      body: renderGitHubDescription(data.description),
      labels: data.labels || [],
      assignees: data.assigneeId ? [data.assigneeId] : undefined,
    };

    const response = await this.makeRequest<any>(
      this.buildUrl(`/repos/{owner}/{repo}/issues`),
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

    if (data.assigneeId !== undefined) {
      updatePayload.assignees = [data.assigneeId];
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
    const searchQuery: string[] = [];

    // Always add is:issue to filter out pull requests (required by GitHub API)
    searchQuery.push("is:issue");

    // Add repo filter
    if (this.owner && this.repo) {
      searchQuery.push(`repo:${this.owner}/${this.repo}`);
    } else if (options.projectId) {
      searchQuery.push(`repo:${options.projectId}`);
    }

    // Add search query
    if (options.query) {
      // Key format: "#42" — use number: qualifier for exact issue lookup
      const numMatch = options.query.match(/^#(\d+)$/);
      if (numMatch) {
        searchQuery.push(`number:${numMatch[1]}`);
      } else {
        searchQuery.push(options.query);
      }
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
   * Get available labels for a repository
   */
  async getLabels(): Promise<
    Array<{ id: string; name: string; color: string }>
  > {
    if (!this.owner || !this.repo) {
      throw new Error("Repository not configured");
    }

    const labels = await this.makeRequest<any[]>(
      this.buildUrl(`/repos/{owner}/{repo}/labels`)
    );

    return labels.map((label) => ({
      id: label.name,
      name: label.name,
      color: label.color,
    }));
  }

  /**
   * Get available milestones for a repository
   */
  async getMilestones(): Promise<
    Array<{ id: string; title: string; state: string }>
  > {
    if (!this.owner || !this.repo) {
      throw new Error("Repository not configured");
    }

    const milestones = await this.makeRequest<any[]>(
      this.buildUrl(`/repos/{owner}/{repo}/milestones`)
    );

    return milestones.map((milestone) => ({
      id: milestone.number.toString(),
      title: milestone.title,
      state: milestone.state,
    }));
  }

  private mapStatusToGitHub(status: string): string {
    const lowerStatus = status.toLowerCase();
    if (
      lowerStatus === "closed" ||
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
      status: githubIssue.state,
      priority: undefined, // GitHub doesn't have priority
      assignee: githubIssue.assignee
        ? {
            id: githubIssue.assignee.login,
            name: githubIssue.assignee.login,
            email: githubIssue.assignee.email,
          }
        : undefined,
      reporter: githubIssue.user
        ? {
            id: githubIssue.user.login,
            name: githubIssue.user.login,
            email: githubIssue.user.email,
          }
        : undefined,
      labels: githubIssue.labels.map((label: any) => label.name),
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
