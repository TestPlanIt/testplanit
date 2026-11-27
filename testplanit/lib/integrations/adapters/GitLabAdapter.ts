import {
  RefreshTokenRevokedError,
  isDeadRefreshTokenResponse,
} from "../errors";
import { FIXED_TRACKER_STATUSES } from "../fixedTrackerStatuses";
import { tiptapToMarkdown } from "~/lib/tiptap/tiptapToMarkdown";
import { parseUpstreamDate } from "~/utils/calendarDate";
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

/**
 * A file uploaded to a GitLab project is referenced from markdown as
 * `/uploads/<secret>/<filename>`; the secret and filename are what the
 * download endpoint takes.
 */
const UPLOAD_LINK_RE = /\/uploads\/([0-9a-f]{32})\/([^\s)"'<>]+)/g;

function isTiptapDoc(value: unknown): value is { type: "doc"; content: any[] } {
  return (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    (value as { type: unknown }).type === "doc"
  );
}

function renderGitLabDescription(description: unknown): string {
  if (description === undefined || description === null) return "";
  if (isTiptapDoc(description)) return tiptapToMarkdown(description);
  return typeof description === "string" ? description : String(description);
}

/** `namespace/project#id`, the external id milestone sync stores for a GitLab milestone. */
function milestoneExternalId(projectPath: string, id: number | string) {
  return `${projectPath}#${id}`;
}

function parseMilestoneRef(
  id: string
): { projectPath: string; milestoneId: string } | null {
  const match = id.match(/^(.+)#(\d+)$/);
  return match ? { projectPath: match[1], milestoneId: match[2] } : null;
}

/**
 * GitLab milestones are active or closed; an active one whose start date is
 * still ahead is what GitLab itself labels "Upcoming".
 */
function mapGitLabMilestone(raw: any, projectPath: string): ExternalMilestone {
  const closed = raw.state === "closed";
  const startDate = raw.start_date
    ? parseUpstreamDate(raw.start_date).date
    : undefined;
  const upcoming =
    !closed && startDate !== undefined && startDate.getTime() > Date.now();
  return {
    id: milestoneExternalId(projectPath, raw.id),
    kind: "RELEASE",
    name: raw.title ?? String(raw.iid ?? raw.id),
    description: raw.description ?? undefined,
    startDate,
    endDate: raw.due_date ? parseUpstreamDate(raw.due_date).date : undefined,
    state: closed ? "CLOSED" : upcoming ? "FUTURE" : "ACTIVE",
    rawState: closed ? "closed" : upcoming ? "upcoming" : "active",
    url: raw.web_url ?? undefined,
  };
}

function numericIds(values: Array<string | undefined>): number[] {
  return values
    .map((value) => parseInt(value ?? "", 10))
    .filter((value) => !Number.isNaN(value));
}

/**
 * Decodes the per-issue-type page cursor `searchIssues` round-trips through
 * `pageToken`: `{ "<issue_type>": <next page>, ... }`, with `""` standing for
 * "no type selected".
 *
 * Returns `null` for anything it does not recognize, which is deliberate
 * rather than defensive. `pageToken` is a shared field on
 * `IssueSearchOptions` and the orchestrator hands whatever it last received
 * straight back; a token minted by a different adapter (Jira Cloud's opaque
 * cursor) or a malformed one must fall back to the offset-derived page rather
 * than throw mid-import or silently resume from page 1 of everything.
 */
function parseGitLabTypeCursor(
  pageToken: string | undefined
): Record<string, number> | null {
  if (!pageToken) return null;
  try {
    const parsed = JSON.parse(pageToken);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const cursor: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
        return null;
      }
      cursor[key] = value;
    }
    return cursor;
  } catch {
    return null;
  }
}

export class GitLabAdapter extends BaseAdapter {
  public supportsOAuth = true;

  private projectPath?: string;
  private baseUrl: string = "https://gitlab.com";

  // OAuth client credentials, plumbed per-integration by IntegrationManager.
  private clientId?: string;
  private clientSecret?: string;
  private redirectUri?: string;

  constructor(config: any) {
    super(config);
    if (config.projectPath) this.projectPath = config.projectPath;
    // The config form stores the self-managed URL as `instanceUrl`; accept
    // either key so the OAuth endpoints and API calls hit the right instance.
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
      milestones: { kinds: ["RELEASE"], webhooks: true },
    };
  }

  protected async performAuthentication(
    authData: AuthenticationData
  ): Promise<void> {
    if (authData.baseUrl) {
      this.baseUrl = authData.baseUrl.replace(/\/$/, "");
    }

    if (authData.type === "oauth") {
      if (!authData.accessToken) {
        throw new Error("GitLab OAuth authentication requires an access token");
      }
      // makeRequest sends `Authorization: Bearer <token>` for the oauth auth
      // type, which GitLab uses for OAuth (PAT uses the PRIVATE-TOKEN header).
      try {
        await this.makeRequest(`${this.baseUrl}/api/v4/user`);
      } catch {
        throw new Error("Invalid GitLab OAuth access token");
      }
      return;
    }

    if (authData.type !== "api_key") {
      throw new Error(
        "GitLab adapter only supports OAuth and Personal Access Token authentication"
      );
    }
    if (!authData.apiKey) {
      throw new Error(
        "Personal Access Token is required for GitLab authentication"
      );
    }
    try {
      await this.makeRequest(`${this.baseUrl}/api/v4/user`);
    } catch {
      throw new Error("Invalid GitLab Personal Access Token");
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
      scope: "api",
      state,
    });
    return `${this.baseUrl}/oauth/authorize?${params.toString()}`;
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
    const response = await fetch(`${this.baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
        throw new RefreshTokenRevokedError("GITLAB", error);
      }
      throw new Error(`Failed to obtain GitLab tokens: ${error}`);
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
    const projectPath = this.resolveProjectPath(data.projectId);
    const encoded = encodeURIComponent(projectPath);
    const payload: Record<string, any> = {
      title: data.title,
      description: renderGitLabDescription(data.description),
      labels: data.labels?.join(",") ?? "",
    };
    const assigneeIds = numericIds(
      data.assigneeIds?.length ? data.assigneeIds : [data.assigneeId]
    );
    if (assigneeIds.length > 0) payload.assignee_ids = assigneeIds;
    const [milestoneId] = numericIds([data.milestone]);
    if (milestoneId !== undefined) payload.milestone_id = milestoneId;
    if (data.issueType) payload.issue_type = data.issueType;
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
      payload.description = renderGitLabDescription(data.description);
    }
    if (data.status !== undefined) {
      payload.state_event = this.mapStatusToGitLab(data.status);
    }
    if (data.labels !== undefined) payload.labels = data.labels.join(",");
    if (data.assigneeIds !== undefined) {
      payload.assignee_ids = numericIds(data.assigneeIds);
    } else if (data.assigneeId !== undefined) {
      const assigneeId = parseInt(data.assigneeId, 10);
      payload.assignee_id = isNaN(assigneeId) ? 0 : assigneeId;
    }
    if (data.milestone !== undefined) {
      payload.milestone_id = numericIds([data.milestone])[0] ?? 0;
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
    nextPageToken?: string;
  }> {
    // GitLab's `issue_type` filter accepts exactly ONE value, unlike Jira/ADO's
    // IN-list syntax — see 28-RESEARCH Q1 (CITED, docs.gitlab.com/api/issues/).
    // For >1 selected type we fetch each type sequentially (never in parallel:
    // GitLab pagination doesn't compose across merged cursors from concurrent
    // queries) and concatenate in selection order, letting the import
    // orchestrator's own `seen` de-dup Set (SyncService.ts) merge the results
    // the same way it already does for this adapter's degraded recency-window
    // path. `[undefined]` (no selected types) preserves today's single request.
    const types = options.issueTypeIds?.length
      ? options.issueTypeIds
      : [undefined];

    // EACH TYPE PAGES INDEPENDENTLY, carried across calls in `pageToken`.
    // A single shared page number cannot work here: the orchestrator advances
    // its `offset` by the CONCATENATED row count, so with N types that offset
    // moves N pages per iteration and a page derived from it steps
    // 1 -> N+1 -> 2N+1, never requesting the pages in between. Dividing the
    // offset by `types.length` instead only holds while every type returns
    // full pages -- the moment one runs short the division re-derives a page
    // that type has already been served.
    //
    // A type that has no more pages is dropped from the cursor entirely, so it
    // is not re-queried while the others finish.
    const cursor = parseGitLabTypeCursor(options.pageToken);
    const nextCursor: Record<string, number> = {};

    let issues: IssueData[] = [];
    let total = 0;
    let hasMore = false;
    for (const issueType of types) {
      const key = issueType ?? "";
      // No cursor yet (the first call, or an offset-paginated caller such as
      // preview/sampling): fall back to the offset-derived page, which is
      // correct for a single type and is page 1 for all of them at offset 0.
      if (cursor && !(key in cursor)) continue;
      const page =
        cursor?.[key] ??
        Math.floor((options.offset || 0) / (options.limit || 30) + 1);

      const result = await this.searchIssuesForType(options, issueType, page);
      issues = issues.concat(result.issues);
      total += result.total;
      if (result.hasMore) {
        nextCursor[key] = page + 1;
        hasMore = true;
      }
    }

    return {
      issues,
      total,
      hasMore,
      nextPageToken: hasMore ? JSON.stringify(nextCursor) : undefined,
    };
  }

  /**
   * The single-request body searchIssues fans out over — one call per
   * selected issue type (or one call total when none are selected).
   */
  private async searchIssuesForType(
    options: IssueSearchOptions,
    issueType: string | undefined,
    page: number
  ): Promise<{ issues: IssueData[]; total: number; hasMore: boolean }> {
    const projectPath = this.resolveProjectPath(options.projectId);
    const encoded = encodeURIComponent(projectPath);
    const params = new URLSearchParams({
      per_page: (options.limit || 30).toString(),
      page: page.toString(),
    });
    if (options.query) {
      // Key format: "namespace/project#iid" — use iids[] for exact lookup
      const keyMatch = options.query.match(/^.+#(\d+)$/);
      if (keyMatch) {
        params.set("iids[]", keyMatch[1]);
      } else {
        params.set("search", options.query);
      }
    }
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
    if (issueType) params.set("issue_type", issueType);
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
      const notes = await this.listAllPages(
        `${this.baseUrl}/api/v4/projects/${encoded}/issues/${iid}/notes`,
        { sort: "asc", order_by: "created_at" }
      );
      return notes
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

  /**
   * GitLab reports each link from the side of the issue asked about:
   * `relates_to`, `blocks` or `is_blocked_by` (the last two on Premium and
   * Ultimate only).
   */
  async getLinkedIssues(issueId: string): Promise<LinkedIssueRef[]> {
    try {
      const { projectPath, iid } = this.parseIssueRef(issueId);
      const encoded = encodeURIComponent(projectPath);
      const links = await this.listAllPages(
        `${this.baseUrl}/api/v4/projects/${encoded}/issues/${iid}/links`
      );
      return links
        .filter((link) => link?.iid != null)
        .map((link) => ({
          id: String(link.iid),
          key: link.references?.full ?? `${projectPath}#${link.iid}`,
          linkType: link.link_type ?? "relates_to",
          direction: link.link_type === "is_blocked_by" ? "inward" : "outward",
        }));
    } catch (error) {
      console.warn("[GitLabAdapter] getLinkedIssues failed:", error);
      return [];
    }
  }

  /**
   * GitLab has no per-issue attachments: a file is uploaded to the project
   * and becomes part of an issue when its markdown link is placed in the
   * description. The link is appended there.
   */
  async uploadAttachment(
    issueId: string,
    file: Buffer,
    filename: string
  ): Promise<{ id: string; url: string }> {
    const { projectPath, iid } = this.parseIssueRef(issueId);
    const encoded = encodeURIComponent(projectPath);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(file)]), filename);
    const upload = await this.makeRequest<any>(
      `${this.baseUrl}/api/v4/projects/${encoded}/uploads`,
      { method: "POST", body: form }
    );
    if (!upload?.markdown) {
      throw new Error("GitLab did not return a link for the uploaded file");
    }

    const issueUrl = `${this.baseUrl}/api/v4/projects/${encoded}/issues/${iid}`;
    const issue = await this.makeRequest<any>(issueUrl);
    const description = [issue?.description, upload.markdown]
      .filter((part) => typeof part === "string" && part !== "")
      .join("\n\n");
    await this.makeRequest(issueUrl, {
      method: "PUT",
      body: JSON.stringify({ description }),
    });

    return {
      id: String(upload.id ?? ""),
      url: upload.full_path ? `${this.baseUrl}${upload.full_path}` : "",
    };
  }

  /**
   * The files linked from the issue's description and comments. GitLab has
   * no listing of an issue's uploads, so they are read out of the markdown.
   */
  async listAttachments(issueId: string): Promise<IssueAttachmentMeta[]> {
    const { projectPath, iid } = this.parseIssueRef(issueId);
    const encoded = encodeURIComponent(projectPath);
    const issueUrl = `${this.baseUrl}/api/v4/projects/${encoded}/issues/${iid}`;
    const issue = await this.makeRequest<any>(issueUrl);
    let notes: any[] = [];
    try {
      notes = await this.listAllPages(`${issueUrl}/notes`, {
        sort: "asc",
        order_by: "created_at",
      });
    } catch (error) {
      console.warn(
        "[GitLabAdapter] listAttachments could not read notes:",
        error
      );
    }

    const texts = [
      issue?.description,
      ...notes.filter((note) => !note.system).map((note) => note.body),
    ];
    const seen = new Set<string>();
    const attachments: IssueAttachmentMeta[] = [];
    for (const text of texts) {
      if (typeof text !== "string") continue;
      for (const match of text.matchAll(UPLOAD_LINK_RE)) {
        const [, secret, rawName] = match;
        const id = `${secret}/${rawName}`;
        if (seen.has(id)) continue;
        seen.add(id);
        let filename = rawName;
        try {
          filename = decodeURIComponent(rawName);
        } catch {
          // Keep the name as written when it is not valid percent-encoding.
        }
        attachments.push({
          id,
          filename,
          contentUrl: `${this.baseUrl}/api/v4/projects/${encoded}/uploads/${secret}/${encodeURIComponent(filename)}`,
        });
      }
    }
    return attachments;
  }

  async downloadAttachment(
    meta: IssueAttachmentMeta
  ): Promise<{ buffer: Buffer; mimeType?: string }> {
    if (!meta.contentUrl) {
      throw new Error("GitLab attachment has no download URL");
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
   * The project's milestones, and those of the groups above it, in the
   * shape milestone sync consumes. The external id is
   * `namespace/project#<milestone id>`: enough for `getMilestoneIssues` to
   * find the project again, and unique across the integration. GitLab has
   * no ITERATION artifact on the Free tier.
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
    const projectPath = this.resolveProjectPath(options.projectKey);
    const milestones = await this.listProjectMilestones(
      projectPath,
      options.includeClosed ? "all" : "active"
    );
    return {
      items: milestones.map((milestone) =>
        mapGitLabMilestone(milestone, projectPath)
      ),
      hasMore: false,
    };
  }

  /**
   * The project's issues in a milestone, a page at a time. A group
   * milestone is shared by every project under the group; only this
   * project's issues are its members here. A milestone that no longer
   * exists is an error, never an empty list, which would read as every
   * member having left.
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
    const { projectPath, milestoneId } = parsed;
    const title = await this.resolveMilestoneTitle(projectPath, milestoneId);
    if (title === null) {
      throw new Error(`GitLab milestone ${ref.id} was not found`);
    }
    const encoded = encodeURIComponent(projectPath);
    const page = Math.max(1, Number(options?.pageToken) || 1);
    const perPage = Math.min(100, Math.max(1, options?.limit ?? 100));
    const params = new URLSearchParams({
      milestone: title,
      state: "all",
      scope: "all",
      per_page: String(perPage),
      page: String(page),
    });
    const raw = await this.makeRequest<any[]>(
      `${this.baseUrl}/api/v4/projects/${encoded}/issues?${params.toString()}`
    );
    const items = Array.isArray(raw) ? raw : [];
    const hasMore = items.length === perPage;
    return {
      issues: items.map((issue) => this.mapGitLabIssue(issue, projectPath)),
      hasMore,
      nextPageToken: hasMore ? String(page + 1) : undefined,
    };
  }

  private milestoneTitles = new Map<string, string>();

  private async listProjectMilestones(
    projectPath: string,
    state: "active" | "all"
  ): Promise<any[]> {
    const query: Record<string, string> = { include_ancestors: "true" };
    if (state === "active") query.state = "active";
    const milestones = await this.listAllPages(
      `${this.baseUrl}/api/v4/projects/${encodeURIComponent(projectPath)}/milestones`,
      query
    );
    for (const milestone of milestones) {
      if (milestone?.id != null && typeof milestone.title === "string") {
        this.milestoneTitles.set(
          milestoneExternalId(projectPath, milestone.id),
          milestone.title
        );
      }
    }
    return milestones;
  }

  /**
   * GitLab filters a project's issues by milestone title, the one filter
   * that covers project and group milestones alike.
   */
  private async resolveMilestoneTitle(
    projectPath: string,
    milestoneId: string
  ): Promise<string | null> {
    const key = milestoneExternalId(projectPath, milestoneId);
    if (!this.milestoneTitles.has(key)) {
      await this.listProjectMilestones(projectPath, "all");
    }
    return this.milestoneTitles.get(key) ?? null;
  }

  /**
   * Labels, open milestones and members the create form can offer for one
   * project. A list that fails is returned empty so the form still opens
   * with the rest. Issue types come from `getIssueTypes`.
   */
  async getCreateIssueMetadata(
    projectKey: string
  ): Promise<CreateIssueMetadata> {
    const projectPath = this.resolveProjectPath(projectKey);
    const projectUrl = `${this.baseUrl}/api/v4/projects/${encodeURIComponent(projectPath)}`;
    const [labels, milestones, members] = await Promise.all([
      this.listAllPages(`${projectUrl}/labels`).catch((error) => {
        console.error("[GitLabAdapter] labels failed:", error);
        return [];
      }),
      this.listProjectMilestones(projectPath, "active").catch((error) => {
        console.error("[GitLabAdapter] milestones failed:", error);
        return [];
      }),
      this.listAllPages(`${projectUrl}/members/all`, { state: "active" }).catch(
        (error) => {
          console.error("[GitLabAdapter] members failed:", error);
          return [];
        }
      ),
    ]);
    return {
      labels: labels.map((label) => ({
        id: label.name,
        name: label.name,
        color: label.color,
      })),
      milestones: milestones.map((milestone) => ({
        id: String(milestone.id),
        title: milestone.title,
        state: milestone.state,
        dueOn: milestone.due_date ?? null,
        externalId: milestoneExternalId(projectPath, milestone.id),
      })),
      assignees: members.map((member) => ({
        id: String(member.id),
        name: member.name ?? member.username,
        avatarUrl: member.avatar_url ?? undefined,
      })),
      issueTypes: [],
    };
  }

  async getIssueTypes(
    _projectId: string
  ): Promise<Array<{ id: string; name: string }>> {
    // GitLab CE/Free supports "issue" and "incident"; paid tiers add task/objective/key_result
    return [
      { id: "issue", name: "Issue" },
      { id: "incident", name: "Incident" },
    ];
  }

  async getProjects(): Promise<
    Array<{ id: string; key: string; name: string }>
  > {
    const projects = await this.listAllPages(
      `${this.baseUrl}/api/v4/projects`,
      { membership: "true", simple: "true", order_by: "last_activity_at" }
    );
    return projects.map((p) => ({
      id: p.path_with_namespace,
      key: p.path_with_namespace,
      name: p.name_with_namespace ?? p.path_with_namespace,
    }));
  }

  // GitLab caps per_page at 100; `url` must not already carry a query string.
  private async listAllPages(
    url: string,
    query: Record<string, string> = {}
  ): Promise<any[]> {
    const items: any[] = [];
    for (let page = 1; ; page++) {
      const params = new URLSearchParams({
        ...query,
        per_page: "100",
        page: String(page),
      });
      const pageItems = await this.makeRequest<any[]>(`${url}?${params}`);
      if (!Array.isArray(pageItems)) break;
      items.push(...pageItems);
      if (pageItems.length < 100) break;
    }
    return items;
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

  /** Its issues are only ever open or closed. */
  async getStatuses(): Promise<Array<{ id: string; name: string }>> {
    return [...FIXED_TRACKER_STATUSES.GITLAB];
  }

  private mapStatusToGitLab(status: string): string {
    const lower = status.toLowerCase();
    if (lower === "closed" || lower === "done" || lower === "resolved") {
      return "close";
    }
    return "reopen";
  }

  /**
   * GitLab CE/Free only ever sends "issue" or "incident" in `issue_type`;
   * paid tiers (Premium/Ultimate) add task/objective/key_result, which this
   * adapter's getIssueTypes does not enumerate. Fall back to the raw value
   * itself as both id and name rather than mislabeling an unrecognized type.
   */
  private static readonly ISSUE_TYPE_LABELS: Record<string, string> = {
    issue: "Issue",
    incident: "Incident",
  };

  private mapGitLabIssue(issue: any, projectPath: string): IssueData {
    const iid = issue.iid;
    const key = `${projectPath}#${iid}`;
    // getIssueTypes returns the literal "issue"/"incident" strings as both
    // id and name — issueType.id must match those exactly for classification
    // to see it.
    const rawType =
      typeof issue.issue_type === "string" && issue.issue_type
        ? issue.issue_type
        : "issue";
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
      issueType: {
        id: rawType,
        name: GitLabAdapter.ISSUE_TYPE_LABELS[rawType] ?? rawType,
      },
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
