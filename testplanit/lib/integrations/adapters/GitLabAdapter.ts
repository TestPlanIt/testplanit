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

export class GitLabAdapter extends BaseAdapter {
  private projectPath?: string;
  private baseUrl: string = "https://gitlab.com";

  constructor(config: any) {
    super(config);
    if (config.projectPath) this.projectPath = config.projectPath;
    if (config.baseUrl) this.baseUrl = config.baseUrl.replace(/\/$/, "");
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
    };
  }

  protected async performAuthentication(
    authData: AuthenticationData
  ): Promise<void> {
    if (authData.type !== "api_key") {
      throw new Error(
        "GitLab adapter only supports Personal Access Token authentication"
      );
    }
    if (!authData.apiKey) {
      throw new Error(
        "Personal Access Token is required for GitLab authentication"
      );
    }
    if (authData.baseUrl) {
      this.baseUrl = authData.baseUrl.replace(/\/$/, "");
    }
    try {
      await this.makeRequest(`${this.baseUrl}/api/v4/user`);
    } catch {
      throw new Error("Invalid GitLab Personal Access Token");
    }
  }

  async createIssue(data: CreateIssueData): Promise<IssueData> {
    const projectPath = this.resolveProjectPath(data.projectId);
    const encoded = encodeURIComponent(projectPath);
    const payload: Record<string, any> = {
      title: data.title,
      description: typeof data.description === "string" ? data.description : "",
      labels: data.labels?.join(",") ?? "",
    };
    if (data.assigneeId) {
      const assigneeId = parseInt(data.assigneeId, 10);
      if (!isNaN(assigneeId)) payload.assignee_id = assigneeId;
    }
    const response = await this.makeRequest<any>(
      `${this.baseUrl}/api/v4/projects/${encoded}/issues`,
      { method: "POST", body: JSON.stringify(payload) }
    );
    return this.mapGitLabIssue(response, projectPath);
  }

  async updateIssue(
    issueId: string,
    data: UpdateIssueData
  ): Promise<IssueData> {
    const { projectPath, iid } = this.parseIssueRef(issueId);
    const encoded = encodeURIComponent(projectPath);
    const payload: Record<string, any> = {};
    if (data.title !== undefined) payload.title = data.title;
    if (data.description !== undefined) {
      payload.description =
        typeof data.description === "string" ? data.description : "";
    }
    if (data.status !== undefined) {
      payload.state_event = this.mapStatusToGitLab(data.status);
    }
    if (data.labels !== undefined) payload.labels = data.labels.join(",");
    if (data.assigneeId !== undefined) {
      const assigneeId = parseInt(data.assigneeId, 10);
      payload.assignee_id = isNaN(assigneeId) ? 0 : assigneeId;
    }
    const response = await this.makeRequest<any>(
      `${this.baseUrl}/api/v4/projects/${encoded}/issues/${iid}`,
      { method: "PUT", body: JSON.stringify(payload) }
    );
    return this.mapGitLabIssue(response, projectPath);
  }

  async getIssue(issueId: string): Promise<IssueData> {
    const { projectPath, iid } = this.parseIssueRef(issueId);
    const encoded = encodeURIComponent(projectPath);
    const response = await this.makeRequest<any>(
      `${this.baseUrl}/api/v4/projects/${encoded}/issues/${iid}`
    );
    return this.mapGitLabIssue(response, projectPath);
  }

  async searchIssues(options: IssueSearchOptions): Promise<{
    issues: IssueData[];
    total: number;
    hasMore: boolean;
  }> {
    const projectPath = this.resolveProjectPath(options.projectId);
    const encoded = encodeURIComponent(projectPath);
    const params = new URLSearchParams({
      per_page: (options.limit || 30).toString(),
      page: Math.floor(
        (options.offset || 0) / (options.limit || 30) + 1
      ).toString(),
    });
    if (options.query) params.set("search", options.query);
    if (options.assignee) params.set("assignee_username", options.assignee);
    if (options.labels && options.labels.length > 0) {
      params.set("labels", options.labels.join(","));
    }
    if (options.status && options.status.length > 0) {
      const state = options.status[0].toLowerCase();
      if (state === "closed" || state === "done" || state === "resolved") {
        params.set("state", "closed");
      } else {
        params.set("state", "opened");
      }
    }
    // Use full-text search order when there's a query; otherwise updated order
    params.set("order_by", options.query ? "created_at" : "updated_at");
    params.set("sort", "desc");

    const response = await this.makeRequest<any[]>(
      `${this.baseUrl}/api/v4/projects/${encoded}/issues?${params.toString()}`
    );
    const issues = Array.isArray(response) ? response : [];
    const limit = options.limit || 30;
    return {
      issues: issues.map((issue) => this.mapGitLabIssue(issue, projectPath)),
      total: issues.length,
      hasMore: issues.length === limit,
    };
  }

  async getIssueComments(issueId: string): Promise<IssueComment[]> {
    try {
      const { projectPath, iid } = this.parseIssueRef(issueId);
      const encoded = encodeURIComponent(projectPath);
      const response = await this.makeRequest<any[]>(
        `${this.baseUrl}/api/v4/projects/${encoded}/issues/${iid}/notes?sort=asc&order_by=created_at&per_page=100`
      );
      if (!Array.isArray(response)) return [];
      return response
        .filter((n) => !n.system)
        .map((n) => ({
          id: n.id != null ? String(n.id) : undefined,
          author: n.author?.username || n.author?.name || "Unknown",
          body: n.body ?? "",
          created: n.created_at ?? "",
        }));
    } catch (error) {
      const status = this.parseStatusFromError(error);
      const level = status === null || status >= 500 ? "error" : "warn";
      console[level](
        `[GitLabAdapter] getIssueComments failed for %s:`,
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
    const params = new URLSearchParams({
      membership: "true",
      simple: "true",
      per_page: "100",
      order_by: "last_activity_at",
    });
    const response = await this.makeRequest<any[]>(
      `${this.baseUrl}/api/v4/projects?${params.toString()}`
    );
    if (!Array.isArray(response)) return [];
    return response.map((p) => ({
      id: p.path_with_namespace,
      key: p.path_with_namespace,
      name: p.name_with_namespace ?? p.path_with_namespace,
    }));
  }

  async searchUsers(
    query: string,
    _projectKey?: string
  ): Promise<
    Array<{
      accountId: string;
      displayName: string;
      emailAddress?: string;
    }>
  > {
    const params = new URLSearchParams({ search: query, per_page: "20" });
    const response = await this.makeRequest<any[]>(
      `${this.baseUrl}/api/v4/users?${params.toString()}`
    );
    if (!Array.isArray(response)) return [];
    return response.map((u) => ({
      accountId: String(u.id),
      displayName: u.name ?? u.username,
      emailAddress: u.email,
    }));
  }

  async linkToTestCase(
    issueId: string,
    testCaseId: string,
    metadata?: any
  ): Promise<void> {
    try {
      const { projectPath, iid } = this.parseIssueRef(issueId);
      const encoded = encodeURIComponent(projectPath);
      const body = `Linked to test case: ${testCaseId}${
        metadata ? `\n\nMetadata: ${JSON.stringify(metadata, null, 2)}` : ""
      }`;
      await this.makeRequest(
        `${this.baseUrl}/api/v4/projects/${encoded}/issues/${iid}/notes`,
        { method: "POST", body: JSON.stringify({ body }) }
      );
    } catch (error) {
      console.warn("[GitLabAdapter] linkToTestCase failed:", error);
    }
  }

  async syncIssue(issueId: string): Promise<IssueData> {
    return this.getIssue(issueId);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private resolveProjectPath(projectId?: string): string {
    if (projectId && projectId.includes("/")) return projectId;
    if (this.projectPath) return this.projectPath;
    throw new Error(
      "GitLab project path not configured. Expected format: namespace/project"
    );
  }

  private parseIssueRef(issueId: string): {
    projectPath: string;
    iid: string;
  } {
    // Format: "namespace/project#iid"
    const match = issueId.match(/^(.+)#(\d+)$/);
    if (match) {
      return { projectPath: match[1], iid: match[2] };
    }
    // Plain iid — requires project context
    if (this.projectPath) {
      return { projectPath: this.projectPath, iid: issueId };
    }
    throw new Error(
      `Cannot resolve GitLab issue reference without project context: ${issueId}`
    );
  }

  private mapStatusToGitLab(status: string): string {
    const lower = status.toLowerCase();
    if (lower === "closed" || lower === "done" || lower === "resolved") {
      return "close";
    }
    return "reopen";
  }

  private mapGitLabIssue(issue: any, projectPath: string): IssueData {
    const iid = issue.iid;
    const key = `${projectPath}#${iid}`;
    return {
      id: String(iid),
      key,
      title: issue.title ?? "",
      description: issue.description ?? undefined,
      status: issue.state ?? "opened",
      priority: undefined,
      assignee: issue.assignee
        ? {
            id: String(issue.assignee.id),
            name: issue.assignee.name ?? issue.assignee.username,
            email: issue.assignee.email,
          }
        : undefined,
      reporter: issue.author
        ? {
            id: String(issue.author.id),
            name: issue.author.name ?? issue.author.username,
            email: issue.author.email,
          }
        : undefined,
      labels: Array.isArray(issue.labels) ? issue.labels : [],
      customFields: {
        _gitlab_project: projectPath,
        _gitlab_iid: iid,
      },
      createdAt: new Date(issue.created_at),
      updatedAt: new Date(issue.updated_at),
      url: issue.web_url,
    };
  }
}
