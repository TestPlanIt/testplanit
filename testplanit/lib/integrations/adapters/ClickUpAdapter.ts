import { tiptapToMarkdown } from "~/lib/tiptap/tiptapToMarkdown";
import { BaseAdapter } from "./BaseAdapter";
import {
  AuthenticationData,
  CreateIssueData,
  IssueAdapterCapabilities,
  IssueAttachmentMeta,
  IssueComment,
  IssueCountOptions,
  IssueCountResult,
  IssueData,
  IssueSearchOptions,
  LinkedIssueRef,
  UpdateIssueData,
  WebhookData,
} from "./IssueAdapter";

const MAX_ATTACHMENT_DOWNLOAD_BYTES = 10 * 1024 * 1024;

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

/**
 * ClickUp's Get Tasks endpoint always returns this many tasks per page,
 * regardless of any limit the caller requests — pagination math must be
 * done in terms of this fixed size, never the caller's `limit`.
 */
const CLICKUP_TASK_PAGE_SIZE = 100;

/**
 * Upper bound on ClickUp pages scanned for one text-query search, so a
 * huge List with no match can't turn an interactive search into an
 * unbounded fetch loop (MAX_QUERY_SCAN_PAGES * CLICKUP_TASK_PAGE_SIZE
 * tasks scanned at most).
 */
const MAX_QUERY_SCAN_PAGES = 20;

/**
 * Task events an inbound ClickUp webhook subscribes to: a new task, and a
 * task's status changing. The receiver drops every other task event as
 * unhandled.
 */
export const CLICKUP_WEBHOOK_EVENTS = [
  "taskCreated",
  "taskStatusUpdated",
] as const;

/**
 * Custom field types a task form can collect and this adapter can write.
 * Everything else (people, task relationships, files, formulas, rollups,
 * progress bars, locations, buttons, votes…) is read back on a task but
 * not offered for input.
 */
const EDITABLE_CUSTOM_FIELD_TYPES = new Set([
  "text",
  "short_text",
  "number",
  "currency",
  "url",
  "email",
  "phone",
  "date",
  "drop_down",
  "labels",
  "checkbox",
]);

const NUMERIC_CUSTOM_FIELD_TYPES = new Set(["number", "currency"]);

/** ClickUp priority is an integer 1 (urgent) through 4 (low); unknown values default to "normal". */
function mapPriorityToClickUp(priority: string): number {
  const map: Record<string, number> = {
    urgent: 1,
    high: 2,
    normal: 3,
    medium: 3,
    low: 4,
  };
  return map[priority.toLowerCase()] ?? 3;
}

/**
 * ClickUp task ids are short lowercase alphanumerics ("86c0xyz12"); custom
 * task ids carry a prefix and a hyphen ("PROJ-123"). The hyphen is what
 * tells the Get Task call to resolve the id as a custom one.
 */
function isCustomTaskId(id: string): boolean {
  return id.includes("-");
}

interface ClickUpCustomField {
  id: string;
  name: string;
  type: string;
  required?: boolean;
  type_config?: {
    options?: Array<{
      id: string;
      name?: string;
      label?: string;
      orderindex?: number;
    }>;
  };
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
 *    *strings*, not ISO-8601.
 *  - Custom fields live on the List, not on an issue type, so
 *    `getIssueTypeFields` serves the List's fields for every task type and
 *    "issue types" are ClickUp's custom task types.
 *  - Webhooks are created through the API (ClickUp has no UI for them) and
 *    ClickUp mints the signing secret, which `registerWebhook` returns.
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

  // Per-List custom field definitions and the workspace's custom task
  // types, fetched once per adapter instance.
  private customFieldCache = new Map<string, ClickUpCustomField[]>();
  private customItemNames?: Map<number, string>;

  constructor(config: any) {
    super(config);

    if (config.teamId) this.teamId = String(config.teamId);
    if (config.listId) this.listId = String(config.listId);

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
      customFields: true,
      attachments: true,
      linkedIssues: true,
      comments: true,
      // ClickUp has no Fix Version equivalent, and its Sprints are plain
      // Lists whose dates and state the API does not expose, so there is
      // nothing authoritative to sync a milestone from.
      milestones: false,
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
    throw new Error(
      "ClickUp OAuth tokens do not expire and cannot be refreshed"
    );
  }

  // ---------------------------------------------------------------------
  // Tasks
  // ---------------------------------------------------------------------

  /**
   * URL for one task. Markdown descriptions are opt-in on the read side,
   * and a custom task id ("PROJ-123") has to be resolved inside the
   * workspace it belongs to.
   */
  private taskUrl(issueId: string, extra: Record<string, string> = {}): string {
    const params = new URLSearchParams({
      include_markdown_description: "true",
      ...extra,
    });
    if (isCustomTaskId(issueId) && this.teamId) {
      params.set("custom_task_ids", "true");
      params.set("team_id", this.teamId);
    }
    return `${this.baseUrl}/task/${encodeURIComponent(issueId)}?${params.toString()}`;
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
    // "Issue types" are ClickUp custom task types; 0 is the plain Task and
    // anything that is not a type id (the generic dialog's Jira-shaped
    // fallback ids, for instance) is ignored rather than sent.
    const customItemId = Number(data.issueType);
    if (Number.isInteger(customItemId) && customItemId > 0) {
      payload.custom_item_id = customItemId;
    }
    if (data.customFields) {
      const values = await this.buildCustomFieldValues(
        listId,
        data.customFields
      );
      if (values.length > 0) payload.custom_fields = values;
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
      payload.markdown_description = renderClickUpDescription(data.description);
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

    let response = await this.makeRequest<any>(
      `${this.baseUrl}/task/${encodeURIComponent(issueId)}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      }
    );

    // Custom field values have their own endpoint, one call per field.
    if (data.customFields) {
      const listId = response?.list?.id ?? this.listId;
      const values = listId
        ? await this.buildCustomFieldValues(String(listId), data.customFields)
        : [];
      for (const { id, value } of values) {
        await this.makeRequest(
          `${this.baseUrl}/task/${encodeURIComponent(issueId)}/field/${id}`,
          { method: "POST", body: JSON.stringify({ value }) }
        );
      }
      if (values.length > 0) {
        response = await this.makeRequest<any>(this.taskUrl(issueId));
      }
    }

    return this.mapClickUpTask(response);
  }

  async getIssue(issueId: string): Promise<IssueData> {
    const response = await this.makeRequest<any>(this.taskUrl(issueId));
    return this.mapClickUpTask(response);
  }

  /**
   * Build the query string for one page of ClickUp's Get Tasks call.
   * `page` is a ClickUp page index (each page is CLICKUP_TASK_PAGE_SIZE
   * items) — never the caller's `limit`, which ClickUp does not honor.
   */
  private buildSearchParams(
    page: number,
    options: IssueSearchOptions
  ): URLSearchParams {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("include_closed", "true");
    if (options.status && options.status.length > 0) {
      for (const s of options.status) params.append("statuses[]", s);
    }
    if (options.assignee) {
      params.append("assignees[]", options.assignee);
    }
    if (options.issueTypeIds && options.issueTypeIds.length > 0) {
      for (const id of options.issueTypeIds) {
        params.append("custom_items[]", id);
      }
    }
    if (options.updatedWithinDays && options.updatedWithinDays > 0) {
      params.set(
        "date_updated_gt",
        String(Date.now() - Math.floor(options.updatedWithinDays) * 86_400_000)
      );
    }
    return params;
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

    // ClickUp's Get Tasks endpoint always pages in fixed batches of
    // CLICKUP_TASK_PAGE_SIZE and ignores the caller's `limit` entirely —
    // translating `offset` into a ClickUp page number via the caller's
    // `limit` (as opposed to ClickUp's actual page size) would silently
    // skip or re-request the wrong slice of tasks once the two diverge
    // (e.g. a bulk import requesting 50 at a time against 100-per-page
    // responses). Always divide by ClickUp's real page size instead.
    const startPage = Math.floor(
      (options.offset || 0) / CLICKUP_TASK_PAGE_SIZE
    );
    const limit = options.limit || 100;

    if (!options.query) {
      const response = await this.makeRequest<any>(
        `${this.baseUrl}/list/${listId}/task?${this.buildSearchParams(startPage, options).toString()}`
      );
      const tasks: any[] = response.tasks || [];
      return {
        issues: tasks.map((t) => this.mapClickUpTask(t)),
        total: tasks.length,
        hasMore: response.last_page === false,
      };
    }

    // ClickUp's list-tasks endpoint has no server-side free-text search
    // qualifier (unlike GitHub's `q=`). A single page can't be relied on to
    // contain every match (interactive callers like the issue-link search
    // dialog make one searchIssues() call and never inspect `hasMore`), so
    // scan forward across ClickUp pages — capped at
    // MAX_QUERY_SCAN_PAGES — accumulating matches until there are enough
    // to satisfy `limit` or the list is exhausted.
    const query = options.query.toLowerCase();
    const matches: any[] = [];
    let page = startPage;
    let exhausted = false;
    while (
      matches.length < limit &&
      page < startPage + MAX_QUERY_SCAN_PAGES &&
      !exhausted
    ) {
      const response = await this.makeRequest<any>(
        `${this.baseUrl}/list/${listId}/task?${this.buildSearchParams(page, options).toString()}`
      );
      const tasks: any[] = response.tasks || [];
      for (const t of tasks) {
        if (
          t.name?.toLowerCase().includes(query) ||
          t.custom_id?.toLowerCase() === query ||
          t.id?.toLowerCase() === query
        ) {
          matches.push(t);
        }
      }
      exhausted = response.last_page === true || tasks.length === 0;
      page++;
    }

    return {
      issues: matches.slice(0, limit).map((t) => this.mapClickUpTask(t)),
      total: matches.length,
      hasMore: !exhausted,
    };
  }

  /**
   * ClickUp has no count endpoint. One page tells us everything when it is
   * also the last page; otherwise the page size is a real floor.
   */
  async countIssues(options: IssueCountOptions): Promise<IssueCountResult> {
    const listId = options.projectId || this.listId;
    if (!listId) return { count: 0, exactness: "unknown" };

    try {
      const params = this.buildSearchParams(0, {
        issueTypeIds: options.issueTypeIds,
        updatedWithinDays: options.updatedWithinDays,
      });
      const response = await this.makeRequest<any>(
        `${this.baseUrl}/list/${listId}/task?${params.toString()}`
      );
      const tasks: any[] = response.tasks || [];
      return {
        count: tasks.length,
        exactness: response.last_page === false ? "floor" : "exact",
      };
    } catch (error) {
      console.warn(`[ClickUpAdapter] countIssues failed:`, error);
      return { count: 0, exactness: "unknown" };
    }
  }

  async getIssueComments(issueId: string): Promise<IssueComment[]> {
    try {
      const response = await this.makeRequest<any>(
        `${this.baseUrl}/task/${encodeURIComponent(issueId)}/comment`
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
    await this.makeRequest(
      `${this.baseUrl}/task/${encodeURIComponent(issueId)}/comment`,
      {
        method: "POST",
        body: JSON.stringify({ comment_text: comment }),
      }
    );
  }

  /**
   * Task links (symmetric "relates to") and dependencies, one level deep.
   * A dependency row names both ends, so the direction falls out of which
   * end this task is: it either waits on the other task or blocks it.
   */
  async getLinkedIssues(issueId: string): Promise<LinkedIssueRef[]> {
    try {
      const task = await this.makeRequest<any>(this.taskUrl(issueId));
      const self = String(task?.id ?? issueId);
      const refs: LinkedIssueRef[] = [];

      for (const link of Array.isArray(task?.linked_tasks)
        ? task.linked_tasks
        : []) {
        const a = link?.task_id != null ? String(link.task_id) : null;
        const b = link?.link_id != null ? String(link.link_id) : null;
        const other = a === self ? b : a;
        if (!other || other === self) continue;
        refs.push({ id: other, linkType: "relates to", direction: "outward" });
      }

      for (const dep of Array.isArray(task?.dependencies)
        ? task.dependencies
        : []) {
        const dependent = dep?.task_id != null ? String(dep.task_id) : null;
        const dependsOn =
          dep?.depends_on != null ? String(dep.depends_on) : null;
        if (!dependent || !dependsOn) continue;
        if (dependent === self && dependsOn !== self) {
          refs.push({
            id: dependsOn,
            linkType: "waiting on",
            direction: "outward",
          });
        } else if (dependsOn === self && dependent !== self) {
          refs.push({
            id: dependent,
            linkType: "blocking",
            direction: "inward",
          });
        }
      }

      return refs;
    } catch (error) {
      const status = this.parseStatusFromError(error);
      const level = status === null || status >= 500 ? "error" : "warn";
      console[level](
        `[ClickUpAdapter] getLinkedIssues failed for %s:`,
        issueId,
        error
      );
      return [];
    }
  }

  // ---------------------------------------------------------------------
  // Hierarchy, types, fields
  // ---------------------------------------------------------------------

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
      throw new Error(
        "ClickUp Team (workspace) ID not configured (settings.teamId)."
      );
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

  private async loadCustomItems(): Promise<Map<number, string>> {
    if (this.customItemNames) return this.customItemNames;
    const names = new Map<number, string>([[0, "Task"]]);
    if (this.teamId) {
      const response = await this.makeRequest<any>(
        `${this.baseUrl}/team/${this.teamId}/custom_item`
      );
      for (const item of response?.custom_items || []) {
        if (item?.id != null && item.name) {
          names.set(Number(item.id), String(item.name));
        }
      }
    }
    this.customItemNames = names;
    return names;
  }

  /**
   * ClickUp's custom task types stand in for issue types. The plain Task
   * (custom_item_id 0) is always offered first. Types are workspace-wide,
   * so the List id is accepted for interface parity and otherwise unused.
   */
  async getIssueTypes(
    _projectId: string
  ): Promise<Array<{ id: string; name: string }>> {
    const names = await this.loadCustomItems();
    return [...names.entries()].map(([id, name]) => ({
      id: String(id),
      name,
    }));
  }

  private async loadCustomFields(
    listId: string
  ): Promise<ClickUpCustomField[]> {
    const cached = this.customFieldCache.get(listId);
    if (cached) return cached;
    const response = await this.makeRequest<any>(
      `${this.baseUrl}/list/${listId}/field`
    );
    const fields: ClickUpCustomField[] = Array.isArray(response?.fields)
      ? response.fields.filter((f: any) => f?.id && f?.type)
      : [];
    this.customFieldCache.set(listId, fields);
    return fields;
  }

  /**
   * The List's custom fields in the generic `{id, name, type, required,
   * options}` shape. ClickUp scopes fields to a List rather than a project,
   * and the List id is what `projectId` carries for this adapter.
   */
  async getCustomFields(projectId: string): Promise<
    Array<{
      id: string;
      name: string;
      type: string;
      required: boolean;
      options?: Array<{ id: string; value: string }>;
    }>
  > {
    const listId = projectId || this.listId;
    if (!listId) return [];
    const fields = await this.loadCustomFields(listId);
    return fields.map((field) => {
      const options = field.type_config?.options;
      return {
        id: field.id,
        name: field.name,
        type: field.type,
        required: field.required === true,
        ...(Array.isArray(options) && options.length > 0
          ? {
              options: options.map((o) => ({
                id: String(o.id),
                value: String(o.name ?? o.label ?? o.id),
              })),
            }
          : {}),
      };
    });
  }

  /**
   * Fields the create-issue form should collect. ClickUp fields belong to
   * the List rather than to a task type, so every type gets the same set;
   * only types the form can render and the adapter can write are offered.
   * Shaped like Jira's create metadata so the generic dialog renders them
   * unchanged: `allowedValues` makes a select, `schema.type` picks the
   * input.
   */
  async getIssueTypeFields(
    projectKey: string,
    _issueTypeId: string
  ): Promise<any[]> {
    try {
      const listId = projectKey || this.listId;
      if (!listId) return [];
      const fields = await this.loadCustomFields(listId);
      return fields
        .filter((field) => EDITABLE_CUSTOM_FIELD_TYPES.has(field.type))
        .map((field) => {
          const options = field.type_config?.options ?? [];
          const base = {
            key: field.id,
            name: field.name,
            required: field.required === true,
            hasDefaultValue: false,
          };
          switch (field.type) {
            case "drop_down":
            case "labels":
              return {
                ...base,
                schema: { type: field.type === "labels" ? "array" : "option" },
                allowedValues: options.map((o) => ({
                  id: String(o.id),
                  name: String(o.name ?? o.label ?? o.id),
                })),
              };
            case "checkbox":
              return {
                ...base,
                schema: { type: "boolean" },
                allowedValues: [
                  { id: "true", name: "Yes" },
                  { id: "false", name: "No" },
                ],
              };
            case "number":
            case "currency":
              return { ...base, schema: { type: "number" } };
            case "date":
              return { ...base, schema: { type: "date" } };
            default:
              return { ...base, schema: { type: "string" } };
          }
        });
    } catch (error) {
      console.error("[ClickUpAdapter] getIssueTypeFields failed:", error);
      return [];
    }
  }

  /**
   * Turn the form's `{fieldId: value}` map into ClickUp's `[{id, value}]`
   * list, coercing each value to what the field's type accepts. Keys that
   * are not fields on the List (the create route adds a `reporter` entry,
   * for instance) are dropped rather than sent.
   */
  private async buildCustomFieldValues(
    listId: string,
    customFields: Record<string, any>
  ): Promise<Array<{ id: string; value: unknown }>> {
    const entries = Object.entries(customFields).filter(
      ([, value]) => value !== undefined && value !== null && value !== ""
    );
    if (entries.length === 0) return [];

    const fields = await this.loadCustomFields(listId);
    const byId = new Map(fields.map((f) => [f.id, f]));
    const values: Array<{ id: string; value: unknown }> = [];

    for (const [id, raw] of entries) {
      const field = byId.get(id);
      if (!field || !EDITABLE_CUSTOM_FIELD_TYPES.has(field.type)) continue;
      let value: unknown = raw;
      if (NUMERIC_CUSTOM_FIELD_TYPES.has(field.type)) {
        value = Number(raw);
        if (!Number.isFinite(value)) continue;
      } else if (field.type === "date") {
        const ms = typeof raw === "number" ? raw : Date.parse(String(raw));
        if (!Number.isFinite(ms)) continue;
        value = ms;
      } else if (field.type === "labels") {
        value = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      } else if (field.type === "checkbox") {
        value = raw === true || raw === "true";
      } else {
        value = Array.isArray(raw) ? raw.join(", ") : String(raw);
      }
      values.push({ id, value });
    }

    return values;
  }

  /** Statuses are defined per List; without a default List there are none to offer. */
  async getStatuses(): Promise<Array<{ id: string; name: string }>> {
    if (!this.listId) return [];
    try {
      const list = await this.makeRequest<any>(
        `${this.baseUrl}/list/${this.listId}`
      );
      const statuses: any[] = Array.isArray(list?.statuses)
        ? list.statuses
        : [];
      return statuses
        .filter((s) => s?.status)
        .map((s) => ({ id: String(s.status), name: String(s.status) }));
    } catch (error) {
      console.warn("[ClickUpAdapter] getStatuses failed:", error);
      return [];
    }
  }

  async getPriorities(): Promise<Array<{ id: string; name: string }>> {
    return [
      { id: "urgent", name: "Urgent" },
      { id: "high", name: "High" },
      { id: "normal", name: "Normal" },
      { id: "low", name: "Low" },
    ];
  }

  // ---------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------

  /**
   * Workspace members, filtered client-side: ClickUp lists them on the
   * authorized-workspaces call and has no member search.
   */
  async searchUsers(
    query: string,
    _projectKey?: string,
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
    const response = await this.makeRequest<any>(`${this.baseUrl}/team`);
    const teams: any[] = Array.isArray(response?.teams) ? response.teams : [];
    const team = this.teamId
      ? teams.find((t) => String(t?.id) === this.teamId)
      : teams[0];
    const members: any[] = Array.isArray(team?.members) ? team.members : [];
    const needle = query.trim().toLowerCase();

    const users = members
      .map((m) => m?.user)
      .filter((u) => u && u.id != null)
      .filter(
        (u) =>
          needle.length === 0 ||
          String(u.username ?? "")
            .toLowerCase()
            .includes(needle) ||
          String(u.email ?? "")
            .toLowerCase()
            .includes(needle)
      )
      .map((u) => ({
        accountId: String(u.id),
        displayName: String(u.username ?? u.email ?? u.id),
        emailAddress: u.email ? String(u.email) : undefined,
        avatarUrls: u.profilePicture
          ? { "48x48": u.profilePicture }
          : undefined,
      }));

    return {
      users: users.slice(startAt, startAt + maxResults),
      total: users.length,
    };
  }

  async getCurrentUser(): Promise<{
    accountId: string;
    displayName: string;
    emailAddress?: string;
  } | null> {
    try {
      const response = await this.makeRequest<any>(`${this.baseUrl}/user`);
      const user = response?.user;
      if (!user || user.id == null) return null;
      return {
        accountId: String(user.id),
        displayName: String(user.username ?? user.email ?? user.id),
        emailAddress: user.email ? String(user.email) : undefined,
      };
    } catch (error) {
      console.warn("[ClickUpAdapter] getCurrentUser failed:", error);
      return null;
    }
  }

  // ---------------------------------------------------------------------
  // Attachments
  // ---------------------------------------------------------------------

  async uploadAttachment(
    issueId: string,
    file: Buffer,
    filename: string
  ): Promise<{ id: string; url: string }> {
    const form = new FormData();
    form.append("attachment", new Blob([new Uint8Array(file)]), filename);

    const response = await this.makeRequest<any>(
      `${this.baseUrl}/task/${encodeURIComponent(issueId)}/attachment`,
      { method: "POST", body: form }
    );

    return {
      id: String(response?.id ?? ""),
      url: String(response?.url ?? ""),
    };
  }

  /**
   * ClickUp has no attachment listing endpoint; the task carries them.
   * `url_w_query` is the signed download link and is preferred over the
   * bare `url` when ClickUp returns one.
   */
  async listAttachments(issueId: string): Promise<IssueAttachmentMeta[]> {
    const task = await this.makeRequest<any>(this.taskUrl(issueId));
    const attachments: any[] = Array.isArray(task?.attachments)
      ? task.attachments
      : [];
    const out: IssueAttachmentMeta[] = [];
    for (const a of attachments) {
      if (!a?.id || a.deleted) continue;
      const contentUrl = a.url_w_query || a.url;
      if (!contentUrl) continue;
      out.push({
        id: String(a.id),
        filename: a.title ? String(a.title) : `attachment-${a.id}`,
        mimeType: a.mimetype ? String(a.mimetype) : undefined,
        byteSize: typeof a.size === "number" ? a.size : undefined,
        createdAt:
          a.date != null && Number.isFinite(Number(a.date))
            ? new Date(Number(a.date))
            : undefined,
        contentUrl: String(contentUrl),
      });
    }
    return out;
  }

  async downloadAttachment(
    meta: IssueAttachmentMeta
  ): Promise<{ buffer: Buffer; mimeType?: string }> {
    if (!meta.contentUrl) {
      throw new Error("ClickUp attachment has no download URL");
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

  // ---------------------------------------------------------------------
  // Webhooks
  // ---------------------------------------------------------------------

  /**
   * Register a webhook on the workspace. ClickUp mints the signing secret
   * and returns it once, so the caller stores what comes back here; the
   * `secret` argument the interface allows has no effect. `options.listId`
   * narrows delivery to one List (the project's linked List).
   */
  async registerWebhook(
    url: string,
    events: string[],
    _secret?: string,
    options?: { listId?: string }
  ): Promise<WebhookData> {
    if (!this.teamId) {
      throw new Error(
        "ClickUp Team (workspace) ID not configured (settings.teamId)."
      );
    }
    const body: Record<string, unknown> = {
      endpoint: url,
      events: events.length > 0 ? events : [...CLICKUP_WEBHOOK_EVENTS],
    };
    const listId = options?.listId ?? this.listId;
    if (listId) body.list_id = Number(listId);

    const response = await this.makeRequest<any>(
      `${this.baseUrl}/team/${this.teamId}/webhook`,
      { method: "POST", body: JSON.stringify(body) }
    );
    const webhook = response?.webhook ?? {};
    const id = response?.id ?? webhook.id;
    if (!id || !webhook.secret) {
      throw new Error("ClickUp did not return a webhook id and secret");
    }
    return {
      id: String(id),
      url: String(webhook.endpoint ?? url),
      events: Array.isArray(webhook.events) ? webhook.events : events,
      secret: String(webhook.secret),
      active: webhook.health?.status !== "failing",
    };
  }

  async unregisterWebhook(webhookId: string): Promise<void> {
    await this.makeRequest(
      `${this.baseUrl}/webhook/${encodeURIComponent(webhookId)}`,
      { method: "DELETE" }
    );
  }

  // ---------------------------------------------------------------------
  // Mapping
  // ---------------------------------------------------------------------

  private mapClickUpTask(task: any): IssueData {
    const customFields: Record<string, any> = {
      _clickup_list_id: task.list?.id,
    };
    if (task.custom_id) customFields._clickup_custom_id = task.custom_id;
    for (const field of Array.isArray(task.custom_fields)
      ? task.custom_fields
      : []) {
      if (field?.id && field.value !== undefined && field.value !== null) {
        customFields[field.id] = field.value;
      }
    }

    const customItemId = Number(task.custom_item_id ?? 0);
    const issueType = {
      id: String(Number.isFinite(customItemId) ? customItemId : 0),
      name:
        this.customItemNames?.get(customItemId) ??
        (customItemId === 0 ? "Task" : `Type ${customItemId}`),
    };

    return {
      id: task.id,
      // ClickUp custom task IDs are optional (Business plan+); fall back to
      // the ClickUp task id when absent.
      key: task.custom_id || task.id,
      title: task.name,
      description: task.markdown_description ?? task.description,
      status: task.status?.status ?? "unknown",
      priority: task.priority?.priority,
      issueType,
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
      customFields,
      parent: task.parent ? { id: String(task.parent) } : undefined,
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
