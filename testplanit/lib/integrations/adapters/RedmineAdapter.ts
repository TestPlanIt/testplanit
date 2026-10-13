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
}

interface RedmineProject {
  id: number;
  identifier: string;
  name: string;
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
 * relations → linked issues.
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
      issue.description =
        typeof data.description === "string" ? data.description : "";
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
    if (data.customFields) {
      issue.custom_fields = Object.entries(data.customFields).map(
        ([id, value]) => ({ id: Number(id), value })
      );
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
      issue.description =
        typeof data.description === "string" ? data.description : "";
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

  async getProjects(): Promise<
    Array<{ id: string; key: string; name: string }>
  > {
    const resp = await this.makeRequest<{ projects?: RedmineProject[] }>(
      `${this.baseUrl}/projects.json?limit=100`
    );
    return (resp.projects ?? []).map((p) => ({
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
