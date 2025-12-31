import { APIRequestContext } from "@playwright/test";

/**
 * API Helper for creating and cleaning up test data via the TestPlanIt API.
 * Uses ZenStack auto-generated API endpoints.
 */
export class ApiHelper {
  private request: APIRequestContext;
  private baseURL: string;
  private createdFolderIds: number[] = [];
  private createdCaseIds: number[] = [];
  private cachedTemplateId: number | null = null;
  private cachedStateId: number | null = null;
  private cachedRepositoryId: number | null = null;

  constructor(request: APIRequestContext, baseURL: string) {
    this.request = request;
    this.baseURL = baseURL;
  }

  /**
   * Get an available template ID for the project
   * Templates have a many-to-many relationship with projects via TemplateProjectAssignment
   */
  async getTemplateId(projectId: number): Promise<number> {
    if (this.cachedTemplateId) return this.cachedTemplateId;

    const response = await this.request.get(
      `${this.baseURL}/api/model/templates/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: {
              isDeleted: false,
              projects: {
                some: { projectId },
              },
            },
            take: 1,
          }),
        },
      }
    );

    if (!response.ok()) {
      throw new Error("Failed to fetch templates");
    }

    const result = await response.json();
    if (result.data.length === 0) {
      throw new Error("No templates found for project. Run seed first.");
    }

    this.cachedTemplateId = result.data[0].id;
    return this.cachedTemplateId as number;
  }

  /**
   * Get an available workflow ID for the project (used as stateId in RepositoryCases)
   * Workflows have a many-to-many relationship with projects via ProjectWorkflowAssignment
   */
  async getStateId(projectId: number): Promise<number> {
    if (this.cachedStateId) return this.cachedStateId;

    const response = await this.request.get(
      `${this.baseURL}/api/model/workflows/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: {
              isDeleted: false,
              projects: {
                some: { projectId },
              },
            },
            take: 1,
          }),
        },
      }
    );

    if (!response.ok()) {
      throw new Error("Failed to fetch workflows");
    }

    const result = await response.json();
    if (result.data.length === 0) {
      throw new Error("No workflows found for project. Run seed first.");
    }

    this.cachedStateId = result.data[0].id;
    return this.cachedStateId as number;
  }

  /**
   * Get the repository ID for a project
   */
  async getRepositoryId(projectId: number): Promise<number> {
    if (this.cachedRepositoryId) return this.cachedRepositoryId;

    const response = await this.request.get(
      `${this.baseURL}/api/model/repositories/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: { projectId },
            take: 1,
          }),
        },
      }
    );

    if (!response.ok()) {
      throw new Error("Failed to fetch repositories");
    }

    const result = await response.json();
    if (result.data.length === 0) {
      throw new Error("No repositories found in test database. Run seed first.");
    }

    this.cachedRepositoryId = result.data[0].id;
    return this.cachedRepositoryId as number;
  }

  /**
   * Create a folder via API
   * Uses ZenStack's relation connect syntax
   */
  async createFolder(
    projectId: number,
    name: string,
    parentId?: number
  ): Promise<number> {
    const repositoryId = await this.getRepositoryId(projectId);

    const data: Record<string, unknown> = {
      name,
      order: 0,
      isDeleted: false,
      docs: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph" }],
      }),
      // Use connect for relations (ZenStack requirement)
      project: { connect: { id: projectId } },
      repository: { connect: { id: repositoryId } },
    };

    // Only add parent connection if provided
    if (parentId) {
      data.parent = { connect: { id: parentId } };
    }

    const response = await this.request.post(
      `${this.baseURL}/api/model/repositoryFolders/create`,
      {
        data: { data },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`Failed to create folder: ${error}`);
    }

    const result = await response.json();
    const folderId = result.data.id;
    this.createdFolderIds.push(folderId);
    return folderId;
  }

  /**
   * Create a test case via API
   * Uses ZenStack's relation connect syntax
   */
  async createTestCase(
    projectId: number,
    folderId: number,
    name: string
  ): Promise<number> {
    const [repositoryId, templateId, stateId] = await Promise.all([
      this.getRepositoryId(projectId),
      this.getTemplateId(projectId),
      this.getStateId(projectId),
    ]);

    const response = await this.request.post(
      `${this.baseURL}/api/model/repositoryCases/create`,
      {
        data: {
          data: {
            name,
            order: 0,
            automated: false,
            isArchived: false,
            isDeleted: false,
            currentVersion: 1,
            source: "MANUAL",
            // Use connect for relations (ZenStack requirement)
            project: { connect: { id: projectId } },
            repository: { connect: { id: repositoryId } },
            folder: { connect: { id: folderId } },
            template: { connect: { id: templateId } },
            state: { connect: { id: stateId } },
          },
        },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`Failed to create test case: ${error}`);
    }

    const result = await response.json();
    const caseId = result.data.id;
    this.createdCaseIds.push(caseId);
    return caseId;
  }

  /**
   * Delete a folder via API
   */
  async deleteFolder(folderId: number): Promise<void> {
    const response = await this.request.post(
      `${this.baseURL}/api/model/repositoryFolders/update`,
      {
        data: {
          where: { id: folderId },
          data: { isDeleted: true },
        },
      }
    );

    if (!response.ok()) {
      console.warn(`Failed to delete folder ${folderId}`);
    }
  }

  /**
   * Delete a test case via API
   */
  async deleteTestCase(caseId: number): Promise<void> {
    const response = await this.request.post(
      `${this.baseURL}/api/model/repositoryCases/update`,
      {
        data: {
          where: { id: caseId },
          data: { isDeleted: true },
        },
      }
    );

    if (!response.ok()) {
      console.warn(`Failed to delete test case ${caseId}`);
    }
  }

  /**
   * Get projects list
   */
  async getProjects(): Promise<Array<{ id: number; name: string }>> {
    const response = await this.request.get(
      `${this.baseURL}/api/model/projects/findMany`,
      {
        params: { q: JSON.stringify({}) },
      }
    );

    if (!response.ok()) {
      throw new Error("Failed to fetch projects");
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Get folders for a project
   */
  async getFolders(
    projectId: number
  ): Promise<Array<{ id: number; name: string; parentId: number | null }>> {
    const response = await this.request.get(
      `${this.baseURL}/api/model/repositoryFolders/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: { projectId, isDeleted: false },
          }),
        },
      }
    );

    if (!response.ok()) {
      throw new Error("Failed to fetch folders");
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Clean up all test data created during tests
   */
  async cleanup(): Promise<void> {
    // Delete test cases first (they reference folders)
    for (const caseId of this.createdCaseIds) {
      await this.deleteTestCase(caseId);
    }
    this.createdCaseIds = [];

    // Then delete folders
    for (const folderId of this.createdFolderIds) {
      await this.deleteFolder(folderId);
    }
    this.createdFolderIds = [];
  }
}
