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

interface MantisRef {
  id: number;
  name?: string;
  label?: string;
}

interface MantisUser {
  id: number;
  name?: string;
  real_name?: string;
  email?: string;
}

interface MantisCustomField {
  field: { id: number; name: string };
  value: unknown;
}

interface MantisNote {
  id?: number;
  reporter?: MantisUser;
  text?: string;
  created_at?: string;
}

interface MantisRelationship {
  id: number;
  type?: MantisRef;
  issue?: { id: number };
}

interface MantisTag {
  id: number;
  name: string;
}

interface MantisIssue {
  id: number;
  summary?: string;
  description?: string;
  project?: MantisRef;
  category?: MantisRef;
  status?: MantisRef;
  resolution?: MantisRef;
  priority?: MantisRef;
  severity?: MantisRef;
  reporter?: MantisUser;
  handler?: MantisUser;
  tags?: MantisTag[];
  custom_fields?: MantisCustomField[];
  created_at?: string;
  updated_at?: string;
  notes?: MantisNote[];
  relationships?: MantisRelationship[];
}

interface MantisProject {
  id: number;
  name: string;
  categories?: MantisRef[];
}

/**
 * Adapter for MantisBT (https://www.mantisbt.org) via its REST API (Mantis 2.x).
 *
 * Auth is an API token sent verbatim in the `Authorization` header (no "Bearer"
 * prefix) — handled by BaseAdapter. Mantis has no OAuth, so this adapter is API
 * token only. The REST API lives under `<baseUrl>/api/rest`.
 *
 * MantisBT concepts map onto the IssueAdapter contract as: per-project
 * categories → issue types (Mantis requires a category on every new issue, so
 * the create dialog's "type" selector picks the category), status/priority/
 * severity → config enums passed by name, notes → comments, relationships →
 * linked issues, tags → labels. Single-issue GETs return `{ issues: [issue] }`.
 */
export class MantisBTAdapter extends BaseAdapter {
  private baseUrl: string = "";

  constructor(config: any) {
    super(config);
    const base = config.baseUrl || config.instanceUrl;
    if (base) this.baseUrl = String(base).replace(/\/$/, "");
  }

  private get apiBase(): string {
    return `${this.baseUrl}/api/rest`;
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
      attachments: false,
      linkedIssues: true,
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
        "MantisBT instance URL is required (e.g. https://mantis.example.com)"
      );
    }
    if (authData.type !== "api_key") {
      throw new Error(
        "MantisBT adapter only supports API token authentication"
      );
    }
    const apiKey = authData.apiKey ?? authData.apiToken;
    if (!apiKey) {
      throw new Error("MantisBT API token is required");
    }
    this.authData!.apiKey = apiKey;

    try {
      await this.makeRequest(`${this.apiBase}/users/me`);
    } catch {
      throw new Error("Invalid MantisBT API token or instance URL");
    }
  }

  async searchIssues(options: IssueSearchOptions): Promise<{
    issues: IssueData[];
    total: number;
    hasMore: boolean;
  }> {
    const limit = options.limit || 25;

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

    // The Mantis REST API has no free-text issue search; it lists issues by
    // project. Without a project scope we cannot list, so return empty. With a
    // project we fetch a page and filter client-side by summary substring.
    if (!options.projectId) {
      return { issues: [], total: 0, hasMore: false };
    }

    const pageSize = options.query ? Math.max(limit, 100) : limit;
    const page = options.offset ? Math.floor(options.offset / pageSize) + 1 : 1;
    const params = new URLSearchParams({
      project_id: options.projectId,
      page_size: String(pageSize),
      page: String(page),
    });

    const resp = await this.makeRequest<{ issues?: MantisIssue[] }>(
      `${this.apiBase}/issues?${params.toString()}`
    );
    let issues = (resp.issues ?? []).map((i) => this.mapIssue(i));

    if (options.query) {
      const q = options.query.toLowerCase();
      issues = issues
        .filter((i) => i.title.toLowerCase().includes(q))
        .slice(0, limit);
    }

    return { issues, total: issues.length, hasMore: false };
  }

  async getIssue(issueId: string): Promise<IssueData> {
    const id = this.parseId(issueId);
    // Mantis wraps even a single-issue GET in an `issues` array.
    const resp = await this.makeRequest<{ issues?: MantisIssue[] }>(
      `${this.apiBase}/issues/${id}`
    );
    const issue = resp.issues?.[0];
    if (!issue) {
      throw new Error(`MantisBT issue ${id} not found`);
    }
    return this.mapIssue(issue);
  }

  async createIssue(data: CreateIssueData): Promise<IssueData> {
    const issue: Record<string, unknown> = {
      summary: data.title,
      // Mantis requires a non-empty description on create.
      description: typeof data.description === "string" ? data.description : "",
      project: this.refFromValue(data.projectId),
    };
    // The create dialog's "type" selector maps to the (mandatory) Mantis
    // category — numeric value → category id, otherwise category name.
    if (data.issueType) {
      issue.category = this.refFromValue(data.issueType);
    }
    if (data.priority) {
      issue.priority = { name: data.priority };
    }
    if (data.assigneeId) {
      const handler = this.refFromValue(data.assigneeId);
      if (handler) issue.handler = handler;
    }
    if (data.customFields) {
      issue.custom_fields = Object.entries(data.customFields).map(
        ([id, value]) => ({ field: { id: Number(id) }, value })
      );
    }

    const resp = await this.makeRequest<{ issue: MantisIssue }>(
      `${this.apiBase}/issues`,
      { method: "POST", body: JSON.stringify(issue) }
    );
    return this.mapIssue(resp.issue);
  }

  async updateIssue(
    issueId: string,
    data: UpdateIssueData
  ): Promise<IssueData> {
    const id = this.parseId(issueId);
    const issue: Record<string, unknown> = {};
    if (data.title !== undefined) issue.summary = data.title;
    if (data.description !== undefined) {
      issue.description =
        typeof data.description === "string" ? data.description : "";
    }
    // Statuses/priorities are Mantis config enums with no list endpoint; pass
    // them through by name and let the server resolve them.
    if (data.status !== undefined) issue.status = { name: data.status };
    if (data.priority !== undefined) issue.priority = { name: data.priority };
    if (data.assigneeId !== undefined) {
      const handler = this.refFromValue(data.assigneeId);
      if (handler) issue.handler = handler;
    }

    await this.makeRequest(`${this.apiBase}/issues/${id}`, {
      method: "PATCH",
      body: JSON.stringify(issue),
    });
    // Re-GET so we return a normalized representation regardless of the PATCH
    // response shape.
    return this.getIssue(id);
  }

  async getIssueComments(issueId: string): Promise<IssueComment[]> {
    try {
      const id = this.parseId(issueId);
      const resp = await this.makeRequest<{ issues?: MantisIssue[] }>(
        `${this.apiBase}/issues/${id}`
      );
      const notes = resp.issues?.[0]?.notes ?? [];
      return notes
        .filter((n) => n.text && n.text.trim().length > 0)
        .map((n) => ({
          id: n.id != null ? String(n.id) : undefined,
          author: this.userDisplayName(n.reporter),
          body: n.text ?? "",
          created: n.created_at ?? "",
        }));
    } catch (error) {
      const status = this.parseStatusFromError(error);
      const level = status === null || status >= 500 ? "error" : "warn";
      console[level](
        `[MantisBTAdapter] getIssueComments failed for %s:`,
        issueId,
        error
      );
      return [];
    }
  }

  async getLinkedIssues(issueId: string): Promise<LinkedIssueRef[]> {
    try {
      const id = this.parseId(issueId);
      const resp = await this.makeRequest<{ issues?: MantisIssue[] }>(
        `${this.apiBase}/issues/${id}`
      );
      const relationships = resp.issues?.[0]?.relationships ?? [];
      return relationships
        .filter((r) => r.issue?.id != null)
        .map((r) => ({
          id: String(r.issue!.id),
          key: `#${r.issue!.id}`,
          linkType: r.type?.name ?? r.type?.label ?? "related",
          // Mantis relationships are directionless from the REST shape; the
          // related issue is always the "other" side.
          direction: "outward" as const,
        }));
    } catch (error) {
      console.warn("[MantisBTAdapter] getLinkedIssues failed:", error);
      return [];
    }
  }

  async getProjects(): Promise<
    Array<{ id: string; key: string; name: string }>
  > {
    const resp = await this.makeRequest<{ projects?: MantisProject[] }>(
      `${this.apiBase}/projects`
    );
    return (resp.projects ?? []).map((p) => ({
      id: String(p.id),
      // Mantis has no project slug/key; use the numeric id as the stable key.
      key: String(p.id),
      name: p.name,
    }));
  }

  async getIssueTypes(
    projectId: string
  ): Promise<Array<{ id: string; name: string }>> {
    // Mantis has no issue types; the create flow requires a category, so we
    // surface the project's categories as the selectable "types".
    const resp = await this.makeRequest<{ projects?: MantisProject[] }>(
      `${this.apiBase}/projects/${projectId}`
    );
    const categories = resp.projects?.[0]?.categories ?? [];
    return categories.map((c) => ({
      id: String(c.id),
      name: c.name ?? c.label ?? String(c.id),
    }));
  }

  async getCurrentUser(): Promise<{
    accountId: string;
    displayName: string;
    emailAddress?: string;
  } | null> {
    try {
      // /users/me returns the user object (some versions wrap it in `user`).
      const resp = await this.makeRequest<MantisUser & { user?: MantisUser }>(
        `${this.apiBase}/users/me`
      );
      const u = resp.user ?? resp;
      if (!u || u.id == null) return null;
      return {
        accountId: String(u.id),
        displayName: this.userDisplayName(u),
        emailAddress: u.email,
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
      const text = `Linked to TestPlanIt test case: ${testCaseId}${
        metadata ? `\n\n${JSON.stringify(metadata, null, 2)}` : ""
      }`;
      await this.makeRequest(`${this.apiBase}/issues/${id}/notes`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
    } catch (error) {
      console.warn("[MantisBTAdapter] linkToTestCase failed:", error);
    }
  }

  async syncIssue(issueId: string): Promise<IssueData> {
    return this.getIssue(issueId);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private parseId(issueId: string): string {
    return issueId.replace(/^#/, "").trim();
  }

  /**
   * Build a Mantis object reference from a string value: a numeric value
   * becomes `{ id }`, anything else becomes `{ name }`. Returns undefined for
   * empty input.
   */
  private refFromValue(
    value: string | undefined
  ): { id: number } | { name: string } | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    const num = Number(value);
    return value.trim() !== "" && !Number.isNaN(num)
      ? { id: num }
      : { name: String(value) };
  }

  private userDisplayName(u?: MantisUser): string {
    if (!u) return "Unknown";
    return u.real_name || u.name || String(u.id);
  }

  private mapIssue(issue: MantisIssue): IssueData {
    const customFields =
      Array.isArray(issue.custom_fields) && issue.custom_fields.length > 0
        ? Object.fromEntries(
            issue.custom_fields
              .filter((cf) => cf.field?.name)
              .map((cf) => [cf.field.name, cf.value])
          )
        : undefined;

    return {
      id: String(issue.id),
      key: `#${issue.id}`,
      title: issue.summary ?? "",
      description: issue.description ?? undefined,
      status: issue.status?.name ?? issue.status?.label ?? "",
      priority: issue.priority?.name ?? issue.priority?.label,
      // Mantis has no issue types; surface the category as the nearest analog.
      issueType: issue.category
        ? {
            id: String(issue.category.id),
            name: issue.category.name ?? issue.category.label ?? "",
          }
        : undefined,
      assignee: issue.handler
        ? {
            id: String(issue.handler.id),
            name: this.userDisplayName(issue.handler),
          }
        : undefined,
      reporter: issue.reporter
        ? {
            id: String(issue.reporter.id),
            name: this.userDisplayName(issue.reporter),
          }
        : undefined,
      // Mantis tags are the nearest equivalent to labels.
      labels: (issue.tags ?? []).map((t) => t.name),
      customFields,
      createdAt: issue.created_at ? new Date(issue.created_at) : new Date(),
      updatedAt: issue.updated_at ? new Date(issue.updated_at) : new Date(),
      url: `${this.baseUrl}/view.php?id=${issue.id}`,
    };
  }
}
