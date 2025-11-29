import { BaseAdapter } from "./BaseAdapter";
import {
  IssueAdapterCapabilities,
  AuthenticationData,
  IssueData,
  CreateIssueData,
  UpdateIssueData,
  IssueSearchOptions,
} from "./IssueAdapter";

/**
 * GitHub integration adapter using Personal Access Token authentication
 */
export class GitHubAdapter extends BaseAdapter {
  private owner?: string;
  private repo?: string;
  private baseUrl = "https://api.github.com";

  constructor(config: any) {
    super(config);

    // GitHub repository can be specified in settings
    if (config.repository) {
      const [owner, repo] = config.repository.split("/");
      this.owner = owner;
      this.repo = repo;
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

    // Validate the token by making a test request
    try {
      await this.makeRequest(`${this.baseUrl}/user`);
    } catch (error) {
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

    const githubPayload = {
      title: data.title,
      body: data.description || "",
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
      updatePayload.body = data.description;
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
    const response = await this.makeRequest<any>(
      this.buildUrl(`/repos/{owner}/{repo}/issues/${issueId}`)
    );

    return this.mapGitHubIssue(response);
  }

  async searchIssues(options: IssueSearchOptions): Promise<{
    issues: IssueData[];
    total: number;
    hasMore: boolean;
  }> {
    const searchQuery: string[] = [];

    // Add repo filter
    if (this.owner && this.repo) {
      searchQuery.push(`repo:${this.owner}/${this.repo}`);
    } else if (options.projectId) {
      searchQuery.push(`repo:${options.projectId}`);
    }

    // Add search query
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

    const params = new URLSearchParams({
      q: searchQuery.join(" ") || "is:issue",
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

  private mapGitHubIssue(githubIssue: any): IssueData {
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
      customFields: {},
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
