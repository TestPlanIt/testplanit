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
  private createdIssueIds: number[] = [];
  private createdTestRunIds: number[] = [];
  private createdTestRunCaseIds: number[] = [];
  private createdCaseFieldIds: number[] = [];
  private createdResultFieldIds: number[] = [];
  private createdTemplateIds: number[] = [];
  private createdFieldOptionIds: number[] = [];
  private cachedTemplateId: number | null = null;
  private cachedStateId: number | null = null;
  private cachedRepositoryId: number | null = null;
  private cachedStatusIds: Map<string, number> = new Map();

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
   * Create an issue via API
   * Issues can be linked to test cases, test runs, sessions, etc.
   */
  async createIssue(
    projectId: number,
    name: string,
    title: string
  ): Promise<number> {
    const userId = await this.getCurrentUserId();

    const response = await this.request.post(
      `${this.baseURL}/api/model/issue/create`,
      {
        data: {
          data: {
            name,
            title,
            isDeleted: false,
            project: { connect: { id: projectId } },
            createdBy: { connect: { id: userId } },
          },
        },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`Failed to create issue: ${error}`);
    }

    const result = await response.json();
    const issueId = result.data.id;
    this.createdIssueIds.push(issueId);
    return issueId;
  }

  /**
   * Link an issue to a test case via API
   * Uses the many-to-many relationship between Issues and RepositoryCases
   */
  async linkIssueToTestCase(issueId: number, caseId: number): Promise<void> {
    const response = await this.request.patch(
      `${this.baseURL}/api/model/repositoryCases/update`,
      {
        data: {
          where: { id: caseId },
          data: {
            issues: {
              connect: [{ id: issueId }],
            },
          },
        },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`Failed to link issue to test case: ${error}`);
    }
  }

  /**
   * Delete an issue via API (soft delete)
   * Silently ignores failures - item may already be deleted by the test
   */
  async deleteIssue(issueId: number): Promise<void> {
    this.request
      .patch(`${this.baseURL}/api/model/issue/update`, {
        data: {
          where: { id: issueId },
          data: { isDeleted: true },
        },
      })
      .catch(() => {});
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

    let repositoryId: number | null = null;
    if (!repoResponse.ok()) {
      // Repository creation is not critical, log but don't fail
      console.warn(`Failed to create repository for project ${projectId}`);
    } else {
      const repoResult = await repoResponse.json();
      repositoryId = repoResult.data?.id || null;
    }

    // Create root folder for the project (required for test cases)
    if (repositoryId) {
      const folderResponse = await this.request.post(
        `${this.baseURL}/api/model/repositoryFolders/create`,
        {
          data: {
            data: {
              name: "Root Folder",
              order: 0,
              isDeleted: false,
              docs: JSON.stringify({
                type: "doc",
                content: [{ type: "paragraph" }],
              }),
              project: { connect: { id: projectId } },
              repository: { connect: { id: repositoryId } },
              creator: { connect: { id: userId } },
            },
          },
        }
      );

      if (!folderResponse.ok()) {
        console.warn(`Failed to create root folder for project ${projectId}`);
      }
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

  // ============================================
  // Test Run Methods
  // ============================================

  /**
   * Get an available status ID for test runs
   * Statuses are used for TestRunCases and TestRunResults
   * @param statusType - Optional filter: 'passed', 'failed', 'blocked', or 'any' (default)
   */
  async getStatusId(statusType: "passed" | "failed" | "blocked" | "any" = "any"): Promise<number> {
    const cacheKey = statusType;
    if (this.cachedStatusIds.has(cacheKey)) {
      return this.cachedStatusIds.get(cacheKey)!;
    }

    const whereClause: Record<string, unknown> = {
      isDeleted: false,
      isEnabled: true,
    };

    // Filter by status type if specified
    if (statusType === "passed") {
      whereClause.isSuccess = true;
    } else if (statusType === "failed") {
      whereClause.isFailure = true;
    } else if (statusType === "blocked") {
      whereClause.isBlocked = true;
    }

    const response = await this.request.get(
      `${this.baseURL}/api/model/status/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: whereClause,
            take: 1,
          }),
        },
      }
    );

    if (!response.ok()) {
      throw new Error("Failed to fetch statuses");
    }

    const result = await response.json();
    if (result.data.length === 0) {
      throw new Error(`No ${statusType} status found. Run seed first.`);
    }

    const statusId = result.data[0].id;
    this.cachedStatusIds.set(cacheKey, statusId);
    return statusId;
  }

  /**
   * Get multiple status IDs for test runs
   * Useful for testing different status scenarios
   */
  async getStatusIds(count: number = 3): Promise<number[]> {
    const response = await this.request.get(
      `${this.baseURL}/api/model/status/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: {
              isDeleted: false,
              isEnabled: true,
            },
            take: count,
          }),
        },
      }
    );

    if (!response.ok()) {
      throw new Error("Failed to fetch statuses");
    }

    const result = await response.json();
    if (result.data.length === 0) {
      throw new Error("No statuses found. Run seed first.");
    }

    return result.data.map((s: { id: number }) => s.id);
  }

  /**
   * Create a test run via API
   * Test runs contain test cases and track execution status
   */
  async createTestRun(
    projectId: number,
    name: string,
    options?: {
      stateId?: number;
      milestoneId?: number;
      configId?: number;
      testRunType?: "REGULAR" | "JUNIT" | "TESTNG" | "XUNIT" | "NUNIT" | "MSTEST" | "MOCHA" | "CUCUMBER";
    }
  ): Promise<number> {
    const userId = await this.getCurrentUserId();
    const stateId = options?.stateId || await this.getStateId(projectId);

    const data: Record<string, unknown> = {
      name,
      isCompleted: false,
      isDeleted: false,
      testRunType: options?.testRunType || "REGULAR",
      project: { connect: { id: projectId } },
      state: { connect: { id: stateId } },
      createdBy: { connect: { id: userId } },
    };

    if (options?.milestoneId) {
      data.milestone = { connect: { id: options.milestoneId } };
    }

    if (options?.configId) {
      data.config = { connect: { id: options.configId } };
    }

    const response = await this.request.post(
      `${this.baseURL}/api/model/testRuns/create`,
      {
        data: { data },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`Failed to create test run: ${error}`);
    }

    const result = await response.json();
    const testRunId = result.data.id;
    this.createdTestRunIds.push(testRunId);
    return testRunId;
  }

  /**
   * Add a test case to a test run via API
   * Creates a TestRunCases entry linking the case to the run
   * @returns The TestRunCases ID (not the RepositoryCases ID)
   */
  async addTestCaseToTestRun(
    testRunId: number,
    repositoryCaseId: number,
    options?: {
      order?: number;
      statusId?: number;
      assignedToId?: string;
    }
  ): Promise<number> {
    const data: Record<string, unknown> = {
      order: options?.order ?? 0,
      isCompleted: false,
      testRun: { connect: { id: testRunId } },
      repositoryCase: { connect: { id: repositoryCaseId } },
    };

    if (options?.statusId) {
      data.status = { connect: { id: options.statusId } };
    }

    if (options?.assignedToId) {
      data.assignedTo = { connect: { id: options.assignedToId } };
    }

    const response = await this.request.post(
      `${this.baseURL}/api/model/testRunCases/create`,
      {
        data: { data },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`Failed to add test case to test run: ${error}`);
    }

    const result = await response.json();
    const testRunCaseId = result.data.id;
    this.createdTestRunCaseIds.push(testRunCaseId);
    return testRunCaseId;
  }

  /**
   * Add multiple test cases to a test run with sequential order
   * Convenience method for bulk adding cases
   * @returns Array of TestRunCases IDs
   */
  async addTestCasesToTestRun(
    testRunId: number,
    repositoryCaseIds: number[],
    options?: {
      assignedToId?: string;
    }
  ): Promise<number[]> {
    const testRunCaseIds: number[] = [];

    for (let i = 0; i < repositoryCaseIds.length; i++) {
      const testRunCaseId = await this.addTestCaseToTestRun(
        testRunId,
        repositoryCaseIds[i],
        {
          order: i + 1,
          assignedToId: options?.assignedToId,
        }
      );
      testRunCaseIds.push(testRunCaseId);
    }

    return testRunCaseIds;
  }

  /**
   * Assign a user to a test run case
   */
  async assignTestRunCase(testRunCaseId: number, userId: string): Promise<void> {
    const response = await this.request.patch(
      `${this.baseURL}/api/model/testRunCases/update`,
      {
        data: {
          where: { id: testRunCaseId },
          data: {
            assignedTo: { connect: { id: userId } },
          },
        },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`Failed to assign test run case: ${error}`);
    }
  }

  /**
   * Set the status of a test run case
   */
  async setTestRunCaseStatus(testRunCaseId: number, statusId: number): Promise<void> {
    const response = await this.request.patch(
      `${this.baseURL}/api/model/testRunCases/update`,
      {
        data: {
          where: { id: testRunCaseId },
          data: {
            status: { connect: { id: statusId } },
          },
        },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`Failed to set test run case status: ${error}`);
    }
  }

  /**
   * Mark a test run case as completed
   */
  async completeTestRunCase(testRunCaseId: number): Promise<void> {
    const response = await this.request.patch(
      `${this.baseURL}/api/model/testRunCases/update`,
      {
        data: {
          where: { id: testRunCaseId },
          data: {
            isCompleted: true,
            completedAt: new Date().toISOString(),
          },
        },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`Failed to complete test run case: ${error}`);
    }
  }

  /**
   * Create a test result for a test run case
   * Test results record the outcome of executing a test case
   */
  async createTestResult(
    testRunId: number,
    testRunCaseId: number,
    statusId: number,
    options?: {
      notes?: string;
      elapsed?: number;
    }
  ): Promise<number> {
    const userId = await this.getCurrentUserId();

    const data: Record<string, unknown> = {
      executedAt: new Date().toISOString(),
      testRun: { connect: { id: testRunId } },
      testRunCase: { connect: { id: testRunCaseId } },
      status: { connect: { id: statusId } },
      executedBy: { connect: { id: userId } },
    };

    if (options?.notes) {
      data.notes = JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: options.notes }] }],
      });
    }

    if (options?.elapsed !== undefined) {
      data.elapsed = options.elapsed;
    }

    const response = await this.request.post(
      `${this.baseURL}/api/model/testRunResults/create`,
      {
        data: { data },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`Failed to create test result: ${error}`);
    }

    const result = await response.json();
    return result.data.id;
  }

  /**
   * Get test run cases for a test run
   */
  async getTestRunCases(
    testRunId: number
  ): Promise<Array<{ id: number; repositoryCaseId: number; order: number; statusId: number | null; assignedToId: string | null }>> {
    const response = await this.request.get(
      `${this.baseURL}/api/model/testRunCases/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: { testRunId },
            orderBy: { order: "asc" },
          }),
        },
      }
    );

    if (!response.ok()) {
      throw new Error("Failed to fetch test run cases");
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Delete a test run via API (soft delete)
   * Silently ignores failures - item may already be deleted by the test
   */
  async deleteTestRun(testRunId: number): Promise<void> {
    this.request
      .patch(`${this.baseURL}/api/model/testRuns/update`, {
        data: {
          where: { id: testRunId },
          data: { isDeleted: true },
        },
      })
      .catch(() => {});
  }

  /**
   * Delete a test run case via API
   * Uses hard delete since TestRunCases doesn't have isDeleted field
   * Silently ignores failures
   */
  async deleteTestRunCase(testRunCaseId: number): Promise<void> {
    this.request
      .delete(`${this.baseURL}/api/model/testRunCases/delete`, {
        data: {
          where: { id: testRunCaseId },
        },
      })
      .catch(() => {});
  }

  // ============================================
  // Templates & Fields Methods
  // ============================================

  /**
   * Get available case field types
   */
  async getCaseFieldTypes(): Promise<Array<{ id: number; type: string }>> {
    const response = await this.request.get(
      `${this.baseURL}/api/model/caseFieldTypes/findMany`,
      {
        params: {
          q: JSON.stringify({}),
        },
      }
    );

    if (!response.ok()) {
      throw new Error("Failed to fetch case field types");
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Get a case field type ID by name
   */
  async getCaseFieldTypeId(typeName: string): Promise<number> {
    const types = await this.getCaseFieldTypes();
    const type = types.find((t) => t.type.toLowerCase() === typeName.toLowerCase());
    if (!type) {
      throw new Error(`Case field type "${typeName}" not found`);
    }
    return type.id;
  }

  /**
   * Create a case field via API
   */
  async createCaseField(options: {
    displayName: string;
    systemName?: string;
    typeName: string;
    hint?: string;
    isEnabled?: boolean;
    isRequired?: boolean;
    isRestricted?: boolean;
    defaultValue?: string;
    minValue?: number;
    maxValue?: number;
    initialHeight?: number;
    isChecked?: boolean;
  }): Promise<number> {
    const typeId = await this.getCaseFieldTypeId(options.typeName);

    // Generate system name from display name if not provided
    const systemName = options.systemName ||
      options.displayName.replace(/[^a-zA-Z0-9]/g, "_").replace(/^(\d)/, "_$1");

    const data: Record<string, unknown> = {
      displayName: options.displayName,
      systemName: systemName,
      typeId: typeId,
      isEnabled: options.isEnabled ?? true,
      isDeleted: false,
      isRequired: options.isRequired ?? false,
      isRestricted: options.isRestricted ?? false,
    };

    if (options.hint) data.hint = options.hint;
    if (options.defaultValue !== undefined) data.defaultValue = options.defaultValue;
    if (options.minValue !== undefined) data.minValue = options.minValue;
    if (options.maxValue !== undefined) data.maxValue = options.maxValue;
    if (options.initialHeight !== undefined) data.initialHeight = options.initialHeight;
    if (options.isChecked !== undefined) data.isChecked = options.isChecked;

    const response = await this.request.post(
      `${this.baseURL}/api/model/caseFields/create`,
      {
        data: { data },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`Failed to create case field: ${error}`);
    }

    const result = await response.json();
    const fieldId = result.data.id;
    this.createdCaseFieldIds.push(fieldId);
    return fieldId;
  }

  /**
   * Delete a case field via API (soft delete)
   */
  async deleteCaseField(fieldId: number): Promise<void> {
    this.request
      .patch(`${this.baseURL}/api/model/caseFields/update`, {
        data: {
          where: { id: fieldId },
          data: { isDeleted: true },
        },
      })
      .catch(() => {});
  }

  /**
   * Create a result field via API
   */
  async createResultField(options: {
    displayName: string;
    systemName?: string;
    typeName: string;
    hint?: string;
    isEnabled?: boolean;
    isRequired?: boolean;
    isRestricted?: boolean;
    defaultValue?: string;
    minValue?: number;
    maxValue?: number;
    initialHeight?: number;
    isChecked?: boolean;
  }): Promise<number> {
    const typeId = await this.getCaseFieldTypeId(options.typeName);

    // Generate system name from display name if not provided
    const systemName = options.systemName ||
      options.displayName.replace(/[^a-zA-Z0-9]/g, "_").replace(/^(\d)/, "_$1");

    const data: Record<string, unknown> = {
      displayName: options.displayName,
      systemName: systemName,
      typeId: typeId,
      isEnabled: options.isEnabled ?? true,
      isDeleted: false,
      isRequired: options.isRequired ?? false,
      isRestricted: options.isRestricted ?? false,
    };

    if (options.hint) data.hint = options.hint;
    if (options.defaultValue !== undefined) data.defaultValue = options.defaultValue;
    if (options.minValue !== undefined) data.minValue = options.minValue;
    if (options.maxValue !== undefined) data.maxValue = options.maxValue;
    if (options.initialHeight !== undefined) data.initialHeight = options.initialHeight;
    if (options.isChecked !== undefined) data.isChecked = options.isChecked;

    const response = await this.request.post(
      `${this.baseURL}/api/model/resultFields/create`,
      {
        data: { data },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`Failed to create result field: ${error}`);
    }

    const result = await response.json();
    const fieldId = result.data.id;
    this.createdResultFieldIds.push(fieldId);
    return fieldId;
  }

  /**
   * Delete a result field via API (soft delete)
   */
  async deleteResultField(fieldId: number): Promise<void> {
    this.request
      .patch(`${this.baseURL}/api/model/resultFields/update`, {
        data: {
          where: { id: fieldId },
          data: { isDeleted: true },
        },
      })
      .catch(() => {});
  }

  /**
   * Create a template via API
   */
  async createTemplate(options: {
    name: string;
    isEnabled?: boolean;
    isDefault?: boolean;
    caseFieldIds?: number[];
    resultFieldIds?: number[];
    projectIds?: number[];
  }): Promise<number> {
    // If setting as default, unset other defaults first
    if (options.isDefault) {
      await this.request.patch(
        `${this.baseURL}/api/model/templates/updateMany`,
        {
          data: {
            where: { isDefault: true },
            data: { isDefault: false },
          },
        }
      );
    }

    const response = await this.request.post(
      `${this.baseURL}/api/model/templates/create`,
      {
        data: {
          data: {
            templateName: options.name,
            isEnabled: options.isEnabled ?? true,
            isDefault: options.isDefault ?? false,
            isDeleted: false,
          },
        },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`Failed to create template: ${error}`);
    }

    const result = await response.json();
    const templateId = result.data.id;
    this.createdTemplateIds.push(templateId);

    // Assign case fields if provided
    if (options.caseFieldIds && options.caseFieldIds.length > 0) {
      await this.request.post(
        `${this.baseURL}/api/model/templateCaseAssignment/createMany`,
        {
          data: {
            data: options.caseFieldIds.map((fieldId, index) => ({
              templateId: templateId,
              caseFieldId: fieldId,
              order: index + 1,
            })),
          },
        }
      );
    }

    // Assign result fields if provided
    if (options.resultFieldIds && options.resultFieldIds.length > 0) {
      await this.request.post(
        `${this.baseURL}/api/model/templateResultAssignment/createMany`,
        {
          data: {
            data: options.resultFieldIds.map((fieldId, index) => ({
              templateId: templateId,
              resultFieldId: fieldId,
              order: index + 1,
            })),
          },
        }
      );
    }

    // Assign projects if provided
    if (options.projectIds && options.projectIds.length > 0) {
      await this.request.post(
        `${this.baseURL}/api/model/templateProjectAssignment/createMany`,
        {
          data: {
            data: options.projectIds.map((projectId) => ({
              templateId: templateId,
              projectId: projectId,
            })),
          },
        }
      );
    }

    return templateId;
  }

  /**
   * Delete a template via API (soft delete)
   */
  async deleteTemplate(templateId: number): Promise<void> {
    this.request
      .patch(`${this.baseURL}/api/model/templates/update`, {
        data: {
          where: { id: templateId },
          data: { isDeleted: true },
        },
      })
      .catch(() => {});
  }

  /**
   * Create a field option for dropdown/multi-select fields
   */
  async createFieldOption(options: {
    name: string;
    caseFieldId?: number;
    resultFieldId?: number;
    isDefault?: boolean;
    isEnabled?: boolean;
    order?: number;
    iconId?: number;
    iconColorId?: number;
  }): Promise<number> {
    const response = await this.request.post(
      `${this.baseURL}/api/model/fieldOptions/create`,
      {
        data: {
          data: {
            name: options.name,
            isEnabled: options.isEnabled ?? true,
            isDeleted: false,
            isDefault: options.isDefault ?? false,
            order: options.order ?? 0,
            ...(options.iconId && { iconId: options.iconId }),
            ...(options.iconColorId && { iconColorId: options.iconColorId }),
          },
        },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`Failed to create field option: ${error}`);
    }

    const result = await response.json();
    const optionId = result.data.id;
    this.createdFieldOptionIds.push(optionId);

    // Link to case field if provided
    if (options.caseFieldId) {
      await this.request.post(
        `${this.baseURL}/api/model/caseFieldAssignment/create`,
        {
          data: {
            data: {
              fieldOptionId: optionId,
              caseFieldId: options.caseFieldId,
            },
          },
        }
      );
    }

    // Link to result field if provided
    if (options.resultFieldId) {
      await this.request.post(
        `${this.baseURL}/api/model/resultFieldAssignment/create`,
        {
          data: {
            data: {
              fieldOptionId: optionId,
              resultFieldId: options.resultFieldId,
            },
          },
        }
      );
    }

    return optionId;
  }

  /**
   * Delete a field option via API (soft delete)
   */
  async deleteFieldOption(optionId: number): Promise<void> {
    this.request
      .patch(`${this.baseURL}/api/model/fieldOptions/update`, {
        data: {
          where: { id: optionId },
          data: { isDeleted: true },
        },
      })
      .catch(() => {});
  }

  /**
   * Get field options for a case field
   */
  async getCaseFieldOptions(caseFieldId: number): Promise<Array<{ id: number; name: string; isDefault: boolean }>> {
    const response = await this.request.get(
      `${this.baseURL}/api/model/caseFieldAssignment/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: { caseFieldId: caseFieldId },
            include: { fieldOption: true },
          }),
        },
      }
    );

    if (!response.ok()) {
      throw new Error("Failed to fetch case field options");
    }

    const result = await response.json();
    return result.data.map((assignment: { fieldOption: { id: number; name: string; isDefault: boolean } }) => ({
      id: assignment.fieldOption.id,
      name: assignment.fieldOption.name,
      isDefault: assignment.fieldOption.isDefault,
    }));
  }

  /**
   * Get all templates
   */
  async getTemplates(): Promise<Array<{ id: number; templateName: string; isDefault: boolean; isEnabled: boolean }>> {
    const response = await this.request.get(
      `${this.baseURL}/api/model/templates/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: { isDeleted: false },
          }),
        },
      }
    );

    if (!response.ok()) {
      throw new Error("Failed to fetch templates");
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Assign a case field to an existing template via API
   */
  async assignCaseFieldToTemplate(templateId: number, caseFieldId: number, order?: number): Promise<void> {
    // Get current count to determine order if not provided
    let fieldOrder = order;
    if (fieldOrder === undefined) {
      const response = await this.request.get(
        `${this.baseURL}/api/model/templateCaseAssignment/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: { templateId: templateId },
            }),
          },
        }
      );
      if (response.ok()) {
        const result = await response.json();
        fieldOrder = (result.data?.length || 0) + 1;
      } else {
        fieldOrder = 1;
      }
    }

    const response = await this.request.post(
      `${this.baseURL}/api/model/templateCaseAssignment/create`,
      {
        data: {
          data: {
            templateId: templateId,
            caseFieldId: caseFieldId,
            order: fieldOrder,
          },
        },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`Failed to assign case field to template: ${error}`);
    }
  }

  /**
   * Assign a result field to an existing template via API
   */
  async assignResultFieldToTemplate(templateId: number, resultFieldId: number, order?: number): Promise<void> {
    // Get current count to determine order if not provided
    let fieldOrder = order;
    if (fieldOrder === undefined) {
      const response = await this.request.get(
        `${this.baseURL}/api/model/templateResultAssignment/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: { templateId: templateId },
            }),
          },
        }
      );
      if (response.ok()) {
        const result = await response.json();
        fieldOrder = (result.data?.length || 0) + 1;
      } else {
        fieldOrder = 1;
      }
    }

    const response = await this.request.post(
      `${this.baseURL}/api/model/templateResultAssignment/create`,
      {
        data: {
          data: {
            templateId: templateId,
            resultFieldId: resultFieldId,
            order: fieldOrder,
          },
        },
      }
    );

    if (!response.ok()) {
      const error = await response.text();
      throw new Error(`Failed to assign result field to template: ${error}`);
    }
  }

  /**
   * Get the default template
   */
  async getDefaultTemplate(): Promise<{ id: number; templateName: string } | null> {
    const response = await this.request.get(
      `${this.baseURL}/api/model/templates/findFirst`,
      {
        params: {
          q: JSON.stringify({
            where: { isDefault: true, isDeleted: false },
          }),
        },
      }
    );

    if (!response.ok()) {
      return null;
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Get all case fields
   */
  async getCaseFields(): Promise<Array<{ id: number; displayName: string; systemName: string; typeId: number }>> {
    const response = await this.request.get(
      `${this.baseURL}/api/model/caseFields/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: { isDeleted: false },
          }),
        },
      }
    );

    if (!response.ok()) {
      throw new Error("Failed to fetch case fields");
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Get all result fields
   */
  async getResultFields(): Promise<Array<{ id: number; displayName: string; systemName: string; typeId: number }>> {
    const response = await this.request.get(
      `${this.baseURL}/api/model/resultFields/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: { isDeleted: false },
          }),
        },
      }
    );

    if (!response.ok()) {
      throw new Error("Failed to fetch result fields");
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Clean up all test data created during tests
   */
  async cleanup(): Promise<void> {
    // Delete test run cases first (they reference test runs and repository cases)
    for (const testRunCaseId of this.createdTestRunCaseIds) {
      await this.deleteTestRunCase(testRunCaseId);
    }
    this.createdTestRunCaseIds = [];

    // Delete test runs (they reference projects)
    for (const testRunId of this.createdTestRunIds) {
      await this.deleteTestRun(testRunId);
    }
    this.createdTestRunIds = [];

    // Delete test cases (they reference folders, tags, and issues)
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

    // Delete issues
    for (const issueId of this.createdIssueIds) {
      await this.deleteIssue(issueId);
    }
    this.createdIssueIds = [];

    // Finally delete projects (they reference everything else)
    for (const projectId of this.createdProjectIds) {
      await this.deleteProject(projectId);
    }
    this.createdProjectIds = [];

    // Delete templates (created test data)
    for (const templateId of this.createdTemplateIds) {
      await this.deleteTemplate(templateId);
    }
    this.createdTemplateIds = [];

    // Delete field options
    for (const optionId of this.createdFieldOptionIds) {
      await this.deleteFieldOption(optionId);
    }
    this.createdFieldOptionIds = [];

    // Delete case fields
    for (const fieldId of this.createdCaseFieldIds) {
      await this.deleteCaseField(fieldId);
    }
    this.createdCaseFieldIds = [];

    // Delete result fields
    for (const fieldId of this.createdResultFieldIds) {
      await this.deleteResultField(fieldId);
    }
    this.createdResultFieldIds = [];
  }
}
