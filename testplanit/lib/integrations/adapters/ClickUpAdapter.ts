import { tiptapToMarkdown } from "~/lib/tiptap/tiptapToMarkdown";
import { BaseAdapter } from "./BaseAdapter";
import {
  AuthenticationData,
  CreateIssueData,
  IssueAdapterCapabilities,
  IssueComment,
  IssueData,
  IssueSearchOptions,
  UpdateIssueData,
} from "./IssueAdapter";

/**
 * Detect a TipTap doc by structural shape. Mirrors the same check the
 * GitHub/Jira/Azure DevOps adapters use, so every adapter agrees on what
 * "rich" input looks like (D-15).
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
 * string ClickUp expects for `markdown_description`. TipTap docs are
 * rendered via the hand-rolled GFM serializer (INT-05); strings pass
 * through unchanged.
 */
function renderClickUpDescription(description: unknown): string {
  if (description === undefined || description === null) return "";
  if (isTiptapDoc(description)) return tiptapToMarkdown(description);
  if (typeof description === "string") return description;
  // Defensive: stringify any other shape so the task body is never
  // `[object Object]` in ClickUp.
  return String(description);
}

/** ClickUp priority is an integer 1 (urgent) through 4 (low); unknown values default to "normal". */
function mapPriorityToClickUp(priority: string): number {
  const map: Record<string, number> = {
    urgent: 1,
    high: 2,
    normal: 3,
    low: 4,
  };
  return map[priority.toLowerCase()] ?? 3;
}

/**
 * ClickUp integration adapter using OAuth2 authentication.
 *
 * Deviations from the other adapters (GitHub/Jira/GitLab) worth calling out:
 *  - ClickUp has no flat "project" concept. Tasks live in a List, which is
 *    nested under an optional Folder, under a Space, under a Team
 *    (workspace). `settings.teamId` is required for `getProjects()`, and
 *    `settings.listId` is the default target list for `createIssue`/
 *    `searchIssues` when `CreateIssueData.projectId`/`IssueSearchOptions.projectId`
 *    isn't itself a list id.
 *  - ClickUp OAuth access tokens do not expire and there is no refresh
 *    endpoint — `refreshTokens()` is implemented only for interface
 *    completeness and is never expected to be called in practice.
 *  - ClickUp does not use the `Bearer` prefix on its Authorization header
 *    for OAuth tokens (unlike GitHub/GitLab/Jira Cloud) — see the
 *    `CLICKUP` branch added to `BaseAdapter.makeRequest()`.
 *  - ClickUp timestamps (`date_created`/`date_updated`) are epoch-millisecond
 *    *strings*, not ISO-8601 strings.
 */
export class ClickUpAdapter extends BaseAdapter {
  public supportsOAuth = true;

  private baseUrl = "https://api.clickup.com/api/v2";

  // ClickUp hierarchy context, plumbed per-integration via settings.
  private teamId?: string;
  private listId?: string;

  // OAuth client credentials, plumbed per-integration by IntegrationManager.
  private clientId?: string;
  private clientSecret?: string;
  private redirectUri?: string;

  constructor(config: any) {
    super(config);

    if (config.teamId) this.teamId = config.teamId;
    if (config.listId) this.listId = config.listId;

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
      // No inbound webhook receiver implemented in this scope.
      webhooks: false,
      // ClickUp custom fields exist per-List; not mapped in v1 — future work.
      customFields: false,
      // Attachment upload not implemented in v1 — future work.
      attachments: false,
      // ClickUp task links/dependencies exist but are out of MVP scope.
      linkedIssues: false,
      comments: true,
    };
  }

  protected async performAuthentication(
    authData: AuthenticationData
  ): Promise<void> {
    if (authData.type !== "oauth") {
      throw new Error("ClickUp adapter only supports OAuth authentication");
    }

    if (!authData.accessToken) {
      throw new Error("ClickUp OAuth authentication requires an access token");
    }

    // Validate the token. makeRequest sends the raw token (no "Bearer"
    // prefix) for ClickUp's oauth auth type.
    try {
      await this.makeRequest(`${this.baseUrl}/user`);
    } catch {
      throw new Error("Invalid ClickUp OAuth access token");
    }
  }

  /**
   * Build the OAuth authorization URL the user is redirected to for consent.
   * ClickUp does not use OAuth scopes — access is granted per-workspace by
   * the user during the consent step.
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId || "",
      redirect_uri: this.redirectUri || "",
      state,
    });
    return `https://app.clickup.com/api?${params.toString()}`;
  }

  /**
   * Exchange the authorization code for an access token. ClickUp OAuth
   * tokens do not expire, so no refresh token or expiry is returned.
   */
  async exchangeCodeForTokens(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    const response = await fetch(`${this.baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exchange code for tokens: ${error}`);
    }

    const data = await response.json();
    if (data.err) {
      throw new Error(`Failed to exchange code for tokens: ${data.err}`);
    }

    return { accessToken: data.access_token };
  }

  /**
   * ClickUp OAuth access tokens do not expire and there is no refresh
   * endpoint. IntegrationManager only calls this when a stored token's
   * expiry has passed, which never happens for ClickUp since
   * `exchangeCodeForTokens` never sets `expiresAt`. Implemented purely for
   * interface completeness / defensive future-proofing.
   */
  async refreshTokens(_refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    throw new Error("ClickUp OAuth tokens do not expire and cannot be refreshed");
  }

  async createIssue(data: CreateIssueData): Promise<IssueData> {
    const listId = data.projectId || this.listId;
    if (!listId) {
      throw new Error(
        "ClickUp List ID not configured. Expected settings.listId or CreateIssueData.projectId."
      );
    }

    const payload: Record<string, unknown> = {
      name: data.title,
      markdown_description: renderClickUpDescription(data.description),
    };
    if (data.priority !== undefined) {
      payload.priority = mapPriorityToClickUp(data.priority);
    }
    if (data.assigneeId) {
      payload.assignees = [Number(data.assigneeId)];
    }
    if (data.labels !== undefined) {
      payload.tags = data.labels;
    }

    const response = await this.makeRequest<any>(
      `${this.baseUrl}/list/${listId}/task`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );

    return this.mapClickUpTask(response);
  }

  async updateIssue(
    issueId: string,
    data: UpdateIssueData
  ): Promise<IssueData> {
    const payload: Record<string, unknown> = {};

    if (data.title !== undefined) {
      payload.name = data.title;
    }
    if (data.description !== undefined) {
      payload.markdown_description = renderClickUpDescription(
        data.description
      );
    }
    if (data.status !== undefined) {
      // ClickUp statuses are free-text and defined per-List; pass through
      // verbatim rather than mapping to a fixed open/closed pair.
      payload.status = data.status;
    }
    if (data.priority !== undefined) {
      payload.priority = mapPriorityToClickUp(data.priority);
    }
    if (data.assigneeId !== undefined) {
      // ClickUp's task-update endpoint takes an add/remove delta for
      // assignees rather than the flat replacement array GitHub/GitLab use.
      payload.assignees = { add: [Number(data.assigneeId)], rem: [] };
    }
    if (data.labels !== undefined) {
      payload.tags = data.labels;
    }

    const response = await this.makeRequest<any>(
      `${this.baseUrl}/task/${issueId}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      }
    );

    return this.mapClickUpTask(response);
  }

  async getIssue(issueId: string): Promise<IssueData> {
    const response = await this.makeRequest<any>(
      `${this.baseUrl}/task/${issueId}`
    );
    return this.mapClickUpTask(response);
  }

  async searchIssues(options: IssueSearchOptions): Promise<{
    issues: IssueData[];
    total: number;
    hasMore: boolean;
  }> {
    const listId = options.projectId || this.listId;
    if (!listId) {
      throw new Error(
        "ClickUp List ID not configured. Expected settings.listId or IssueSearchOptions.projectId."
      );
    }

    const limit = options.limit || 100;
    const params = new URLSearchParams();
    params.set("page", String(Math.floor((options.offset || 0) / limit)));
    params.set("include_closed", "true");
    if (options.status && options.status.length > 0) {
      for (const s of options.status) params.append("statuses[]", s);
    }
    if (options.assignee) {
      params.append("assignees[]", options.assignee);
    }
    if (options.updatedWithinDays && options.updatedWithinDays > 0) {
      params.set(
        "date_updated_gt",
        String(Date.now() - Math.floor(options.updatedWithinDays) * 86_400_000)
      );
    }

    const response = await this.makeRequest<any>(
      `${this.baseUrl}/list/${listId}/task?${params.toString()}`
    );
    const tasks: any[] = response.tasks || [];

    // ClickUp's list-tasks endpoint has no server-side free-text search
    // qualifier (unlike GitHub's `q=`); filter client-side as a documented
    // fallback when a query is supplied.
    const filtered = options.query
      ? tasks.filter((t) =>
          t.name?.toLowerCase().includes(options.query!.toLowerCase())
        )
      : tasks;

    return {
      issues: filtered.map((t) => this.mapClickUpTask(t)),
      total: filtered.length,
      hasMore: response.last_page === false,
    };
  }

  async getIssueComments(issueId: string): Promise<IssueComment[]> {
    try {
      const response = await this.makeRequest<any>(
        `${this.baseUrl}/task/${issueId}/comment`
      );
      const comments: any[] = response.comments || [];
      return comments.map((c) => ({
        id: c.id != null ? String(c.id) : undefined,
        author: c.user?.username || "Unknown",
        body: c.comment_text ?? "",
        created: c.date ?? "",
      }));
    } catch (error) {
      const status = this.parseStatusFromError(error);
      const level = status === null || status >= 500 ? "error" : "warn";
      console[level](
        `[ClickUpAdapter] getIssueComments failed for %s:`,
        issueId,
        error
      );
      return [];
    }
  }

  protected async addComment(issueId: string, comment: string): Promise<void> {
    await this.makeRequest(`${this.baseUrl}/task/${issueId}/comment`, {
      method: "POST",
      body: JSON.stringify({ comment_text: comment }),
    });
  }

  /**
   * ClickUp has no flat "project" concept — walk the Team → Space →
   * (Folder →) List hierarchy and flatten it to the generic
   * `{id, key, name}` shape the rest of the app expects, where `id` is the
   * ClickUp List id `createIssue`/`searchIssues` target.
   */
  async getProjects(): Promise<
    Array<{ id: string; key: string; name: string }>
  > {
    if (!this.teamId) {
      throw new Error("ClickUp Team (workspace) ID not configured (settings.teamId).");
    }

    const spacesResponse = await this.makeRequest<any>(
      `${this.baseUrl}/team/${this.teamId}/space`
    );
    const spaces: any[] = spacesResponse.spaces || [];

    const results: Array<{ id: string; key: string; name: string }> = [];
    for (const space of spaces) {
      const [foldersResponse, folderlessListsResponse] = await Promise.all([
        this.makeRequest<any>(`${this.baseUrl}/space/${space.id}/folder`),
        this.makeRequest<any>(`${this.baseUrl}/space/${space.id}/list`),
      ]);

      for (const list of folderlessListsResponse.lists || []) {
        results.push({
          id: list.id,
          key: list.id,
          name: `${space.name} / ${list.name}`,
        });
      }
      for (const folder of foldersResponse.folders || []) {
        for (const list of folder.lists || []) {
          results.push({
            id: list.id,
            key: list.id,
            name: `${space.name} / ${folder.name} / ${list.name}`,
          });
        }
      }
    }

    return results;
  }

  private mapClickUpTask(task: any): IssueData {
    return {
      id: task.id,
      // ClickUp custom task IDs are optional (Business plan+); fall back to
      // the ClickUp task id when absent.
      key: task.custom_id || task.id,
      title: task.name,
      description: task.markdown_description ?? task.description,
      status: task.status?.status ?? "unknown",
      priority: task.priority?.priority,
      assignee: task.assignees?.[0]
        ? {
            id: String(task.assignees[0].id),
            name: task.assignees[0].username,
            email: task.assignees[0].email,
          }
        : undefined,
      reporter: task.creator
        ? {
            id: String(task.creator.id),
            name: task.creator.username,
            email: task.creator.email,
          }
        : undefined,
      labels: (task.tags || []).map((t: any) => t.name),
      customFields: {
        _clickup_list_id: task.list?.id,
      },
      // ClickUp timestamps are epoch-millisecond strings, not ISO-8601.
      createdAt: new Date(Number(task.date_created)),
      updatedAt: new Date(Number(task.date_updated)),
      url: task.url,
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
