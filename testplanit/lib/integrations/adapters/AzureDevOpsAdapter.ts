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
    } catch (error) {
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
      if (typeof data.description === 'object' && data.description && 'type' in data.description && data.description.type === 'doc') {
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
    if (data.customFields) {
      for (const [field, value] of Object.entries(data.customFields)) {
        patchDocument.push({
          op: "add",
          path: `/fields/${field}`,
          value: value,
        });
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
      conditions.push(
        `([System.Title] CONTAINS '${options.query}' OR [System.Description] CONTAINS '${options.query}')`
      );
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

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const wiql = `SELECT [System.Id] FROM WorkItems ${whereClause} ORDER BY [System.CreatedDate] DESC`;

    const wiqlResponse = await this.makeRequest<any>(
      this.buildUrl(
        `/_apis/wit/wiql?api-version=${this.apiVersion}&$top=${options.limit || 200}`
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
    const response = await this.makeRequest<any>(
      this.buildUrl(`/_apis/projects?api-version=${this.apiVersion}`)
    );

    return response.value.map((project: any) => ({
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

  private mapAzureDevOpsWorkItem(workItem: any): IssueData {
    const fields = workItem.fields;

    return {
      id: workItem.id.toString(),
      key: workItem.id.toString(),
      title: fields["System.Title"],
      description: fields["System.Description"],
      status: fields["System.State"],
      priority: fields["Microsoft.VSTS.Common.Priority"]?.toString(),
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
    let text = '';
    
    if (tiptapJson.content && Array.isArray(tiptapJson.content)) {
      tiptapJson.content.forEach((node: any) => {
        if (node.type === 'text') {
          text += node.text || '';
        } else if (node.content && Array.isArray(node.content)) {
          text += this.extractTextFromTiptap(node) + '\n';
        }
      });
    }
    
    return text.trim();
  }
}
