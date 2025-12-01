import {
  IssueAdapterCapabilities,
  AuthenticationData,
  IssueData,
  CreateIssueData,
  UpdateIssueData,
  IssueSearchOptions,
} from "./IssueAdapter";
import { BaseAdapter } from "./BaseAdapter";
import { prisma } from "@/lib/prismaBase";

/**
 * Simple URL adapter for basic issue tracking integrations
 * This adapter provides basic functionality for URL-based issue tracking systems
 */
export class SimpleUrlAdapter extends BaseAdapter {
  /**
   * Get the capabilities of this adapter
   */
  getCapabilities(): IssueAdapterCapabilities {
    return {
      createIssue: false, // Simple URL adapters typically can't create issues
      updateIssue: false, // Simple URL adapters typically can't update issues
      linkIssue: true,    // Can link to existing issues via URL
      syncIssue: false,   // Can't sync since no API access
      searchIssues: true, // Can provide basic search functionality
      webhooks: false,    // No webhook support
      customFields: false, // No custom field support
      attachments: false, // No attachment support
    };
  }

  /**
   * Perform adapter-specific authentication
   * Simple URL adapters don't typically require authentication
   */
  protected async performAuthentication(
    authData: AuthenticationData
  ): Promise<void> {
    // Simple URL adapters don't require authentication
    // Just validate that we have a base URL
    if (!authData.baseUrl && !this.config.baseUrl) {
      throw new Error("Base URL is required for Simple URL integration");
    }
  }

  /**
   * Create a new issue - not supported by Simple URL adapters
   */
  async createIssue(_data: CreateIssueData): Promise<IssueData> {
    throw new Error("Creating issues is not supported by Simple URL integration");
  }

  /**
   * Update an existing issue - not supported by Simple URL adapters
   */
  async updateIssue(
    _issueId: string,
    _data: UpdateIssueData
  ): Promise<IssueData> {
    throw new Error("Updating issues is not supported by Simple URL integration");
  }

  /**
   * Get a single issue by ID - creates a mock issue based on URL pattern
   */
  async getIssue(issueId: string): Promise<IssueData> {
    const baseUrl = this.authData?.baseUrl || this.config.baseUrl;
    if (!baseUrl) {
      throw new Error("Base URL not configured");
    }

    // Generate URL by replacing {issueId} placeholder
    const url = baseUrl.replace("{issueId}", issueId).replace("'{issueId}'", issueId);

    return {
      id: issueId,
      key: issueId,
      title: `Issue ${issueId}`,
      description: `Issue linked via Simple URL integration`,
      status: "Unknown",
      createdAt: new Date(),
      updatedAt: new Date(),
      url: url,
    };
  }

  /**
   * Search for issues - searches the internal database for issues linked to this integration
   */
  async searchIssues(options: IssueSearchOptions): Promise<{
    issues: IssueData[];
    total: number;
    hasMore: boolean;
  }> {
    const { query = "", limit = 10 } = options;
    
    // For Simple URL integrations, we search the internal TestPlanIt database
    // for issues that are linked to this integration
    const baseUrl = this.authData?.baseUrl || this.config.baseUrl;
    if (!baseUrl) {
      throw new Error("Base URL not configured");
    }

    // Get the integration ID from config
    const integrationId = this.config.integrationId;
    if (!integrationId) {
      throw new Error("Integration ID not configured");
    }

    // Search issues in the database that belong to this integration
    const where: any = {
      integrationId: integrationId,
      isDeleted: false,
    };

    // Add search filter if query is provided
    if (query.trim()) {
      where.OR = [
        { name: { contains: query, mode: "insensitive" } },
        { title: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
        { externalId: { contains: query, mode: "insensitive" } },
        { externalKey: { contains: query, mode: "insensitive" } },
      ];
    }

    // Get total count for pagination
    const total = await prisma.issue.count({ where });

    // Get the actual issues
    const dbIssues = await prisma.issue.findMany({
      where,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        externalId: true,
        externalKey: true,
        externalUrl: true,
        externalStatus: true,
        createdAt: true,
      },
    });

    // Convert database issues to IssueData format
    const issues: IssueData[] = dbIssues.map((dbIssue) => {
      // Use existing external URL if available, otherwise generate from pattern
      let url = dbIssue.externalUrl;
      if (!url && (dbIssue.externalId || dbIssue.externalKey)) {
        const issueId = dbIssue.externalId || dbIssue.externalKey || dbIssue.id.toString();
        url = baseUrl.replace("{issueId}", issueId).replace("'{issueId}'", issueId);
      }

      return {
        id: dbIssue.externalId || dbIssue.externalKey || dbIssue.id.toString(),
        key: dbIssue.externalKey || dbIssue.externalId || dbIssue.name,
        title: dbIssue.title,
        description: dbIssue.description || undefined,
        status: dbIssue.externalStatus || dbIssue.status || "Unknown",
        priority: dbIssue.priority || undefined,
        createdAt: dbIssue.createdAt,
        updatedAt: dbIssue.createdAt, // Use createdAt since Issue model doesn't have updatedAt
        url: url || undefined,
      };
    });

    return {
      issues,
      total,
      hasMore: dbIssues.length === limit && total > limit,
    };
  }

  /**
   * Link an issue to a test case
   */
  async linkToTestCase(
    issueId: string,
    _testCaseId: string,
    _metadata?: any
  ): Promise<void> {
    // For Simple URL integrations, we just validate that we can generate a valid URL
    const baseUrl = this.authData?.baseUrl || this.config.baseUrl;
    if (!baseUrl) {
      throw new Error("Base URL not configured");
    }

    const url = baseUrl.replace("{issueId}", issueId).replace("'{issueId}'", issueId);
    
    // Basic URL validation
    try {
      new URL(url);
    } catch (error) {
      throw new Error(`Invalid URL generated: ${url}`);
    }

    // Since we can't actually link in the external system, this is a no-op
    // The link will be stored in the TestPlanIt database
  }

  /**
   * Validate configuration
   */
  async validateConfiguration(): Promise<{
    valid: boolean;
    errors?: string[];
  }> {
    const errors: string[] = [];

    const baseUrl = this.authData?.baseUrl || this.config.baseUrl;
    if (!baseUrl) {
      errors.push("Base URL is required");
    } else {
      // Validate URL pattern contains placeholder
      if (!baseUrl.includes("{issueId}") && !baseUrl.includes("'{issueId}'")) {
        errors.push("Base URL must contain {issueId} placeholder");
      }

      // Try to validate URL format
      try {
        const testUrl = baseUrl.replace("{issueId}", "TEST-1").replace("'{issueId}'", "TEST-1");
        new URL(testUrl);
      } catch (error) {
        errors.push("Base URL pattern is not a valid URL format");
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}