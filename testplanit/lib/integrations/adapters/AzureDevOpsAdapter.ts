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

/** Mirrors the app's 10MB attachment ceiling (same rationale as Jira). */
const MAX_ATTACHMENT_DOWNLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Azure DevOps' own documented WIQL query-results ceiling — "Work tracking,
 * process, and project limits" (Microsoft Learn): query results are silently
 * truncated at 20,000 items, with no error raised past that point. This
 * bounds how many work-item ids a single WIQL call can return (the whole
 * matching set the import orchestrator pages through) and must NOT be
 * conflated with `options.limit`, which governs only how many of those ids
 * one page hydrates via the follow-up workitems fetch below.
 */
const WIQL_MAX_IDS = 20000;

/** How deep the project's iteration tree is read (release > sprint > ...). */
const ITERATION_TREE_DEPTH = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

/** An iteration found in a project's tree, with the path work items carry. */
interface IterationNode {
  id: number;
  name: string;
  iterationPath: string;
  startDate?: Date;
  finishDate?: Date;
}

/** `project#id`, the external id milestone sync stores for an iteration. */
function iterationExternalId(project: string, id: number | string) {
  return `${project}#${id}`;
}

function parseIterationRef(
  id: string
): { project: string; nodeId: number } | null {
  const match = id.match(/^(.+)#(\d+)$/);
  return match ? { project: match[1], nodeId: Number(match[2]) } : null;
}

function parseIterationDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Azure DevOps gives an iteration dates, not a state. As on its own sprint
 * pages, it is past once its last day is over, current between its dates
 * and future otherwise, including while it has no dates.
 */
function iterationState(node: IterationNode): ExternalMilestone["state"] {
  const now = Date.now();
  if (node.finishDate && now >= node.finishDate.getTime() + DAY_MS) {
    return "CLOSED";
  }
  if (node.startDate && now >= node.startDate.getTime()) {
    return "ACTIVE";
  }
  return "FUTURE";
}

const ITERATION_RAW_STATE: Record<ExternalMilestone["state"], string> = {
  CLOSED: "past",
  ACTIVE: "current",
  FUTURE: "future",
};

/**
 * Give a form value the JSON type its field takes: the create form sends
 * booleans and numeric choices as strings, and a date as a calendar day.
 * A day is sent as noon UTC so it stays the same day for viewers in every
 * timezone from UTC-12 to UTC+11.
 */
function coerceFieldValue(type: string | undefined, value: unknown): unknown {
  if (typeof value !== "string") return value;
  switch (type) {
    case "boolean":
      return value === "true" ? true : value === "false" ? false : value;
    case "integer":
    case "double":
    case "picklistInteger":
    case "picklistDouble":
      return Number.isNaN(Number(value)) ? value : Number(value);
    case "dateTime":
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value;
    default:
      return value;
  }
}

/**
 * Azure DevOps integration adapter using Personal Access Token authentication
 */
export class AzureDevOpsAdapter extends BaseAdapter {
  private organizationUrl?: string;
  private project?: string;
  private apiVersion = "7.0";

  constructor(config: any) {
    super(config);

    // Azure DevOps configuration from settings
    this.organizationUrl = config.organizationUrl;
    this.project = config.project;
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
      milestones: { kinds: ["ITERATION"], webhooks: false },
    };
  }

  protected async performAuthentication(
    authData: AuthenticationData
  ): Promise<void> {
    if (authData.type !== "api_key") {
      throw new Error(
        "Azure DevOps adapter only supports Personal Access Token authentication"
      );
    }

    if (!authData.apiKey) {
      throw new Error(
        "Personal Access Token is required for Azure DevOps authentication"
      );
    }

    if (!this.organizationUrl) {
      throw new Error("Organization URL is required for Azure DevOps");
    }

    // Validate the token by making a test request
    try {
      await this.makeRequest(
        `${this.organizationUrl}/_apis/projects?api-version=${this.apiVersion}`
      );
    } catch {
      throw new Error(
        "Invalid Azure DevOps Personal Access Token or Organization URL"
      );
    }
  }

  protected buildUrl(path: string): string {
    if (!this.organizationUrl) {
      throw new Error("Organization URL not configured");
    }

    // Handle project-specific paths
    if (path.includes("{project}") && this.project) {
      path = path.replace("{project}", encodeURIComponent(this.project));
    }

    return `${this.organizationUrl}${path}`;
  }

  async createIssue(data: CreateIssueData): Promise<IssueData> {
    // Ensure we have a project
    if (!this.project && data.projectId) {
      this.project = data.projectId;
    }

    if (!this.project) {
      throw new Error("Azure DevOps project not configured");
    }

    // Build work item patch document
    const patchDocument = [
      {
        op: "add",
        path: "/fields/System.Title",
        value: data.title,
      },
    ];

    if (data.description) {
      // Convert TipTap JSON to HTML if needed
      let descriptionValue: string;
      if (
        typeof data.description === "object" &&
        data.description &&
        "type" in data.description &&
        data.description.type === "doc"
      ) {
        // For now, extract plain text from TipTap JSON
        // Azure DevOps expects HTML or plain text
        descriptionValue = this.extractTextFromTiptap(data.description);
      } else {
        descriptionValue = data.description as string;
      }

      patchDocument.push({
        op: "add",
        path: "/fields/System.Description",
        value: descriptionValue,
      });
    }

    if (data.priority) {
      patchDocument.push({
        op: "add",
        path: "/fields/Microsoft.VSTS.Common.Priority",
        value: parseInt(data.priority),
      } as any);
    }

    if (data.assigneeId) {
      patchDocument.push({
        op: "add",
        path: "/fields/System.AssignedTo",
        value: data.assigneeId,
      });
    }

    if (data.labels && data.labels.length > 0) {
      patchDocument.push({
        op: "add",
        path: "/fields/System.Tags",
        value: data.labels.join("; "),
      });
    }

    // Add custom fields
    const customFields = Object.entries(data.customFields ?? {}).filter(
      ([, value]) => value !== undefined && value !== null && value !== ""
    );
    if (customFields.length > 0) {
      const types = await this.loadFieldTypes();
      for (const [field, value] of customFields) {
        patchDocument.push({
          op: "add",
          path: `/fields/${field}`,
          value: coerceFieldValue(types.get(field), value),
        } as any);
      }
    }

    const workItemType = data.issueType || "Bug";
    const response = await this.makeRequest<any>(
      this.buildUrl(
        `/{project}/_apis/wit/workitems/$${workItemType}?api-version=${this.apiVersion}`
      ),
      {
        method: "POST",
        body: JSON.stringify(patchDocument),
        headers: {
          "Content-Type": "application/json-patch+json",
        },
      }
    );

    return this.mapAzureDevOpsWorkItem(response);
  }

  async updateIssue(
    issueId: string,
    data: UpdateIssueData
  ): Promise<IssueData> {
    const patchDocument = [];

    if (data.title !== undefined) {
      patchDocument.push({
        op: "replace",
        path: "/fields/System.Title",
        value: data.title,
      });
    }

    if (data.description !== undefined) {
      patchDocument.push({
        op: "replace",
        path: "/fields/System.Description",
        value: data.description,
      });
    }

    if (data.status !== undefined) {
      patchDocument.push({
        op: "replace",
        path: "/fields/System.State",
        value: data.status,
      });
    }

    if (data.priority !== undefined) {
      patchDocument.push({
        op: "replace",
        path: "/fields/Microsoft.VSTS.Common.Priority",
        value: parseInt(data.priority),
      } as any);
    }

    if (data.assigneeId !== undefined) {
      patchDocument.push({
        op: "replace",
        path: "/fields/System.AssignedTo",
        value: data.assigneeId,
      });
    }

    if (data.labels !== undefined) {
      patchDocument.push({
        op: "replace",
        path: "/fields/System.Tags",
        value: data.labels.join("; "),
      });
    }

    // Update custom fields
    if (data.customFields) {
      for (const [field, value] of Object.entries(data.customFields)) {
        patchDocument.push({
          op: "replace",
          path: `/fields/${field}`,
          value: value,
        });
      }
    }

    const response = await this.makeRequest<any>(
      this.buildUrl(
        `/_apis/wit/workitems/${issueId}?api-version=${this.apiVersion}`
      ),
      {
        method: "PATCH",
        body: JSON.stringify(patchDocument),
        headers: {
          "Content-Type": "application/json-patch+json",
        },
      }
    );

    return this.mapAzureDevOpsWorkItem(response);
  }

  async getIssue(issueId: string): Promise<IssueData> {
    const response = await this.makeRequest<any>(
      this.buildUrl(
        `/_apis/wit/workitems/${issueId}?api-version=${this.apiVersion}&$expand=all`
      )
    );

    return this.mapAzureDevOpsWorkItem(response);
  }

  async getLinkedIssues(issueId: string): Promise<LinkedIssueRef[]> {
    try {
      const encodedId = encodeURIComponent(issueId);
      const response = await this.makeRequest<any>(
        this.buildUrl(
          `/_apis/wit/workitems/${encodedId}?api-version=${this.apiVersion}&$expand=relations`
        )
      );
      return this.mapWorkItemRelations(response);
    } catch (error) {
      const status = this.parseStatusFromError(error);
      const level = status === null || status >= 500 ? "error" : "warn";
      console[level](
        `[AzureDevOpsAdapter] getLinkedIssues failed for %s:`,
        issueId,
        error
      );
      return [];
    }
  }

  async getIssueComments(issueId: string): Promise<IssueComment[]> {
    try {
      const encodedId = encodeURIComponent(issueId);
      const base = `/_apis/wit/workitems/${encodedId}/comments?api-version=${this.apiVersion}-preview&$top=200`;
      const comments: IssueComment[] = [];
      let continuationToken: string | undefined;
      do {
        const response = await this.makeRequest<any>(
          this.buildUrl(
            continuationToken
              ? `${base}&continuationToken=${encodeURIComponent(continuationToken)}`
              : base
          )
        );
        comments.push(...this.mapAzureDevOpsComments(response));
        continuationToken =
          typeof response?.continuationToken === "string" &&
          response.continuationToken !== ""
            ? response.continuationToken
            : undefined;
      } while (continuationToken);
      return comments;
    } catch (error) {
      const status = this.parseStatusFromError(error);
      const level = status === null || status >= 500 ? "error" : "warn";
      console[level](
        `[AzureDevOpsAdapter] getIssueComments failed for %s:`,
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
    // Build WIQL query
    const conditions: string[] = [];

    if (this.project) {
      conditions.push(`[System.TeamProject] = '${this.project}'`);
    } else if (options.projectId) {
      conditions.push(`[System.TeamProject] = '${options.projectId}'`);
    }

    if (options.query) {
      // Key format: numeric ID — use exact ID match
      if (/^\d+$/.test(options.query.trim())) {
        conditions.push(`[System.Id] = ${options.query.trim()}`);
      } else {
        conditions.push(
          `([System.Title] CONTAINS '${options.query}' OR [System.Description] CONTAINS '${options.query}')`
        );
      }
    }

    if (options.status && options.status.length > 0) {
      const statusCondition = options.status
        .map((s) => `[System.State] = '${s}'`)
        .join(" OR ");
      conditions.push(`(${statusCondition})`);
    }

    if (options.assignee) {
      conditions.push(`[System.AssignedTo] = '${options.assignee}'`);
    }

    if (options.labels && options.labels.length > 0) {
      const labelConditions = options.labels.map(
        (l) => `[System.Tags] CONTAINS '${l}'`
      );
      conditions.push(`(${labelConditions.join(" OR ")})`);
    }

    // Bulk-import recency window — WIQL supports the `@Today - N` macro for a
    // relative day offset on the changed-date field.
    if (options.updatedWithinDays && options.updatedWithinDays > 0) {
      conditions.push(
        `[System.ChangedDate] >= @Today - ${Math.floor(options.updatedWithinDays)}`
      );
    }

    // Type-scoped import (SCALE-01) — ids here are work-item type NAMES,
    // because getIssueTypes returns `{ id: type.name }` for Azure DevOps, not
    // a numeric id. WIQL has no parameter binding, so strip any value
    // containing a single quote, backslash or newline before quoting it —
    // that's the only injection barrier available for this dialect.
    if (options.issueTypeIds?.length) {
      const safeTypes = options.issueTypeIds.filter(
        (id) => !/['\\\n\r]/.test(id)
      );
      if (safeTypes.length > 0) {
        conditions.push(
          `[System.WorkItemType] IN (${safeTypes.map((t) => `'${t}'`).join(", ")})`
        );
      }
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const wiql = `SELECT [System.Id] FROM WorkItems ${whereClause} ORDER BY [System.CreatedDate] DESC`;

    const wiqlResponse = await this.makeRequest<any>(
      this.buildUrl(
        `/_apis/wit/wiql?api-version=${this.apiVersion}&$top=${WIQL_MAX_IDS}`
      ),
      {
        method: "POST",
        body: JSON.stringify({ query: wiql }),
      }
    );

    if (!wiqlResponse.workItems || wiqlResponse.workItems.length === 0) {
      return {
        issues: [],
        total: 0,
        hasMore: false,
      };
    }

    // Get the work items details
    const ids = wiqlResponse.workItems
      .slice(options.offset || 0, (options.offset || 0) + (options.limit || 50))
      .map((item: any) => item.id);

    if (ids.length === 0) {
      return {
        issues: [],
        total: wiqlResponse.workItems.length,
        hasMore: false,
      };
    }

    const response = await this.makeRequest<any>(
      this.buildUrl(
        `/_apis/wit/workitems?ids=${ids.join(",")}&api-version=${this.apiVersion}&$expand=all`
      )
    );

    return {
      issues: response.value.map((item: any) =>
        this.mapAzureDevOpsWorkItem(item)
      ),
      total: wiqlResponse.workItems.length,
      hasMore:
        (options.offset || 0) + ids.length < wiqlResponse.workItems.length,
    };
  }

  protected async addComment(issueId: string, comment: string): Promise<void> {
    await this.makeRequest(
      this.buildUrl(
        `/_apis/wit/workitems/${issueId}/comments?api-version=${this.apiVersion}-preview`
      ),
      {
        method: "POST",
        body: JSON.stringify({ text: comment }),
      }
    );
  }

  /**
   * Get available projects
   */
  async getProjects(): Promise<
    Array<{ id: string; key: string; name: string }>
  > {
    const top = 100;
    const projects: any[] = [];
    for (let skip = 0; ; skip += top) {
      const response = await this.makeRequest<any>(
        this.buildUrl(
          `/_apis/projects?api-version=${this.apiVersion}&$top=${top}&$skip=${skip}`
        )
      );
      const page: any[] = Array.isArray(response?.value) ? response.value : [];
      projects.push(...page);
      if (page.length < top) break;
    }

    return projects.map((project: any) => ({
      id: project.id,
      key: project.name,
      name: project.name,
    }));
  }

  /**
   * Get work item types for a project
   */
  async getIssueTypes(
    projectId: string
  ): Promise<Array<{ id: string; name: string }>> {
    const project = projectId || this.project;
    if (!project) {
      throw new Error("Project not specified");
    }

    const response = await this.makeRequest<any>(
      this.buildUrl(
        `/${project}/_apis/wit/workitemtypes?api-version=${this.apiVersion}`
      )
    );

    return response.value.map((type: any) => ({
      id: type.name,
      name: type.name,
    }));
  }

  /** Each field's data type, by reference name. Empty when the list cannot be read. */
  private async loadFieldTypes(project?: string): Promise<Map<string, string>> {
    try {
      const response = await this.makeRequest<any>(
        this.buildUrl(
          `/${project ? encodeURIComponent(project) : "{project}"}/_apis/wit/fields?api-version=${this.apiVersion}`
        )
      );
      return new Map(
        (response?.value ?? []).map((f: any) => [
          String(f.referenceName),
          String(f.type ?? ""),
        ])
      );
    } catch {
      return new Map();
    }
  }

  /**
   * The custom fields of one work item type, in the shape the create dialog
   * renders. A work item type carries a hundred or so built-in fields, so
   * only the ones an organization added itself are offered: every field
   * outside the `System.`, `Microsoft.` and board (`WEF_`) namespaces.
   */
  async getIssueTypeFields(
    projectKey: string,
    issueTypeId: string
  ): Promise<any[]> {
    try {
      const project = projectKey || this.project;
      if (!project || !issueTypeId) return [];
      const response = await this.makeRequest<any>(
        this.buildUrl(
          `/${encodeURIComponent(project)}/_apis/wit/workitemtypes/${encodeURIComponent(issueTypeId)}/fields?$expand=all&api-version=${this.apiVersion}`
        )
      );
      const types = await this.loadFieldTypes(project);

      const fields: any[] = [];
      for (const field of response?.value ?? []) {
        const key = String(field.referenceName ?? "");
        if (!key || /^(System\.|Microsoft\.|WEF_)/.test(key)) continue;
        const type = types.get(key) ?? "string";
        if (["treePath", "history", "guid"].includes(type)) continue;

        const rawDefault = field.defaultValue;
        const hasDefault =
          typeof rawDefault === "string" ||
          typeof rawDefault === "number" ||
          typeof rawDefault === "boolean";
        const base = {
          key,
          name: String(field.name ?? key),
          required: field.alwaysRequired === true,
          hasDefaultValue: hasDefault,
        };
        const allowedValues = (field.allowedValues ?? [])
          .filter(
            (v: unknown) => typeof v === "string" || typeof v === "number"
          )
          .map((v: string | number) => ({ id: String(v), name: String(v) }));

        if (type === "boolean") {
          fields.push({
            ...base,
            schema: { type: "option" },
            allowedValues: [
              { id: "true", name: "Yes" },
              { id: "false", name: "No" },
            ],
            ...(hasDefault ? { defaultValue: String(rawDefault) } : {}),
          });
        } else if (allowedValues.length > 0) {
          fields.push({
            ...base,
            schema: { type: "option" },
            allowedValues,
            ...(hasDefault ? { defaultValue: String(rawDefault) } : {}),
          });
        } else if (
          ["integer", "double", "picklistInteger", "picklistDouble"].includes(
            type
          )
        ) {
          fields.push({
            ...base,
            schema: { type: "number" },
            ...(hasDefault && !Number.isNaN(Number(rawDefault))
              ? { defaultValue: Number(rawDefault) }
              : {}),
          });
        } else if (type === "dateTime") {
          fields.push({ ...base, schema: { type: "date" }, input: "date" });
        } else if (type === "html" || type === "plainText") {
          fields.push({
            ...base,
            schema: { type: "string" },
            input: "textarea",
            ...(hasDefault ? { defaultValue: String(rawDefault) } : {}),
          });
        } else {
          fields.push({
            ...base,
            schema: { type: "string" },
            ...(hasDefault ? { defaultValue: String(rawDefault) } : {}),
          });
        }
      }
      return fields;
    } catch (error) {
      console.error("[AzureDevOpsAdapter] getIssueTypeFields failed:", error);
      return [];
    }
  }

  /**
   * Get available states for work items
   */
  async getStatuses(): Promise<Array<{ id: string; name: string }>> {
    // Azure DevOps states are defined per work item type and process
    // Return common states
    return [
      { id: "New", name: "New" },
      { id: "Active", name: "Active" },
      { id: "Resolved", name: "Resolved" },
      { id: "Closed", name: "Closed" },
      { id: "Removed", name: "Removed" },
    ];
  }

  /**
   * Get priorities
   */
  async getPriorities(): Promise<Array<{ id: string; name: string }>> {
    return [
      { id: "1", name: "1 - Critical" },
      { id: "2", name: "2 - High" },
      { id: "3", name: "3 - Medium" },
      { id: "4", name: "4 - Low" },
    ];
  }

  /**
   * Upload attachment to a work item
   */
  async uploadAttachment(
    issueId: string,
    file: Buffer,
    filename: string
  ): Promise<{ id: string; url: string }> {
    // First, upload the attachment
    const uploadResponse = await this.makeRequest<any>(
      this.buildUrl(
        `/_apis/wit/attachments?fileName=${encodeURIComponent(filename)}&api-version=${this.apiVersion}`
      ),
      {
        method: "POST",
        body: file as any,
        headers: {
          "Content-Type": "application/octet-stream",
        },
      }
    );

    // Then, link it to the work item
    const patchDocument = [
      {
        op: "add",
        path: "/relations/-",
        value: {
          rel: "AttachedFile",
          url: uploadResponse.url,
        },
      },
    ];

    await this.makeRequest(
      this.buildUrl(
        `/_apis/wit/workitems/${issueId}?api-version=${this.apiVersion}`
      ),
      {
        method: "PATCH",
        body: JSON.stringify(patchDocument),
        headers: {
          "Content-Type": "application/json-patch+json",
        },
      }
    );

    return {
      id: uploadResponse.id,
      url: uploadResponse.url,
    };
  }

  /**
   * List a work item's AttachedFile relations. ADO returns these on every
   * $expand=relations fetch — mapWorkItemRelations deliberately filters to
   * System.LinkTypes.* for linked-issue semantics, so attachments need
   * their own accessor. ADO stores no mimeType on attachments; callers
   * infer from the filename.
   */
  async listAttachments(issueId: string): Promise<IssueAttachmentMeta[]> {
    const encodedId = encodeURIComponent(issueId);
    const response = await this.makeRequest<any>(
      this.buildUrl(
        `/_apis/wit/workitems/${encodedId}?api-version=${this.apiVersion}&$expand=relations`
      )
    );

    const relations = Array.isArray(response?.relations)
      ? response.relations
      : [];
    const attachments: IssueAttachmentMeta[] = [];
    for (const relation of relations) {
      if (relation?.rel !== "AttachedFile" || !relation.url) continue;
      // Attachment URLs end in /_apis/wit/attachments/{guid}
      const guid = /\/_apis\/wit\/attachments\/([0-9a-f-]+)/i.exec(
        relation.url
      )?.[1];
      if (!guid) continue;
      attachments.push({
        id: guid,
        filename: relation.attributes?.name ?? `attachment-${guid}`,
        byteSize:
          typeof relation.attributes?.resourceSize === "number"
            ? relation.attributes.resourceSize
            : undefined,
        createdAt: relation.attributes?.resourceCreatedDate
          ? new Date(relation.attributes.resourceCreatedDate)
          : undefined,
        contentUrl: relation.url,
      });
    }
    return attachments;
  }

  /** Download one attachment's bytes (same-origin — the auth header applies). */
  async downloadAttachment(
    meta: IssueAttachmentMeta
  ): Promise<{ buffer: Buffer; mimeType?: string }> {
    const url = meta.contentUrl
      ? `${meta.contentUrl}${meta.contentUrl.includes("?") ? "&" : "?"}download=true&api-version=${this.apiVersion}`
      : this.buildUrl(
          `/_apis/wit/attachments/${meta.id}?download=true&api-version=${this.apiVersion}`
        );

    const { buffer, contentType } = await this.makeBinaryRequest(
      url,
      MAX_ATTACHMENT_DOWNLOAD_BYTES
    );
    // ADO serves attachments as application/octet-stream — prefer a real
    // image content type when present, else let the caller infer from the
    // filename.
    const mimeType =
      contentType && contentType !== "application/octet-stream"
        ? contentType
        : meta.mimeType;
    return { buffer, mimeType };
  }

  private iterationNodes = new Map<string, IterationNode>();

  /**
   * Every iteration in the project's tree, flattened. A work item's
   * iteration path is the project name followed by the node names below the
   * tree's root.
   */
  private async loadIterations(project: string): Promise<IterationNode[]> {
    const root = await this.makeRequest<any>(
      `${this.organizationUrl}/${encodeURIComponent(project)}/_apis/wit/classificationnodes/Iterations?$depth=${ITERATION_TREE_DEPTH}&api-version=${this.apiVersion}`
    );
    const nodes: IterationNode[] = [];
    const walk = (children: unknown, ancestors: string[]) => {
      if (!Array.isArray(children)) return;
      for (const child of children) {
        if (typeof child?.id !== "number" || typeof child?.name !== "string") {
          continue;
        }
        const names = [...ancestors, child.name];
        nodes.push({
          id: child.id,
          name: names.join("\\"),
          iterationPath: [project, ...names].join("\\"),
          startDate: parseIterationDate(child.attributes?.startDate),
          finishDate: parseIterationDate(child.attributes?.finishDate),
        });
        walk(child.children, names);
      }
    };
    walk(root?.children, []);
    for (const node of nodes) {
      this.iterationNodes.set(iterationExternalId(project, node.id), node);
    }
    return nodes;
  }

  /**
   * The project's iterations (sprints) in the shape milestone sync
   * consumes. The external id is `project#<node id>`: enough for
   * `getMilestoneIssues` to find the project again, and unique across the
   * integration. Azure Boards has no release artifact.
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
    if (options.kind === "RELEASE") {
      return { items: [], hasMore: false };
    }
    const project = options.projectKey || this.project;
    if (!project) {
      throw new Error("Azure DevOps project not configured");
    }
    const nodes = await this.loadIterations(project);
    const items = nodes.map((node): ExternalMilestone => {
      const state = iterationState(node);
      return {
        id: iterationExternalId(project, node.id),
        kind: "ITERATION",
        name: node.name,
        startDate: node.startDate,
        endDate: node.finishDate,
        state,
        rawState: ITERATION_RAW_STATE[state],
      };
    });
    return {
      items: options.includeClosed
        ? items
        : items.filter((item) => item.state !== "CLOSED"),
      hasMore: false,
    };
  }

  /**
   * The work items assigned to an iteration itself, a page at a time; items
   * in an iteration nested under it belong to that one. An iteration that
   * no longer exists is an error, never an empty list, which would read as
   * every member having left.
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
    const parsed = parseIterationRef(ref.id);
    if (!parsed || ref.kind !== "ITERATION") {
      return { issues: [], hasMore: false };
    }
    const { project, nodeId } = parsed;
    const key = iterationExternalId(project, nodeId);
    if (!this.iterationNodes.has(key)) {
      await this.loadIterations(project);
    }
    const node = this.iterationNodes.get(key);
    if (!node) {
      throw new Error(`Azure DevOps iteration ${ref.id} was not found`);
    }

    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
    const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = ${quote(project)} AND [System.IterationPath] = ${quote(node.iterationPath)} ORDER BY [System.Id]`;
    const wiqlResponse = await this.makeRequest<any>(
      `${this.organizationUrl}/_apis/wit/wiql?api-version=${this.apiVersion}&$top=${WIQL_MAX_IDS}`,
      { method: "POST", body: JSON.stringify({ query: wiql }) }
    );
    const allIds: number[] = Array.isArray(wiqlResponse?.workItems)
      ? wiqlResponse.workItems.map((item: any) => item.id)
      : [];

    const offset = Math.max(0, Number(options?.pageToken) || 0);
    const limit = Math.min(200, Math.max(1, options?.limit ?? 100));
    const ids = allIds.slice(offset, offset + limit);
    if (ids.length === 0) {
      return { issues: [], total: allIds.length, hasMore: false };
    }

    const response = await this.makeRequest<any>(
      `${this.organizationUrl}/_apis/wit/workitems?ids=${ids.join(",")}&api-version=${this.apiVersion}&$expand=all`
    );
    const hasMore = offset + ids.length < allIds.length;
    return {
      issues: (Array.isArray(response?.value) ? response.value : []).map(
        (item: any) => this.mapAzureDevOpsWorkItem(item)
      ),
      total: allIds.length,
      hasMore,
      nextPageToken: hasMore ? String(offset + ids.length) : undefined,
    };
  }

  private mapAzureDevOpsComments(response: any): IssueComment[] {
    const comments = Array.isArray(response?.comments) ? response.comments : [];
    const out: IssueComment[] = [];
    for (const c of comments) {
      if (!c) continue;
      out.push({
        id: c.id != null ? String(c.id) : undefined,
        author: c.createdBy?.displayName ?? "Unknown",
        body: c.text ?? "",
        created: c.createdDate ?? "",
      });
    }
    return out;
  }

  private mapWorkItemRelations(workItem: any): LinkedIssueRef[] {
    const relations = Array.isArray(workItem?.relations)
      ? workItem.relations
      : [];
    const refs: LinkedIssueRef[] = [];
    const SYSTEM_PREFIX = "System.LinkTypes.";

    for (const relation of relations) {
      const rel = relation?.rel;
      if (typeof rel !== "string" || !rel.startsWith(SYSTEM_PREFIX)) continue;

      const url = relation?.url;
      if (typeof url !== "string") continue;

      const idMatch = url.match(/workItems\/(\d+)$/i);
      if (!idMatch) continue;

      const linkType = rel.substring(SYSTEM_PREFIX.length);
      let direction: "outward" | "inward";
      if (linkType.endsWith("-Reverse")) {
        direction = "inward";
      } else {
        direction = "outward";
      }

      refs.push({
        id: idMatch[1],
        key: idMatch[1],
        linkType,
        direction,
      });
    }

    return refs;
  }

  private mapAzureDevOpsWorkItem(workItem: any): IssueData {
    const fields = workItem.fields;
    // getIssueTypes returns { id: type.name, name: type.name } — the work
    // item type NAME is the id the Requirement Types picker stores, so
    // issueType.id must be that same name, not some other identifier.
    const workItemType = fields["System.WorkItemType"];

    return {
      id: workItem.id.toString(),
      key: workItem.id.toString(),
      title: fields["System.Title"],
      description: fields["System.Description"],
      status: fields["System.State"],
      priority: fields["Microsoft.VSTS.Common.Priority"]?.toString(),
      issueType:
        typeof workItemType === "string" && workItemType
          ? { id: workItemType, name: workItemType }
          : undefined,
      assignee: fields["System.AssignedTo"]
        ? {
            id:
              fields["System.AssignedTo"].uniqueName ||
              fields["System.AssignedTo"],
            name:
              fields["System.AssignedTo"].displayName ||
              fields["System.AssignedTo"],
            email: fields["System.AssignedTo"].uniqueName,
          }
        : undefined,
      reporter: fields["System.CreatedBy"]
        ? {
            id:
              fields["System.CreatedBy"].uniqueName ||
              fields["System.CreatedBy"],
            name:
              fields["System.CreatedBy"].displayName ||
              fields["System.CreatedBy"],
            email: fields["System.CreatedBy"].uniqueName,
          }
        : undefined,
      labels: fields["System.Tags"]
        ? fields["System.Tags"].split(";").map((tag: string) => tag.trim())
        : [],
      customFields: this.extractCustomFields(fields),
      createdAt: new Date(fields["System.CreatedDate"]),
      updatedAt: new Date(fields["System.ChangedDate"]),
      url: workItem._links?.html?.href || workItem.url,
    };
  }

  private extractCustomFields(fields: any): Record<string, any> {
    const customFields: Record<string, any> = {};
    const systemFields = [
      "System.Id",
      "System.Title",
      "System.Description",
      "System.State",
      "System.AssignedTo",
      "System.CreatedBy",
      "System.CreatedDate",
      "System.ChangedDate",
      "System.Tags",
      "System.TeamProject",
      "System.WorkItemType",
      "Microsoft.VSTS.Common.Priority",
    ];

    for (const [key, value] of Object.entries(fields)) {
      if (
        !systemFields.includes(key) &&
        value !== null &&
        value !== undefined
      ) {
        customFields[key] = value;
      }
    }

    return customFields;
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

  private extractTextFromTiptap(tiptapJson: any): string {
    // Simple text extraction from TipTap JSON
    let text = "";

    if (tiptapJson.content && Array.isArray(tiptapJson.content)) {
      tiptapJson.content.forEach((node: any) => {
        if (node.type === "text") {
          text += node.text || "";
        } else if (node.content && Array.isArray(node.content)) {
          text += this.extractTextFromTiptap(node) + "\n";
        }
      });
    }

    return text.trim();
  }
}
