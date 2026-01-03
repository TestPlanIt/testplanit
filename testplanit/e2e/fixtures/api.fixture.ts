import { APIRequestContext } from "@playwright/test";

/**
 * API Helper for creating and cleaning up test data via the TestPlanIt API.
 * Uses ZenStack auto-generated API endpoints.
 */
export class ApiHelper {
  private request: APIRequestContext;
  private baseURL: string;
  private createdProjectIds: number[] = [];
  private createdFolderIds: number[] = [];
  private createdCaseIds: number[] = [];
  private createdTagIds: number[] = [];
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
   * Get multiple workflow IDs for the project (used for creating test cases with different states)
   */
  async getStateIds(projectId: number, count: number = 2): Promise<number[]> {
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
            take: count,
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

    return result.data.map((w: { id: number }) => w.id);
  }

  /**
   * Create a test case with a specific state via API
   */
  async createTestCaseWithState(
    projectId: number,
    folderId: number,
    name: string,
    stateId: number
  ): Promise<number> {
    const [repositoryId, templateId] = await Promise.all([
      this.getRepositoryId(projectId),
      this.getTemplateId(projectId),
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
   * Get root folder ID for a project
   */
  async getRootFolderId(projectId: number): Promise<number> {
    const folders = await this.getFolders(projectId);
    const rootFolder = folders.find((f) => f.parentId === null);
    if (!rootFolder) {
      throw new Error("No root folder found for project");
    }
    return rootFolder.id;
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
      throw new Error(
        "No repositories found in test database. Run seed first."
      );
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
   * Also creates the initial version 1 record (matching UI behavior)
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

    // Get additional info needed for version record
    const [folderInfo, templateInfo, stateInfo, projectInfo, userInfo] =
      await Promise.all([
        this.getFolderInfo(folderId),
        this.getTemplateInfo(templateId),
        this.getWorkflowInfo(stateId),
        this.getProjectInfo(projectId),
        this.getCurrentUserInfo(),
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
            creator: { connect: { id: userInfo.id } },
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

    // Create version 1 record (matching UI behavior)
    const versionResponse = await this.request.post(
      `${this.baseURL}/api/model/repositoryCaseVersions/create`,
      {
        data: {
          data: {
            repositoryCase: { connect: { id: caseId } },
            project: { connect: { id: projectId } },
            staticProjectName: projectInfo.name,
            staticProjectId: projectId,
            repositoryId: repositoryId,
            folderId: folderId,
            folderName: folderInfo.name,
            templateId: templateId,
            templateName: templateInfo.name,
            name: name,
            stateId: stateId,
            stateName: stateInfo.name,
            estimate: 0,
            creatorId: userInfo.id,
            creatorName: userInfo.name,
            automated: false,
            isArchived: false,
            isDeleted: false,
            version: 1,
            steps: [],
            tags: [],
            issues: [],
            attachments: [],
          },
        },
      }
    );

    if (!versionResponse.ok()) {
      // Log warning but don't fail - version record is needed for version selector
      console.warn(`Failed to create initial version record for case ${caseId}`);
    }

    return caseId;
  }

  /**
   * Helper: Get folder info
   */
  private async getFolderInfo(
    folderId: number
  ): Promise<{ id: number; name: string }> {
    const response = await this.request.get(
      `${this.baseURL}/api/model/repositoryFolders/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: { id: folderId },
            select: { id: true, name: true },
          }),
        },
      }
    );
    if (!response.ok()) {
      return { id: folderId, name: "Unknown" };
    }
    const result = await response.json();
    return result.data || { id: folderId, name: "Unknown" };
  }

  /**
   * Helper: Get template info
   */
  private async getTemplateInfo(
    templateId: number
  ): Promise<{ id: number; name: string }> {
    const response = await this.request.get(
      `${this.baseURL}/api/model/templates/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: { id: templateId },
            select: { id: true, templateName: true },
          }),
        },
      }
    );
    if (!response.ok()) {
      return { id: templateId, name: "Unknown" };
    }
    const result = await response.json();
    return {
      id: result.data?.id || templateId,
      name: result.data?.templateName || "Unknown",
    };
  }

  /**
   * Helper: Get workflow/state info
   */
  private async getWorkflowInfo(
    workflowId: number
  ): Promise<{ id: number; name: string }> {
    const response = await this.request.get(
      `${this.baseURL}/api/model/workflows/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: { id: workflowId },
            select: { id: true, name: true },
          }),
        },
      }
    );
    if (!response.ok()) {
      return { id: workflowId, name: "Unknown" };
    }
    const result = await response.json();
    return result.data || { id: workflowId, name: "Unknown" };
  }

  /**
   * Helper: Get project info
   */
  private async getProjectInfo(
    projectId: number
  ): Promise<{ id: number; name: string }> {
    const response = await this.request.get(
      `${this.baseURL}/api/model/projects/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: { id: projectId },
            select: { id: true, name: true },
          }),
        },
      }
    );
    if (!response.ok()) {
      return { id: projectId, name: "Unknown" };
    }
    const result = await response.json();
    return result.data || { id: projectId, name: "Unknown" };
  }

  /**
   * Helper: Get current user info
   */
  private async getCurrentUserInfo(): Promise<{ id: string; name: string }> {
    const response = await this.request.get(`${this.baseURL}/api/auth/session`);
    if (!response.ok()) {
      return { id: "", name: "Unknown" };
    }
    const session = await response.json();
    return {
      id: session?.user?.id || "",
      name: session?.user?.name || "Unknown",
    };
  }

  /**
   * Create a tag via API
   */
  async createTag(name: string): Promise<number> {
    const response = await this.request.post(
      `${this.baseURL}/api/model/tags/create`,
      {
        data: {
          data: {
            name,
            isDeleted: false,
          },
        },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`Failed to create tag: ${error}`);
    }

    const result = await response.json();
    const tagId = result.data.id;
    this.createdTagIds.push(tagId);
    return tagId;
  }

  /**
   * Update a test case name via API and create a new version record
   * This properly creates a new version in the system (like the UI does)
   */
  async updateTestCaseName(caseId: number, newName: string): Promise<void> {
    // First, fetch the current test case to get all required data including tags
    const caseResponse = await this.request.get(
      `${this.baseURL}/api/model/repositoryCases/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: { id: caseId },
            include: {
              project: { select: { id: true, name: true } },
              folder: { select: { id: true, name: true } },
              template: { select: { id: true, templateName: true } },
              state: { select: { id: true, name: true } },
              creator: { select: { id: true, name: true } },
              tags: { select: { id: true, name: true } },
            },
          }),
        },
      }
    );

    if (!caseResponse.ok()) {
      const error = await caseResponse.text();
      throw new Error(`Failed to fetch test case: ${error}`);
    }

    const caseResult = await caseResponse.json();
    const testcase = caseResult.data;

    if (!testcase) {
      throw new Error(`Test case ${caseId} not found`);
    }

    const newVersion = testcase.currentVersion + 1;

    // Extract tag names for the version snapshot
    const tagNames = (testcase.tags || []).map(
      (tag: { name: string }) => tag.name
    );

    // Create the new version record
    const versionResponse = await this.request.post(
      `${this.baseURL}/api/model/repositoryCaseVersions/create`,
      {
        data: {
          data: {
            repositoryCase: { connect: { id: caseId } },
            project: { connect: { id: testcase.project.id } },
            staticProjectName: testcase.project.name || "",
            staticProjectId: testcase.project.id,
            repositoryId: testcase.repositoryId || 0,
            folderId: testcase.folder?.id || 0,
            folderName: testcase.folder?.name || "Unknown",
            templateId: testcase.template?.id || 0,
            templateName: testcase.template?.templateName || "Unknown",
            name: newName,
            stateId: testcase.state?.id || 0,
            stateName: testcase.state?.name || "Unknown",
            estimate: testcase.estimate || 0,
            creatorId: testcase.creatorId,
            creatorName: testcase.creator?.name || "Unknown",
            automated: testcase.automated || false,
            isArchived: false,
            isDeleted: false,
            version: newVersion,
            steps: [],
            tags: tagNames,
            issues: [],
            attachments: [],
          },
        },
      }
    );

    if (!versionResponse.ok()) {
      const error = await versionResponse.text();
      throw new Error(`Failed to create version record: ${error}`);
    }

    // Update the test case with the new name and increment currentVersion
    const updateResponse = await this.request.patch(
      `${this.baseURL}/api/model/repositoryCases/update`,
      {
        data: {
          where: { id: caseId },
          data: {
            name: newName,
            currentVersion: newVersion,
          },
        },
      }
    );

    if (!updateResponse.ok()) {
      const error = await updateResponse.text();
      throw new Error(`Failed to update test case: ${error}`);
    }
  }

  /**
   * Add a tag to a test case via API
   */
  async addTagToTestCase(caseId: number, tagId: number): Promise<void> {
    const response = await this.request.patch(
      `${this.baseURL}/api/model/repositoryCases/update`,
      {
        data: {
          where: { id: caseId },
          data: {
            tags: {
              connect: [{ id: tagId }],
            },
          },
        },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`Failed to add tag to test case: ${error}`);
    }
  }

  /**
   * Delete a tag via API (soft delete)
   * Waits for completion to ensure the tag is deleted before continuing
   */
  async deleteTag(tagId: number): Promise<void> {
    const response = await this.request.patch(
      `${this.baseURL}/api/model/tags/update`,
      {
        data: {
          where: { id: tagId },
          data: { isDeleted: true },
        },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`Failed to delete tag: ${error}`);
    }
  }

  /**
   * Delete a folder via API (soft delete)
   * Silently ignores failures - item may already be deleted by the test
   */
  async deleteFolder(folderId: number): Promise<void> {
    // Fire and forget - don't wait or check response
    // Item may already be deleted by the test itself
    this.request
      .patch(`${this.baseURL}/api/model/repositoryFolders/update`, {
        data: {
          where: { id: folderId },
          data: { isDeleted: true },
        },
      })
      .catch(() => {});
  }

  /**
   * Delete a test case via API (soft delete)
   * Silently ignores failures - item may already be deleted by the test
   */
  async deleteTestCase(caseId: number): Promise<void> {
    // Fire and forget - don't wait or check response
    // Item may already be deleted by the test itself
    this.request
      .patch(`${this.baseURL}/api/model/repositoryCases/update`, {
        data: {
          where: { id: caseId },
          data: { isDeleted: true },
        },
      })
      .catch(() => {});
  }

  /**
   * Delete a project via API (soft delete)
   * Silently ignores failures - item may already be deleted by the test
   */
  async deleteProject(projectId: number): Promise<void> {
    // Fire and forget - don't wait or check response
    // Item may already be deleted by the test itself
    this.request
      .patch(`${this.baseURL}/api/model/projects/update`, {
        data: {
          where: { id: projectId },
          data: { isDeleted: true },
        },
      })
      .catch(() => {});
  }

  /**
   * Get the current authenticated user ID
   */
  async getCurrentUserId(): Promise<string> {
    const response = await this.request.get(`${this.baseURL}/api/auth/session`);

    if (!response.ok()) {
      throw new Error("Failed to get current user session");
    }

    const session = await response.json();
    if (!session?.user?.id) {
      throw new Error("No authenticated user found in session");
    }

    return session.user.id;
  }

  /**
   * Create a project via API
   * Follows the same pattern as setup-db.ts:
   * - Creates project with createdBy
   * - Creates repository
   * - Assigns default template
   * - Assigns all workflows
   * - Adds user as project member
   */
  async createProject(name: string): Promise<number> {
    // Get current user ID to set as creator
    const userId = await this.getCurrentUserId();

    // Get default template (required for test cases)
    const templateResponse = await this.request.get(
      `${this.baseURL}/api/model/templates/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: { isDefault: true, isDeleted: false },
          }),
        },
      }
    );

    let defaultTemplateId: number | null = null;
    if (templateResponse.ok()) {
      const templateResult = await templateResponse.json();
      defaultTemplateId = templateResult.data?.id || null;
    }

    // Create the project with explicit createdBy field (matching setup-db.ts pattern)
    const response = await this.request.post(
      `${this.baseURL}/api/model/projects/create`,
      {
        data: {
          data: {
            name,
            isDeleted: false,
            createdBy: userId, // Explicitly set the creator (scalar field)
          },
        },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`Failed to create project: ${error}`);
    }

    const result = await response.json();
    const projectId = result.data.id;
    this.createdProjectIds.push(projectId);

    // Create repository for the project (required for many operations)
    const repoResponse = await this.request.post(
      `${this.baseURL}/api/model/repositories/create`,
      {
        data: {
          data: {
            project: { connect: { id: projectId } },
          },
        },
      }
    );

    if (!repoResponse.ok()) {
      // Repository creation is not critical, log but don't fail
      console.warn(`Failed to create repository for project ${projectId}`);
    }

    // Assign default template to project (matching setup-db.ts)
    if (defaultTemplateId) {
      const templateAssignResponse = await this.request.post(
        `${this.baseURL}/api/model/templateProjectAssignment/create`,
        {
          data: {
            data: {
              templateId: defaultTemplateId,
              projectId: projectId,
            },
          },
        }
      );
      // Template assignment failure is not critical for documentation tests
      if (!templateAssignResponse.ok()) {
        console.warn(`Failed to assign template to project ${projectId}`);
      }
    }

    // Assign all workflows to project (matching setup-db.ts)
    const workflowsResponse = await this.request.get(
      `${this.baseURL}/api/model/workflows/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: { isDeleted: false, isEnabled: true },
          }),
        },
      }
    );

    if (workflowsResponse.ok()) {
      const workflowsResult = await workflowsResponse.json();
      const workflows = workflowsResult.data || [];

      if (workflows.length > 0) {
        const workflowAssignments = workflows.map((w: { id: number }) => ({
          workflowId: w.id,
          projectId: projectId,
        }));

        const workflowAssignResponse = await this.request.post(
          `${this.baseURL}/api/model/projectWorkflowAssignment/createMany`,
          {
            data: {
              data: workflowAssignments,
            },
          }
        );
        // Workflow assignment failure is not critical for documentation tests
        if (!workflowAssignResponse.ok()) {
          console.warn(`Failed to assign workflows to project ${projectId}`);
        }
      }
    }

    // Add user as project member (matching setup-db.ts - critical for access)
    const assignmentResponse = await this.request.post(
      `${this.baseURL}/api/model/projectAssignment/create`,
      {
        data: {
          data: {
            userId: userId,
            projectId: projectId,
          },
        },
      }
    );

    if (!assignmentResponse.ok()) {
      // Project assignment is critical - user won't be able to access the project
      console.warn(
        `Failed to assign user to project ${projectId} - access may be limited`
      );
    }

    return projectId;
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
    // Delete test cases first (they reference folders and tags)
    for (const caseId of this.createdCaseIds) {
      await this.deleteTestCase(caseId);
    }
    this.createdCaseIds = [];

    // Then delete folders
    for (const folderId of this.createdFolderIds) {
      await this.deleteFolder(folderId);
    }
    this.createdFolderIds = [];

    // Delete tags
    for (const tagId of this.createdTagIds) {
      await this.deleteTag(tagId);
    }
    this.createdTagIds = [];

    // Finally delete projects (they reference everything else)
    for (const projectId of this.createdProjectIds) {
      await this.deleteProject(projectId);
    }
    this.createdProjectIds = [];
  }
}
