import { tiptapToMarkdown } from "~/lib/tiptap/tiptapToMarkdown";
import { parseUpstreamDate } from "~/utils/calendarDate";
import { BaseAdapter } from "./BaseAdapter";
import {
  AuthenticationData,
  CreateIssueData,
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

/** Redmine caps `limit` at 100 on list endpoints. */
const MAX_PAGE_SIZE = 100;

interface RedmineNamed {
  id: number;
  name: string;
}

interface RedmineUser {
  id: number;
  login?: string;
  firstname?: string;
  lastname?: string;
  mail?: string;
}

interface RedmineCustomField {
  id: number;
  name: string;
  value: unknown;
}

interface RedmineJournal {
  id?: number;
  notes?: string;
  created_on?: string;
  user?: RedmineNamed;
}

interface RedmineRelation {
  id: number;
  issue_id: number;
  issue_to_id: number;
  relation_type: string;
}

interface RedmineAttachment {
  id: number;
  filename?: string;
  filesize?: number;
  content_type?: string;
  created_on?: string;
}

interface RedmineVersion {
  id: number;
  name?: string;
  description?: string;
  /** open, locked or closed. */
  status?: string;
  due_date?: string | null;
}

interface RedmineIssue {
  id: number;
  subject?: string;
  description?: string;
  status?: RedmineNamed;
  priority?: RedmineNamed;
  tracker?: RedmineNamed;
  category?: RedmineNamed;
  assigned_to?: RedmineNamed;
  author?: RedmineNamed;
  custom_fields?: RedmineCustomField[];
  created_on?: string;
  updated_on?: string;
  journals?: RedmineJournal[];
  relations?: RedmineRelation[];
  attachments?: RedmineAttachment[];
}

interface RedmineProject {
  id: number;
  identifier: string;
  name: string;
  /** Present from Redmine 4.2 when requested with `include=issue_custom_fields`. */
  issue_custom_fields?: RedmineNamed[];
}

/** A custom field definition from `GET /custom_fields.json` (administrators only). */
interface RedmineCustomFieldDef {
  id: number;
  name: string;
  customized_type?: string;
  field_format?: string;
  is_required?: boolean;
  is_for_all?: boolean;
  multiple?: boolean;
  default_value?: string | null;
  possible_values?: Array<{ value?: string; label?: string }>;
  trackers?: RedmineNamed[];
  projects?: RedmineNamed[];
}

type FieldOption = { id: string; name: string };

function isTiptapDoc(value: unknown): value is { type: "doc"; content: any[] } {
  return (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    (value as { type: unknown }).type === "doc"
  );
}

/** A TipTap doc becomes markdown; a string passes through unchanged. */
function renderRedmineDescription(description: unknown): string {
  if (description === undefined || description === null) return "";
  if (isTiptapDoc(description)) return tiptapToMarkdown(description);
  if (typeof description === "string") return description;
  return String(description);
}

/**
 * Adapter for Redmine (https://www.redmine.org) via its REST API.
 *
 * Auth is an API key sent as `X-Redmine-API-Key` (handled by BaseAdapter). Redmine
 * has no OAuth, so this adapter is API-key only. Issue mutations (PUT) return 204
 * with no body — BaseAdapter.makeRequest returns undefined for those, and we re-GET
 * the issue to return the updated representation.
 *
 * Redmine concepts map onto the IssueAdapter contract as: trackers → issue types,
 * issue_statuses → statuses, issue_priorities → priorities, journals → comments,
 * relations → linked issues, versions → release milestones.
 */
export class RedmineAdapter extends BaseAdapter {
  private baseUrl: string = "";

  constructor(config: any) {
    super(config);
    // The config form stores the instance URL as `baseUrl`; accept `instanceUrl`
    // too for symmetry with the other self-hosted adapters.
    const base = config.baseUrl || config.instanceUrl;
    if (base) this.baseUrl = String(base).replace(/\/$/, "");
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
      milestones: { kinds: ["RELEASE"], webhooks: true },
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
        "Redmine instance URL is required (e.g. https://redmine.example.com)"
      );
    }
    if (authData.type !== "api_key") {
      throw new Error("Redmine adapter only supports API key authentication");
    }
    // The admin form may store the key under either credential field; normalise
    // onto `apiKey` so BaseAdapter emits the X-Redmine-API-Key header.
    const apiKey = authData.apiKey ?? authData.apiToken;
    if (!apiKey) {
      throw new Error("Redmine API key is required");
    }
    this.authData!.apiKey = apiKey;

    try {
      await this.makeRequest(`${this.baseUrl}/users/current.json`);
    } catch {
      throw new Error("Invalid Redmine API key or instance URL");
    }
  }

  async searchIssues(options: IssueSearchOptions): Promise<{
    issues: IssueData[];
    total: number;
    hasMore: boolean;
  }> {
    const limit = options.limit || 25;
    const offset = options.offset || 0;

    // Direct reference lookup: "#123" or "123" fetches that issue directly.
    if (options.query) {
      const idMatch = options.query.trim().match(/^#?(\d+)$/);
      if (idMatch) {
        try {
          const issue = await this.getIssue(idMatch[1]);
          return { issues: [issue], total: 1, hasMore: false };
        } catch {
          return { issues: [], total: 0, hasMore: false };
        }
      }
    }

    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      // `*` returns both open and closed issues; without it Redmine defaults to open.
      status_id: "*",
    });
    if (options.projectId) params.set("project_id", options.projectId);
    if (options.query) {
      // Redmine's "contains" operator for text fields is the `~` value prefix.
      params.set("subject", `~${options.query}`);
    }
    // Type-scoped import (SCALE-01) — tracker_id accepts a pipe-delimited
    // list of global tracker ids (Redmine.org community wiki, MEDIUM
    // confidence — not a first-party API reference page). If a live Redmine
    // rejects this syntax, the orchestrator's client-side degraded filter
    // (28-04) still yields a correct, merely wasteful, import.
    // URLSearchParams encodes the "|" for us; no hand-escaping needed.
    if (options.issueTypeIds?.length) {
      params.set("tracker_id", options.issueTypeIds.join("|"));
    }

    const resp = await this.makeRequest<{
      issues?: RedmineIssue[];
      total_count?: number;
    }>(`${this.baseUrl}/issues.json?${params.toString()}`);

    const issues = (resp.issues ?? []).map((i) => this.mapIssue(i));
    const total = resp.total_count ?? issues.length;
    return { issues, total, hasMore: offset + issues.length < total };
  }

  async getIssue(issueId: string): Promise<IssueData> {
    const id = this.parseId(issueId);
    const resp = await this.makeRequest<{ issue: RedmineIssue }>(
      `${this.baseUrl}/issues/${id}.json?include=journals,relations`
    );
    return this.mapIssue(resp.issue);
  }

  async createIssue(data: CreateIssueData): Promise<IssueData> {
    const issue: Record<string, unknown> = {
      project_id: data.projectId,
      subject: data.title,
    };
    if (data.description !== undefined) {
      issue.description = renderRedmineDescription(data.description);
    }
    const trackerId = Number(data.issueType);
    if (data.issueType && !Number.isNaN(trackerId))
      issue.tracker_id = trackerId;
    const priorityId = Number(data.priority);
    if (data.priority && !Number.isNaN(priorityId)) {
      issue.priority_id = priorityId;
    }
    const assigneeId = Number(data.assigneeId);
    if (data.assigneeId && !Number.isNaN(assigneeId)) {
      issue.assigned_to_id = assigneeId;
    }
    // Keys that are not custom field ids (the create route adds a `reporter`
    // entry, for instance) and fields left empty are not sent.
    const customFields = Object.entries(data.customFields ?? {})
      .filter(
        ([id, value]) =>
          /^\d+$/.test(id) &&
          value !== undefined &&
          value !== null &&
          value !== "" &&
          !(Array.isArray(value) && value.length === 0)
      )
      .map(([id, value]) => ({
        id: Number(id),
        value: Array.isArray(value) ? value.map(String) : String(value),
      }));
    if (customFields.length > 0) {
      issue.custom_fields = customFields;
    }

    const resp = await this.makeRequest<{ issue: RedmineIssue }>(
      `${this.baseUrl}/issues.json`,
      { method: "POST", body: JSON.stringify({ issue }) }
    );
    return this.mapIssue(resp.issue);
  }

  async updateIssue(
    issueId: string,
    data: UpdateIssueData
  ): Promise<IssueData> {
    const id = this.parseId(issueId);
    const issue: Record<string, unknown> = {};
    if (data.title !== undefined) issue.subject = data.title;
    if (data.description !== undefined) {
      issue.description = renderRedmineDescription(data.description);
    }
    if (data.status !== undefined) {
      const statusId = await this.resolveStatusId(data.status);
      if (statusId !== null) issue.status_id = statusId;
    }
    if (data.priority !== undefined) {
      const priorityId = Number(data.priority);
      if (!Number.isNaN(priorityId)) issue.priority_id = priorityId;
    }
    if (data.assigneeId !== undefined) {
      const assigneeId = Number(data.assigneeId);
      if (!Number.isNaN(assigneeId)) issue.assigned_to_id = assigneeId;
    }

    // Redmine answers a successful PUT with 204 No Content.
    await this.makeRequest(`${this.baseUrl}/issues/${id}.json`, {
      method: "PUT",
      body: JSON.stringify({ issue }),
    });
    return this.getIssue(id);
  }

  async getIssueComments(issueId: string): Promise<IssueComment[]> {
    try {
      const id = this.parseId(issueId);
      const resp = await this.makeRequest<{ issue: RedmineIssue }>(
        `${this.baseUrl}/issues/${id}.json?include=journals`
      );
      const journals = resp.issue?.journals ?? [];
      return journals
        .filter((j) => j.notes && j.notes.trim().length > 0)
        .map((j) => ({
          id: j.id != null ? String(j.id) : undefined,
          author: j.user?.name ?? "Unknown",
          body: j.notes ?? "",
          created: j.created_on ?? "",
        }));
    } catch (error) {
      const status = this.parseStatusFromError(error);
      const level = status === null || status >= 500 ? "error" : "warn";
      console[level](
        `[RedmineAdapter] getIssueComments failed for %s:`,
        issueId,
        error
      );
      return [];
    }
  }

  async getLinkedIssues(issueId: string): Promise<LinkedIssueRef[]> {
    try {
      const id = this.parseId(issueId);
      const numId = Number(id);
      const resp = await this.makeRequest<{ issue: RedmineIssue }>(
        `${this.baseUrl}/issues/${id}.json?include=relations`
      );
      const relations = resp.issue?.relations ?? [];
      return relations.map((r) => {
        const outward = r.issue_id === numId;
        const otherId = outward ? r.issue_to_id : r.issue_id;
        return {
          id: String(otherId),
          key: `#${otherId}`,
          linkType: r.relation_type,
          direction: outward ? "outward" : "inward",
        };
      });
    } catch (error) {
      console.warn("[RedmineAdapter] getLinkedIssues failed:", error);
      return [];
    }
  }

  /**
   * Uploads the file, then attaches the returned token to the issue. Redmine
   * refuses a file larger than its "Maximum attachment size" setting (422).
   */
  async uploadAttachment(
    issueId: string,
    file: Buffer,
    filename: string
  ): Promise<{ id: string; url: string }> {
    const id = this.parseId(issueId);
    const uploaded = await this.makeRequest<{
      upload?: { id?: number; token?: string };
    }>(
      `${this.baseUrl}/uploads.json?filename=${encodeURIComponent(filename)}`,
      {
        method: "POST",
        body: new Uint8Array(file),
        headers: { "Content-Type": "application/octet-stream" },
      }
    );
    const token = uploaded?.upload?.token;
    if (!token) {
      throw new Error("Redmine did not return an upload token");
    }

    await this.makeRequest(`${this.baseUrl}/issues/${id}.json`, {
      method: "PUT",
      body: JSON.stringify({ issue: { uploads: [{ token, filename }] } }),
    });

    // The token is "<attachment id>.<digest>"; older releases return no id.
    const attachmentId = String(uploaded.upload?.id ?? token.split(".")[0]);
    return {
      id: attachmentId,
      url: `${this.baseUrl}/attachments/${attachmentId}`,
    };
  }

  async listAttachments(issueId: string): Promise<IssueAttachmentMeta[]> {
    const id = this.parseId(issueId);
    const resp = await this.makeRequest<{ issue: RedmineIssue }>(
      `${this.baseUrl}/issues/${id}.json?include=attachments`
    );
    return (resp.issue?.attachments ?? []).map((a) => ({
      id: String(a.id),
      filename: a.filename || `attachment-${a.id}`,
      mimeType: a.content_type || undefined,
      byteSize: typeof a.filesize === "number" ? a.filesize : undefined,
      createdAt: a.created_on ? new Date(a.created_on) : undefined,
      contentUrl: this.attachmentDownloadUrl(String(a.id)),
    }));
  }

  /**
   * The download address is rebuilt from the configured instance URL, so the
   * API key is only ever sent to that host.
   */
  async downloadAttachment(
    meta: IssueAttachmentMeta
  ): Promise<{ buffer: Buffer; mimeType?: string }> {
    const { buffer, contentType } = await this.makeBinaryRequest(
      this.attachmentDownloadUrl(meta.id),
      MAX_ATTACHMENT_DOWNLOAD_BYTES
    );
    const mimeType =
      contentType && contentType !== "application/octet-stream"
        ? contentType
        : meta.mimeType;
    return { buffer, mimeType };
  }

  private attachmentDownloadUrl(attachmentId: string): string {
    return `${this.baseUrl}/attachments/download/${encodeURIComponent(attachmentId)}`;
  }

  /**
   * A project's versions as RELEASE milestones, including versions other
   * projects share with it. A version has a due date but no start date; open
   * and locked versions are ACTIVE, closed ones CLOSED.
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
    const resp = await this.makeRequest<{ versions?: RedmineVersion[] }>(
      `${this.baseUrl}/projects/${encodeURIComponent(options.projectKey)}/versions.json`
    );
    const versions = (resp.versions ?? []).filter(
      (version) => options.includeClosed || version.status !== "closed"
    );
    return {
      items: versions.map((version) => this.mapVersion(version)),
      hasMore: false,
    };
  }

  /** The issues targeting a version, open and closed, a page at a time. */
  async getMilestoneIssues(
    ref: { id: string; kind: "RELEASE" | "ITERATION" },
    options?: { pageToken?: string; limit?: number }
  ): Promise<{
    issues: IssueData[];
    total?: number;
    hasMore: boolean;
    nextPageToken?: string;
  }> {
    if (ref.kind !== "RELEASE" || !/^\d+$/.test(ref.id)) {
      return { issues: [], hasMore: false };
    }
    const offset = Math.max(0, Number(options?.pageToken) || 0);
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, options?.limit ?? MAX_PAGE_SIZE)
    );
    const params = new URLSearchParams({
      fixed_version_id: ref.id,
      status_id: "*",
      limit: String(limit),
      offset: String(offset),
    });
    const resp = await this.makeRequest<{
      issues?: RedmineIssue[];
      total_count?: number;
    }>(`${this.baseUrl}/issues.json?${params.toString()}`);

    const raw = resp.issues ?? [];
    const next = offset + raw.length;
    const hasMore =
      raw.length > 0 &&
      (resp.total_count != null
        ? next < resp.total_count
        : raw.length === limit);
    return {
      issues: raw.map((issue) => this.mapIssue(issue)),
      total: resp.total_count,
      hasMore,
      nextPageToken: hasMore ? String(next) : undefined,
    };
  }

  async getProjects(): Promise<
    Array<{ id: string; key: string; name: string }>
  > {
    const limit = 100;
    const projects: RedmineProject[] = [];
    for (let offset = 0; ;) {
      const resp = await this.makeRequest<{
        projects?: RedmineProject[];
        total_count?: number;
      }>(`${this.baseUrl}/projects.json?limit=${limit}&offset=${offset}`);
      const page = resp.projects ?? [];
      projects.push(...page);
      offset += page.length;
      if (
        page.length === 0 ||
        page.length < limit ||
        (resp.total_count != null && offset >= resp.total_count)
      ) {
        break;
      }
    }
    return projects.map((p) => ({
      id: String(p.id),
      key: p.identifier,
      name: p.name,
    }));
  }

  async getIssueTypes(
    _projectId: string
  ): Promise<Array<{ id: string; name: string }>> {
    // Redmine trackers are defined globally, not per project.
    const resp = await this.makeRequest<{ trackers?: RedmineNamed[] }>(
      `${this.baseUrl}/trackers.json`
    );
    return (resp.trackers ?? []).map((t) => ({
      id: String(t.id),
      name: t.name,
    }));
  }

  /**
   * The custom fields Redmine applies to issues of one tracker in one
   * project, in the shape the create dialog renders.
   *
   * Redmine only lists field definitions (format, choices, required) to
   * administrators. With any other API key the fields the project lists by
   * name (Redmine 4.2 and later) are offered as plain text inputs instead.
   */
  async getIssueTypeFields(
    projectKey: string,
    issueTypeId: string
  ): Promise<any[]> {
    try {
      const { project } = await this.makeRequest<{ project: RedmineProject }>(
        `${this.baseUrl}/projects/${encodeURIComponent(projectKey)}.json?include=issue_custom_fields`
      );
      const projectFields = project?.issue_custom_fields ?? [];

      let defs: RedmineCustomFieldDef[] | null = null;
      try {
        const resp = await this.makeRequest<{
          custom_fields?: RedmineCustomFieldDef[];
        }>(`${this.baseUrl}/custom_fields.json`);
        defs = resp.custom_fields ?? [];
      } catch {
        defs = null;
      }

      if (!defs) {
        return projectFields.map((f) => ({
          key: String(f.id),
          name: f.name,
          required: false,
          hasDefaultValue: false,
          schema: { type: "string" },
        }));
      }

      const inProject = new Set(projectFields.map((f) => f.id));
      const trackerId = Number(issueTypeId);
      const applicable = defs.filter(
        (def) =>
          def.customized_type === "issue" &&
          def.field_format !== "attachment" &&
          (def.is_for_all ||
            inProject.has(def.id) ||
            (def.projects ?? []).some((p) => p.id === project?.id)) &&
          (Number.isNaN(trackerId) ||
            (def.trackers ?? []).some((t) => t.id === trackerId))
      );

      const formats = new Set(applicable.map((def) => def.field_format));
      const versions = formats.has("version")
        ? await this.loadVersionOptions(projectKey)
        : [];
      const users = formats.has("user")
        ? await this.loadMemberOptions(projectKey)
        : [];

      return applicable.map((def) => {
        const defaultValue = def.default_value ?? "";
        const base = {
          key: String(def.id),
          name: def.name,
          required: def.is_required === true,
          hasDefaultValue: defaultValue !== "",
        };
        const withDefault = (value: unknown) =>
          defaultValue !== "" ? { defaultValue: value } : {};
        const listed: FieldOption[] = (def.possible_values ?? [])
          .map((o) => ({
            id: String(o.value ?? o.label ?? ""),
            name: String(o.label ?? o.value ?? ""),
          }))
          .filter((o) => o.id !== "");

        const choice = (options: FieldOption[]) => {
          if (options.length === 0) {
            return { ...base, schema: { type: "string" } };
          }
          const known = options.some((o) => o.id === defaultValue);
          if (def.multiple) {
            return {
              ...base,
              schema: { type: "array" },
              input: "multiselect",
              allowedValues: options,
              ...(known ? { defaultValue: [defaultValue] } : {}),
            };
          }
          return {
            ...base,
            schema: { type: "option" },
            allowedValues: options,
            ...(known ? { defaultValue } : {}),
          };
        };

        switch (def.field_format) {
          case "list":
          case "enumeration":
            return choice(listed);
          case "version":
            return choice(versions.length > 0 ? versions : listed);
          case "user":
            return choice(users);
          case "bool":
            return {
              ...base,
              schema: { type: "option" },
              allowedValues:
                listed.length > 0
                  ? listed
                  : [
                      { id: "1", name: "Yes" },
                      { id: "0", name: "No" },
                    ],
              ...(defaultValue === "1" || defaultValue === "0"
                ? { defaultValue }
                : {}),
            };
          case "int":
          case "float":
          case "progressbar":
            return {
              ...base,
              schema: { type: "number" },
              ...(defaultValue !== "" && !Number.isNaN(Number(defaultValue))
                ? { defaultValue: Number(defaultValue) }
                : {}),
            };
          case "date":
            return {
              ...base,
              schema: { type: "date" },
              input: "date",
              ...(/^\d{4}-\d{2}-\d{2}$/.test(defaultValue)
                ? { defaultValue }
                : {}),
            };
          case "text":
            return {
              ...base,
              schema: { type: "string" },
              input: "textarea",
              ...withDefault(defaultValue),
            };
          default:
            return {
              ...base,
              schema: { type: "string" },
              ...withDefault(defaultValue),
            };
        }
      });
    } catch (error) {
      console.error("[RedmineAdapter] getIssueTypeFields failed:", error);
      return [];
    }
  }

  /** The project's open versions, for a version-format custom field. */
  private async loadVersionOptions(projectKey: string): Promise<FieldOption[]> {
    try {
      const resp = await this.makeRequest<{
        versions?: Array<RedmineNamed & { status?: string }>;
      }>(
        `${this.baseUrl}/projects/${encodeURIComponent(projectKey)}/versions.json`
      );
      return (resp.versions ?? [])
        .filter((v) => !v.status || v.status === "open")
        .map((v) => ({ id: String(v.id), name: v.name }));
    } catch {
      return [];
    }
  }

  /** The project's members, for a user-format custom field. */
  private async loadMemberOptions(projectKey: string): Promise<FieldOption[]> {
    try {
      const resp = await this.makeRequest<{
        memberships?: Array<{ user?: RedmineNamed }>;
      }>(
        `${this.baseUrl}/projects/${encodeURIComponent(projectKey)}/memberships.json?limit=100`
      );
      return (resp.memberships ?? [])
        .filter((m) => m.user)
        .map((m) => ({ id: String(m.user!.id), name: m.user!.name }));
    } catch {
      return [];
    }
  }

  async getStatuses(): Promise<Array<{ id: string; name: string }>> {
    const resp = await this.makeRequest<{ issue_statuses?: RedmineNamed[] }>(
      `${this.baseUrl}/issue_statuses.json`
    );
    return (resp.issue_statuses ?? []).map((s) => ({
      id: String(s.id),
      name: s.name,
    }));
  }

  async getPriorities(): Promise<Array<{ id: string; name: string }>> {
    const resp = await this.makeRequest<{ issue_priorities?: RedmineNamed[] }>(
      `${this.baseUrl}/enumerations/issue_priorities.json`
    );
    return (resp.issue_priorities ?? []).map((p) => ({
      id: String(p.id),
      name: p.name,
    }));
  }

  async searchUsers(query: string): Promise<
    Array<{
      accountId: string;
      displayName: string;
      emailAddress?: string;
    }>
  > {
    try {
      const params = new URLSearchParams({ name: query, limit: "20" });
      const resp = await this.makeRequest<{ users?: RedmineUser[] }>(
        `${this.baseUrl}/users.json?${params.toString()}`
      );
      return (resp.users ?? []).map((u) => ({
        accountId: String(u.id),
        displayName: this.userDisplayName(u),
        emailAddress: u.mail,
      }));
    } catch (error) {
      // /users.json requires admin privileges; non-admin keys get 403. Fail soft
      // so issue linking still works without user-assignment lookups.
      console.warn("[RedmineAdapter] searchUsers failed:", error);
      return [];
    }
  }

  async getCurrentUser(): Promise<{
    accountId: string;
    displayName: string;
    emailAddress?: string;
  } | null> {
    try {
      const resp = await this.makeRequest<{ user: RedmineUser }>(
        `${this.baseUrl}/users/current.json`
      );
      const u = resp.user;
      return {
        accountId: String(u.id),
        displayName: this.userDisplayName(u),
        emailAddress: u.mail,
      };
    } catch {
      return null;
    }
  }

  async linkToTestCase(
    issueId: string,
    testCaseId: string,
    metadata?: any
  ): Promise<void> {
    try {
      const id = this.parseId(issueId);
      const notes = `Linked to TestPlanIt test case: ${testCaseId}${
        metadata ? `\n\n${JSON.stringify(metadata, null, 2)}` : ""
      }`;
      await this.makeRequest(`${this.baseUrl}/issues/${id}.json`, {
        method: "PUT",
        body: JSON.stringify({ issue: { notes } }),
      });
    } catch (error) {
      console.warn("[RedmineAdapter] linkToTestCase failed:", error);
    }
  }

  async syncIssue(issueId: string): Promise<IssueData> {
    return this.getIssue(issueId);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private parseId(issueId: string): string {
    return issueId.replace(/^#/, "").trim();
  }

  private userDisplayName(u: RedmineUser): string {
    const full = `${u.firstname ?? ""} ${u.lastname ?? ""}`.trim();
    return full || u.login || String(u.id);
  }

  /**
   * Resolve a status name (or numeric id) to a Redmine status id for updates.
   * Accepts a numeric string verbatim; otherwise looks it up by name.
   */
  private async resolveStatusId(status: string): Promise<number | null> {
    const numeric = Number(status);
    if (status.trim() !== "" && !Number.isNaN(numeric)) return numeric;
    try {
      const statuses = await this.getStatuses();
      const match = statuses.find(
        (s) => s.name.toLowerCase() === status.toLowerCase()
      );
      return match ? Number(match.id) : null;
    } catch {
      return null;
    }
  }

  private mapVersion(version: RedmineVersion): ExternalMilestone {
    const status = version.status ?? "open";
    return {
      id: String(version.id),
      kind: "RELEASE",
      name: version.name ?? String(version.id),
      description: version.description || undefined,
      endDate: version.due_date
        ? parseUpstreamDate(version.due_date).date
        : undefined,
      state: status === "closed" ? "CLOSED" : "ACTIVE",
      rawState: status,
      url: `${this.baseUrl}/versions/${version.id}`,
    };
  }

  private mapIssue(issue: RedmineIssue): IssueData {
    const customFields =
      Array.isArray(issue.custom_fields) && issue.custom_fields.length > 0
        ? Object.fromEntries(
            issue.custom_fields.map((cf) => [cf.name, cf.value])
          )
        : undefined;

    return {
      id: String(issue.id),
      key: `#${issue.id}`,
      title: issue.subject ?? "",
      description: issue.description ?? undefined,
      status: issue.status?.name ?? "",
      priority: issue.priority?.name,
      issueType: issue.tracker
        ? { id: String(issue.tracker.id), name: issue.tracker.name }
        : undefined,
      assignee: issue.assigned_to
        ? { id: String(issue.assigned_to.id), name: issue.assigned_to.name }
        : undefined,
      reporter: issue.author
        ? { id: String(issue.author.id), name: issue.author.name }
        : undefined,
      // Redmine has no labels; its nearest equivalent is the issue category.
      labels: issue.category ? [issue.category.name] : [],
      customFields,
      createdAt: issue.created_on ? new Date(issue.created_on) : new Date(),
      updatedAt: issue.updated_on ? new Date(issue.updated_on) : new Date(),
      url: `${this.baseUrl}/issues/${issue.id}`,
    };
  }
}
