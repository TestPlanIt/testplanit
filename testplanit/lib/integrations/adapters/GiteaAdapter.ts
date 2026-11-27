import {
  RefreshTokenRevokedError,
  isDeadRefreshTokenResponse,
} from "../errors";
import { FIXED_TRACKER_STATUSES } from "../fixedTrackerStatuses";
import { tiptapToMarkdown } from "~/lib/tiptap/tiptapToMarkdown";
import { BaseAdapter } from "./BaseAdapter";
import {
  AuthenticationData,
  CreateIssueData,
  CreateIssueMetadata,
  ExternalMilestone,
  IssueAdapterCapabilities,
  IssueAttachmentMeta,
  IssueComment,
  IssueData,
  IssueSearchOptions,
  LinkedIssueRef,
  UpdateIssueData,
} from "./IssueAdapter";

const MAX_ATTACHMENT_DOWNLOAD_BYTES = 10 * 1024 * 1024;

/** Gitea's default MAX_RESPONSE_ITEMS, the most one page returns. */
const DEFAULT_PAGE_SIZE = 50;

/** How long a milestone's name is reused before it is read again. */
const MILESTONE_TITLE_TTL_MS = 60_000;

function isTiptapDoc(value: unknown): value is { type: "doc"; content: any[] } {
  return (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    (value as { type: unknown }).type === "doc"
  );
}

/** The markdown issue body for a description given as text or a TipTap doc. */
function renderGiteaDescription(description: unknown): string {
  if (description === undefined || description === null) return "";
  if (isTiptapDoc(description)) return tiptapToMarkdown(description);
  if (typeof description === "string") return description;
  return String(description);
}

/**
 * The external id milestone sync stores for a repository milestone. Milestone
 * ids are unique across the instance, but the repository is needed to read
 * the milestone's issues back.
 */
function milestoneExternalId(
  owner: string,
  repo: string,
  id: number | string
): string {
  return `${owner}/${repo}#${id}`;
}

function parseMilestoneRef(
  id: string
): { owner: string; repo: string; id: string } | null {
  const match = id.match(/^([^/#\s]+)\/([^/#\s]+)#(\d+)$/);
  return match ? { owner: match[1], repo: match[2], id: match[3] } : null;
}

/** A date from the API, or undefined for a missing or placeholder value. */
function parseGiteaDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  const date = new Date(value);
  const year = date.getUTCFullYear();
  return Number.isNaN(date.getTime()) || year < 1971 || year >= 9999
    ? undefined
    : date;
}

export class GiteaAdapter extends BaseAdapter {
  public supportsOAuth = true;

  private owner?: string;
  private repo?: string;
  private baseUrl: string = "";

  // OAuth client credentials, plumbed per-integration by IntegrationManager.
  private clientId?: string;
  private clientSecret?: string;
  private redirectUri?: string;

  private pageSizePromise?: Promise<number>;
  private milestoneTitles = new Map<string, { title: string; at: number }>();

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
      attachments: true,
      linkedIssues: true,
      comments: true,
      // Repository milestones map onto RELEASE. Gitea sends no webhook when
      // a milestone is created, edited, closed or deleted, only when an
      // issue joins one, so synced rows are not kept fresh by webhooks.
      milestones: { kinds: ["RELEASE"], webhooks: false },
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
      if (
        extra.grant_type === "refresh_token" &&
        isDeadRefreshTokenResponse(response.status, error)
      ) {
        throw new RefreshTokenRevokedError("GITEA", error);
      }
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
    const { owner, repo } = this.resolveRepo(
      data.externalProjectId?.includes("/")
        ? data.externalProjectId
        : data.projectId
    );
    const payload: Record<string, any> = {
      title: data.title,
      body: renderGiteaDescription(data.description),
    };
    if (data.labels && data.labels.length > 0) {
      const labelIds = await this.resolveLabelIds(owner, repo, data.labels);
      if (labelIds.length > 0) payload.labels = labelIds;
    }
    if (data.assigneeIds && data.assigneeIds.length > 0) {
      payload.assignees = data.assigneeIds;
    } else if (data.assigneeId) {
      payload.assignees = [data.assigneeId];
    }
    const milestoneId = Number(data.milestone);
    if (data.milestone && Number.isInteger(milestoneId) && milestoneId > 0) {
      payload.milestone = milestoneId;
    }
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
      payload.body = renderGiteaDescription(data.description);
    }
    if (data.status !== undefined) {
      payload.state = this.mapStatusToGitea(data.status);
    }
    if (data.assigneeIds !== undefined) {
      payload.assignees = data.assigneeIds;
    } else if (data.assigneeId !== undefined) {
      payload.assignees = [data.assigneeId];
    }
    if (data.milestone !== undefined) {
      const milestoneId = Number(data.milestone);
      // Gitea clears the milestone on 0.
      payload.milestone =
        Number.isInteger(milestoneId) && milestoneId > 0 ? milestoneId : 0;
    }
    const issueUrl = `${this.baseUrl}/api/v1/repos/${owner}/${repo}/issues/${number}`;
    // The edit call takes no labels; they are replaced through their own
    // endpoint first so the edit's response already carries them.
    if (data.labels !== undefined) {
      const labelIds = await this.resolveLabelIds(owner, repo, data.labels);
      await this.makeRequest(`${issueUrl}/labels`, {
        method: "PUT",
        body: JSON.stringify({ labels: labelIds }),
      });
    }
    const response = await this.makeRequest<any>(issueUrl, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
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
      const response = await this.listAllPages(
        `${this.baseUrl}/api/v1/repos/${owner}/${repo}/issues/${number}/comments`
      );
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

  /**
   * Issue dependencies, in both directions: the issues this one depends on
   * and the issues it blocks. A dependency can sit in another repository,
   * so each ref carries its own `owner/repo#number`, which `getIssue`
   * resolves. A repository without dependencies, or a server without the
   * endpoints (Gogs), has none.
   */
  async getLinkedIssues(issueId: string): Promise<LinkedIssueRef[]> {
    let owner: string;
    let repo: string;
    let number: string;
    try {
      ({ owner, repo, number } = this.parseIssueRef(issueId));
    } catch (error) {
      console.warn(
        `[GiteaAdapter] getLinkedIssues failed for %s:`,
        issueId,
        error
      );
      return [];
    }

    const issueUrl = `${this.baseUrl}/api/v1/repos/${owner}/${repo}/issues/${number}`;
    const [dependencies, blocks] = await Promise.allSettled([
      this.listAllPages(`${issueUrl}/dependencies`),
      this.listAllPages(`${issueUrl}/blocks`),
    ]);

    const refs: LinkedIssueRef[] = [];
    const collect = (
      result: PromiseSettledResult<any[]>,
      linkType: string,
      direction: LinkedIssueRef["direction"]
    ) => {
      if (result.status === "rejected") {
        const status = this.parseStatusFromError(result.reason);
        const level = status === null || status >= 500 ? "error" : "warn";
        console[level](
          `[GiteaAdapter] %s lookup failed for %s:`,
          linkType,
          issueId,
          result.reason
        );
        return;
      }
      for (const linked of result.value) {
        if (linked?.number == null) continue;
        const key = `${linked.repository?.full_name ?? `${owner}/${repo}`}#${linked.number}`;
        refs.push({ id: key, key, linkType, direction });
      }
    };
    collect(dependencies, "depends on", "outward");
    collect(blocks, "blocks", "inward");
    return refs;
  }

  async getProjects(): Promise<
    Array<{ id: string; key: string; name: string }>
  > {
    const repos = await this.listAllPages(
      `${this.baseUrl}/api/v1/repos/search`,
      { token: "" }
    );
    return repos.map((r) => ({
      id: r.full_name,
      key: r.name,
      name: r.full_name,
    }));
  }

  // Gitea's default MAX_RESPONSE_ITEMS is 50; larger `limit` values are
  // silently clamped, so the loop ends on a short page rather than a count.
  private async listAllPages(
    url: string,
    query: Record<string, string> = {},
    limit: number = DEFAULT_PAGE_SIZE
  ): Promise<any[]> {
    const items: any[] = [];
    for (let page = 1; ; page++) {
      const params = new URLSearchParams({
        ...query,
        limit: String(limit),
        page: String(page),
      });
      const response = await this.makeRequest<any>(`${url}?${params}`);
      const pageItems: any[] = Array.isArray(response)
        ? response
        : Array.isArray(response?.data)
          ? response.data
          : [];
      items.push(...pageItems);
      if (pageItems.length < limit) break;
    }
    return items;
  }

  /**
   * The most items this instance returns in one page. An administrator can
   * set MAX_RESPONSE_ITEMS below the default, and a read that took such a
   * clamped page for the last one would stop early. A server that does not
   * report the setting is taken to use the default; a request that merely
   * failed is asked again next time.
   */
  private pageSize(): Promise<number> {
    this.pageSizePromise ??= this.makeRequest<any>(
      `${this.baseUrl}/api/v1/settings/api`
    ).then(
      (settings) => {
        const max = Number(settings?.max_response_items);
        return Number.isInteger(max) && max > 0
          ? Math.min(max, DEFAULT_PAGE_SIZE)
          : DEFAULT_PAGE_SIZE;
      },
      (error) => {
        const status = this.parseStatusFromError(error);
        if (status === null || status >= 500) {
          this.pageSizePromise = undefined;
        }
        return DEFAULT_PAGE_SIZE;
      }
    );
    return this.pageSizePromise;
  }

  /**
   * The repository's labels plus, for a repository an organization owns,
   * the organization's. The organization endpoint answers 404 for a
   * user-owned repository.
   */
  private async listLabels(owner: string, repo: string): Promise<any[]> {
    const labels = await this.listAllPages(
      `${this.baseUrl}/api/v1/repos/${owner}/${repo}/labels`
    );
    try {
      labels.push(
        ...(await this.listAllPages(
          `${this.baseUrl}/api/v1/orgs/${owner}/labels`
        ))
      );
    } catch {
      // User-owned repository, or organization labels unreadable.
    }
    return labels;
  }

  /**
   * The ids of the labels with the given names. Gitea takes label ids when
   * an issue is created or relabelled and rejects names. A name no label
   * carries is left out.
   */
  private async resolveLabelIds(
    owner: string,
    repo: string,
    names: string[]
  ): Promise<number[]> {
    if (names.length === 0) return [];
    const idByName = new Map<string, number>();
    for (const label of await this.listLabels(owner, repo)) {
      if (
        typeof label?.name === "string" &&
        typeof label.id === "number" &&
        !idByName.has(label.name)
      ) {
        idByName.set(label.name, label.id);
      }
    }
    const ids = new Set<number>();
    for (const name of names) {
      const id = idByName.get(name);
      if (id !== undefined) ids.add(id);
    }
    return [...ids];
  }

  /**
   * Everything the create form can offer for one repository: labels by
   * name, open milestones by id and assignable users by login. Gitea has no
   * issue types. The lists are fetched together; one that fails is returned
   * empty so the form still opens with the rest.
   */
  async getCreateIssueMetadata(
    projectKey: string
  ): Promise<CreateIssueMetadata> {
    const { owner, repo } = this.resolveRepo(projectKey);
    const repoUrl = `${this.baseUrl}/api/v1/repos/${owner}/${repo}`;
    const emptyOnFailure = (list: string) => (error: unknown) => {
      console.error(`[GiteaAdapter] ${list} lookup failed:`, error);
      return [] as any[];
    };
    const [labels, milestones, assignees] = await Promise.all([
      this.listLabels(owner, repo).catch(emptyOnFailure("labels")),
      this.listAllPages(`${repoUrl}/milestones`, { state: "open" }).catch(
        emptyOnFailure("milestones")
      ),
      this.makeRequest<any[]>(`${repoUrl}/assignees`).catch(
        emptyOnFailure("assignees")
      ),
    ]);

    const labelNames = new Set<string>();
    return {
      labels: labels
        .filter((label) => {
          if (
            typeof label?.name !== "string" ||
            label.name === "" ||
            label.is_archived ||
            labelNames.has(label.name)
          ) {
            return false;
          }
          labelNames.add(label.name);
          return true;
        })
        .map((label) => ({
          id: label.name,
          name: label.name,
          color: label.color ?? undefined,
        })),
      milestones: milestones.map((milestone) => ({
        id: String(milestone.id),
        title: milestone.title ?? String(milestone.id),
        state: milestone.state ?? "open",
        dueOn: parseGiteaDate(milestone.due_on) ? milestone.due_on : null,
        externalId: milestoneExternalId(owner, repo, milestone.id),
      })),
      assignees: (Array.isArray(assignees) ? assignees : [])
        .filter((user) => typeof user?.login === "string")
        .map((user) => ({
          id: user.login,
          name: user.full_name || user.login,
          avatarUrl: user.avatar_url ?? undefined,
        })),
      issueTypes: [],
    };
  }

  /**
   * Repository milestones in the provider-neutral shape milestone sync
   * consumes. A milestone is ACTIVE while open and CLOSED once closed; it
   * has a due date but no start date, and Gitea has nothing sprint-like.
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
    if (options.kind === "ITERATION") {
      return { items: [], hasMore: false };
    }
    const { owner, repo } = this.resolveRepo(options.projectKey);
    const milestones = await this.listAllPages(
      `${this.baseUrl}/api/v1/repos/${owner}/${repo}/milestones`,
      { state: options.includeClosed ? "all" : "open" },
      await this.pageSize()
    );
    const now = Date.now();
    return {
      items: milestones.map((milestone) => {
        const mapped = this.mapGiteaMilestone(milestone, owner, repo);
        if (typeof milestone.title === "string") {
          this.milestoneTitles.set(mapped.id, {
            title: milestone.title,
            at: now,
          });
        }
        return mapped;
      }),
      hasMore: false,
    };
  }

  /**
   * The issues in a milestone, a page at a time. Gitea's milestone filter
   * matches names before ids and drops a value that matches neither, which
   * returns every issue in the repository. So the filter is given the
   * milestone's name, and each issue is still checked against its id.
   * `hasMore` follows the raw page, which that check can only shorten. A
   * milestone that no longer exists is an error, never an empty list.
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
    const parsed = parseMilestoneRef(ref.id);
    if (!parsed || ref.kind !== "RELEASE") {
      return { issues: [], hasMore: false };
    }
    const { owner, repo, id } = parsed;
    const title = await this.milestoneTitle(owner, repo, id);
    const perPage = await this.pageSize();
    const page = Math.max(1, Number(options?.pageToken) || 1);
    const params = new URLSearchParams({
      type: "issues",
      state: "all",
      // The filter takes a comma-separated list, so a name with a comma
      // cannot be passed.
      milestones: title.includes(",") ? id : title,
      limit: String(perPage),
      page: String(page),
    });
    const raw = await this.makeRequest<any[]>(
      `${this.baseUrl}/api/v1/repos/${owner}/${repo}/issues?${params.toString()}`
    );
    const items = Array.isArray(raw) ? raw : [];
    const hasMore = items.length === perPage;
    return {
      issues: items
        .filter(
          (issue) => !issue.pull_request && String(issue.milestone?.id) === id
        )
        .map((issue) => this.mapGiteaIssue(issue, owner, repo)),
      hasMore,
      nextPageToken: hasMore ? String(page + 1) : undefined,
    };
  }

  private async milestoneTitle(
    owner: string,
    repo: string,
    id: string
  ): Promise<string> {
    const key = milestoneExternalId(owner, repo, id);
    const cached = this.milestoneTitles.get(key);
    if (cached && Date.now() - cached.at < MILESTONE_TITLE_TTL_MS) {
      return cached.title;
    }
    const milestone = await this.makeRequest<any>(
      `${this.baseUrl}/api/v1/repos/${owner}/${repo}/milestones/${id}`
    );
    if (String(milestone?.id) !== id || typeof milestone.title !== "string") {
      throw new Error(`Gitea milestone ${key} was not found`);
    }
    this.milestoneTitles.set(key, { title: milestone.title, at: Date.now() });
    return milestone.title;
  }

  private mapGiteaMilestone(
    raw: any,
    owner: string,
    repo: string
  ): ExternalMilestone {
    const closed = raw.state === "closed";
    const dueOn = parseGiteaDate(raw.due_on);
    return {
      id: milestoneExternalId(owner, repo, raw.id),
      kind: "RELEASE",
      name: raw.title ?? String(raw.id),
      description: raw.description || undefined,
      endDate: closed ? (parseGiteaDate(raw.closed_at) ?? dueOn) : dueOn,
      state: closed ? "CLOSED" : "ACTIVE",
      rawState: closed ? "closed" : "open",
      url: `${this.baseUrl}/${owner}/${repo}/milestone/${raw.id}`,
    };
  }

  /**
   * Attach a file to an issue. Gitea refuses a file over its size limit
   * (413) or of a type the instance does not allow (422).
   */
  async uploadAttachment(
    issueId: string,
    file: Buffer,
    filename: string
  ): Promise<{ id: string; url: string }> {
    const { owner, repo, number } = this.parseIssueRef(issueId);
    const form = new FormData();
    form.append("attachment", new Blob([new Uint8Array(file)]), filename);

    const response = await this.makeRequest<any>(
      `${this.baseUrl}/api/v1/repos/${owner}/${repo}/issues/${number}/assets`,
      { method: "POST", body: form }
    );
    return {
      id: String(response?.id ?? ""),
      url: String(response?.browser_download_url ?? ""),
    };
  }

  /**
   * The files attached to an issue and to its comments. Gitea records no
   * content type, so `mimeType` is left for the caller to work out from
   * the filename. A server without the endpoint (Gogs) has none.
   */
  async listAttachments(issueId: string): Promise<IssueAttachmentMeta[]> {
    const { owner, repo, number } = this.parseIssueRef(issueId);
    const issueUrl = `${this.baseUrl}/api/v1/repos/${owner}/${repo}/issues/${number}`;

    let assets: any[];
    try {
      const response = await this.makeRequest<any[]>(`${issueUrl}/assets`);
      assets = Array.isArray(response) ? [...response] : [];
    } catch (error) {
      if (this.parseStatusFromError(error) === 404) return [];
      throw error;
    }
    try {
      for (const comment of await this.listAllPages(`${issueUrl}/comments`)) {
        if (Array.isArray(comment?.assets)) assets.push(...comment.assets);
      }
    } catch (error) {
      console.warn(
        `[GiteaAdapter] comment attachments unavailable for %s:`,
        issueId,
        error
      );
    }

    const seen = new Set<string>();
    const out: IssueAttachmentMeta[] = [];
    for (const asset of assets) {
      if (asset?.id == null || !asset.uuid || seen.has(String(asset.id))) {
        continue;
      }
      seen.add(String(asset.id));
      out.push({
        id: String(asset.id),
        filename: asset.name ? String(asset.name) : `attachment-${asset.id}`,
        byteSize: typeof asset.size === "number" ? asset.size : undefined,
        createdAt: parseGiteaDate(asset.created_at),
        // Built on the configured instance URL, not the server-reported
        // download URL, so the token only ever goes to this instance.
        contentUrl: `${this.baseUrl}/attachments/${encodeURIComponent(String(asset.uuid))}`,
      });
    }
    return out;
  }

  async downloadAttachment(
    meta: IssueAttachmentMeta
  ): Promise<{ buffer: Buffer; mimeType?: string }> {
    if (!meta.contentUrl) {
      throw new Error("Gitea attachment has no download URL");
    }
    const { buffer, contentType } = await this.makeBinaryRequest(
      meta.contentUrl,
      MAX_ATTACHMENT_DOWNLOAD_BYTES
    );
    const mimeType =
      contentType && contentType !== "application/octet-stream"
        ? contentType
        : meta.mimeType;
    return { buffer, mimeType };
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

  /** Its issues are only ever open or closed. */
  async getStatuses(): Promise<Array<{ id: string; name: string }>> {
    return [...FIXED_TRACKER_STATUSES.GITEA];
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
